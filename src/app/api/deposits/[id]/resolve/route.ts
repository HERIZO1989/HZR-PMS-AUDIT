import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSessionFromRequest, hasPermission } from '@/lib/session';

/** Apres annulation ou no-show : rembourser l'acompte ou le conserver. Reserve a finance.manage (sortie d'argent). */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSessionFromRequest(req);
  if (!session || !hasPermission(session, 'finance.manage')) {
    return NextResponse.json({ error: 'Permission "finance.manage" requise' }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  if (body?.action !== 'refund' && body?.action !== 'forfeit') {
    return NextResponse.json({ error: 'action requise : "refund" ou "forfeit"' }, { status: 400 });
  }
  const note = typeof body?.note === 'string' ? body.note.slice(0, 300) : null;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc('resolve_deposit', {
    p_deposit_id: params.id,
    p_hotel_id: session.hotelId,
    p_action: body.action,
    p_staff_user_id: session.staffUserId,
    p_note: note,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 422 });
  return NextResponse.json({ deposit: data });
}
