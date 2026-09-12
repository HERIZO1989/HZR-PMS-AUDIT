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
  const { data, error } = await supabase.rpc('check_in_reservation', {
    p_reservation_id: params.id,
    p_hotel_id: session!.hotelId,
    p_room_id: body?.roomId ?? null,
    p_staff_user_id: session!.staffUserId,
  });

  if (error) {
    const status = error.code === '23P01' ? 409 : 422;
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json({ reservation: data });
}
