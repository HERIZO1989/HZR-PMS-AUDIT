import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSessionFromRequest, hasPermission } from '@/lib/session';

/**
 * PARTIE B — Check-in transactionnel (verifie disponibilite, ouvre le folio,
 * met a jour le statut chambre). Toute la logique critique est en base (check_in_reservation),
 * jamais uniquement cote frontend.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSessionFromRequest(req);
  if (!hasPermission(session, 'reservations.manage')) {
    return NextResponse.json({ error: 'Permission "reservations.manage" requise' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const supabase = getSupabaseAdmin();
  // Sans chambre choisie, la chambre est attribuee automatiquement (type reserve, propre, libre) : les reservations
  // importees d'Odoo n'ont aucune chambre assignee, ce qui faisait refuser tous les check-in.
  const { data, error } = body?.roomId
    ? await supabase.rpc('check_in_reservation', {
        p_reservation_id: params.id, p_hotel_id: session!.hotelId, p_room_id: body.roomId, p_staff_user_id: session!.staffUserId,
      })
    : await supabase.rpc('auto_check_in_reservation', {
        p_reservation_id: params.id, p_hotel_id: session!.hotelId, p_staff_user_id: session!.staffUserId,
      });

  if (error) {
    const status = error.code === '23P01' ? 409 : 422;
    return NextResponse.json({ error: error.message }, { status });
  }

  // Les acomptes encaisses avant l'arrivee sont reportes comme paiement sur le folio tout juste ouvert.
  // Un echec n'annule pas le check-in : les acomptes restent « en attente » et l'ecran Factures & CA les signale (« à reporter »).
  const { data: applied, error: depositError } = await supabase.rpc('apply_reservation_deposits', {
    p_reservation_id: params.id,
    p_hotel_id: session!.hotelId,
    p_staff_user_id: session!.staffUserId,
  });
  // Chambre choisie a la main pour une reservation sans type (cas frequent des imports Odoo) : on renseigne aussi son type, pour les analyses par categorie.
  if (body?.roomId) {
    const { data: room } = await supabase.from('rooms').select('room_type_id').eq('id', body.roomId).eq('hotel_id', session!.hotelId).maybeSingle();
    if (room?.room_type_id) {
      await supabase.from('reservations').update({ room_type_id: room.room_type_id }).eq('id', params.id).eq('hotel_id', session!.hotelId).is('room_type_id', null);
    }
  }
  return NextResponse.json({
    reservation: data,
    depositsApplied: depositError ? 0 : Number(applied ?? 0),
    ...(depositError ? { depositsError: depositError.message } : {}),
  });
}
