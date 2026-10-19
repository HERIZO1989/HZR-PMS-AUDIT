import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSessionFromRequest, hasPermission } from '@/lib/session';

/** Approuver ou rejeter une depense en attente (permission expenses.approve). */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSessionFromRequest(req);
  if (!session || !hasPermission(session, 'expenses.approve')) {
    return NextResponse.json({ error: 'Permission "expenses.approve" requise' }, { status: 403 });
  }

  let body: { action?: string; reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }
  if (body.action !== 'approve' && body.action !== 'reject') {
    return NextResponse.json({ error: 'action doit valoir "approve" ou "reject"' }, { status: 400 });
  }
  const reason = String(body.reason ?? '').trim().slice(0, 300);
  if (body.action === 'reject' && !reason) {
    return NextResponse.json({ error: 'Un motif est requis pour rejeter une dépense' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: expense } = await supabase.from('expenses').select('id, hotel_id, status').eq('id', params.id).maybeSingle();
  if (!expense || expense.hotel_id !== session.hotelId) {
    return NextResponse.json({ error: 'Dépense introuvable pour cet hôtel' }, { status: 404 });
  }
  if (expense.status !== 'pending') {
    return NextResponse.json({ error: 'Seule une dépense en attente peut être approuvée ou rejetée' }, { status: 409 });
  }

  const { error } = await supabase
    .from('expenses')
    .update({
      status: body.action === 'approve' ? 'approved' : 'rejected',
      approved_by: session.staffUserId,
      approved_at: new Date().toISOString(),
      rejection_reason: body.action === 'reject' ? reason : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.id)
    .eq('status', 'pending');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** Supprimer une depense encore en attente : son auteur ou un approbateur. */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSessionFromRequest(req);
  if (!session || !hasPermission(session, 'expenses.manage')) {
    return NextResponse.json({ error: 'Permission "expenses.manage" requise' }, { status: 403 });
  }
  const supabase = getSupabaseAdmin();
  const { data: expense } = await supabase.from('expenses').select('id, hotel_id, status, created_by').eq('id', params.id).maybeSingle();
  if (!expense || expense.hotel_id !== session.hotelId) {
    return NextResponse.json({ error: 'Dépense introuvable pour cet hôtel' }, { status: 404 });
  }
  if (expense.status !== 'pending') {
    return NextResponse.json({ error: 'Une dépense validée ou rejetée ne peut pas être supprimée' }, { status: 409 });
  }
  if (expense.created_by !== session.staffUserId && !hasPermission(session, 'expenses.approve')) {
    return NextResponse.json({ error: "Seul l'auteur ou un approbateur peut supprimer cette dépense" }, { status: 403 });
  }
  const { error } = await supabase.from('expenses').delete().eq('id', params.id).eq('status', 'pending');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
