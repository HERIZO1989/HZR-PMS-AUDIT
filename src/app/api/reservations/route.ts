import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSessionFromRequest, hasPermission } from '@/lib/session';

export async function GET(req: NextRequest) {
  const hotelId = req.nextUrl.searchParams.get('hotelId');
  if (!hotelId) return NextResponse.json({ error: 'hotelId requis' }, { status: 400 });

  const session = await getSessionFromRequest(req);
  if (!session || session.hotelId !== hotelId) {
    return NextResponse.json({ error: 'Accès refusé à cet hôtel' }, { status: 403 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('reservations')
    .select(
      `id, confirmation_number, status, channel, arrival_date, departure_date, total_amount, currency_code,
       room_type_id, assigned_room_id, guest_id,
       guests ( first_name, last_name, vip_tier ),
       room_types ( name ),
       rooms ( room_number )`
    )
    .eq('hotel_id', hotelId)
    .order('arrival_date', { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ reservations: data });
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

  return NextResponse.json({ reservation: data }, { status: 201 });
}

