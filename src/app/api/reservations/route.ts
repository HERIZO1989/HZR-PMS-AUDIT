import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSessionFromRequest, hasPermission } from '@/lib/session';
import { sendReservationConfirmation } from '@/lib/email';
import { cleanSearch, parseReservationView, viewQuery } from '@/lib/reservationViews';
import { localDateHour } from '@/lib/autoCheckIn';

export async function GET(req: NextRequest) {
  const hotelId = req.nextUrl.searchParams.get('hotelId');
  if (!hotelId) return NextResponse.json({ error: 'hotelId requis' }, { status: 400 });

  const session = await getSessionFromRequest(req);
  if (!session || session.hotelId !== hotelId) {
    return NextResponse.json({ error: 'Accès refusé à cet hôtel' }, { status: 403 });
  }

  const supabase = getSupabaseAdmin();
  // Vue demandee (arrivees du jour par defaut) : sans cela, la liste ne montrait que les 100 arrivees les plus lointaines.
  const { data: hotel } = await supabase.from('hotels').select('timezone').eq('id', hotelId).single();
  const today = localDateHour(new Date(), hotel?.timezone ?? 'UTC').date;
  const search = cleanSearch(req.nextUrl.searchParams.get('q'));
  const view = search ? 'all' : parseReservationView(req.nextUrl.searchParams.get('view'));
  const vq = viewQuery(view, today);
  let query = supabase
    .from('reservations')
    .select(
      `id, confirmation_number, status, channel, arrival_date, departure_date, total_amount, currency_code,
       room_type_id, assigned_room_id, guest_id,
       guests ( first_name, last_name, vip_tier ),
       room_types ( name ),
       rooms ( room_number )`
    )
    .eq('hotel_id', hotelId);
  if (vq.statuses) query = query.in('status', vq.statuses);
  if (vq.arrivalEq) query = query.eq('arrival_date', vq.arrivalEq);
  if (vq.arrivalLt) query = query.lt('arrival_date', vq.arrivalLt);
  if (vq.arrivalGt) query = query.gt('arrival_date', vq.arrivalGt);
  if (vq.departureGt) query = query.gt('departure_date', vq.departureGt);
  if (search) query = query.ilike('confirmation_number', `%${search}%`);
  const { data, error } = await query
    .order('arrival_date', { ascending: vq.ascending })
    .order('confirmation_number')
    .limit(vq.limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ reservations: data, view, today });
}

/**
 * PARTIE A/H — Creation de reservation.
 * Toute la logique (disponibilite, calcul du montant, creation/rattachement du client)
 * est faite cote serveur PostgreSQL (fonction create_reservation) : le client ne peut
 * jamais forcer une reservation sur une periode indisponible (contrainte EXCLUDE en base).
 */
export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasPermission(session, 'reservations.manage')) {
    return NextResponse.json({ error: 'Permission "reservations.manage" requise' }, { status: 403 });
  }

  const body = await req.json();
  const {
    roomTypeId,
    arrivalDate,
    departureDate,
    assignedRoomId,
    guestId,
    guestFirstName,
    guestLastName,
    guestEmail,
    adults,
    children,
    channel,
    ratePlanId,
    specialRequests,
  } = body ?? {};

  if (!roomTypeId || !arrivalDate || !departureDate || (!guestId && !guestEmail)) {
    return NextResponse.json(
      { error: 'roomTypeId, arrivalDate, departureDate et (guestId ou guestEmail) sont requis' },
      { status: 400 }
    );
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc('create_reservation', {
    p_tenant_id: session!.tenantId,
    p_hotel_id: session!.hotelId,
    p_room_type_id: roomTypeId,
    p_arrival_date: arrivalDate,
    p_departure_date: departureDate,
    p_guest_id: guestId ?? null,
    p_guest_first_name: guestFirstName ?? null,
    p_guest_last_name: guestLastName ?? null,
    p_guest_email: guestEmail ?? null,
    p_assigned_room_id: assignedRoomId ?? null,
    p_adults: adults ?? 1,
    p_children: children ?? 0,
    p_channel: channel ?? 'direct',
    p_rate_plan_id: ratePlanId ?? null,
    p_special_requests: specialRequests ?? null,
    p_created_by: session!.staffUserId,
  });

  if (error) {
    // 23P01 = exclusion_violation Postgres -> conflit de disponibilite reel, pas une erreur serveur generique
    const status = error.code === '23P01' ? 409 : 422;
    return NextResponse.json({ error: error.message }, { status });
  }

  // BUG-14 - Envoi de la confirmation par email (best-effort : n'echoue jamais la reponse
  // HTTP, la reservation est deja creee et validee en base a ce stade).
  const { data: hotel } = await supabase.from('hotels').select('name').eq('id', session!.hotelId).single();
  const { data: guest } = await supabase.from('guests').select('email, first_name, last_name').eq('id', data.guest_id).single();

  if (guest?.email && hotel?.name) {
    await sendReservationConfirmation({
      guestEmail: guest.email,
      guestName: `${guest.first_name} ${guest.last_name}`,
      confirmationNumber: data.confirmation_number,
      hotelName: hotel.name,
      arrivalDate: data.arrival_date,
      departureDate: data.departure_date,
      totalAmount: Number(data.total_amount),
      currencyCode: data.currency_code,
    });
  }

  return NextResponse.json({ reservation: data }, { status: 201 });
}

