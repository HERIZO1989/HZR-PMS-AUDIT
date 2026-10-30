import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSessionFromRequest, hasPermission } from '@/lib/session';

const TARGETS = ['confirmed', 'no_show', 'cancelled'] as const;

/** Annule un check-in (client absent, erreur) : no-show, annulation, ou retour en attente. Refuse des qu'une nuitee ou un frais est facture. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSessionFromRequest(req);
  if (!session || !hasPermission(session, 'reservations.manage')) {
    return NextResponse.json({ error: 'Permission "reservations.manage" requise' }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const to = TARGETS.find((t) => t === body?.to);
  if (!to) return NextResponse.json({ error: 'to requis : confirmed, no_show ou cancelled' }, { status: 400 });
  const reason = typeof body?.reason === 'string' ? body.reason.slice(0, 300) : null;

  const { data, error } = await getSupabaseAdmin().rpc('revert_check_in', {
    p_reservation_id: params.id, p_hotel_id: session.hotelId, p_to_status: to, p_staff_user_id: session.staffUserId, p_reason: reason,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 422 });
  return NextResponse.json({ reservation: data });
}
