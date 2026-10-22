import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSessionFromRequest, hasPermission } from '@/lib/session';
import { validateDeposit } from '@/lib/deposits';

/** Acomptes d'une reservation : liste (reservations.manage ou finance.manage) et enregistrement (reservations.manage). */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSessionFromRequest(req);
  if (!session || !(hasPermission(session, 'reservations.manage') || hasPermission(session, 'finance.manage'))) {
    return NextResponse.json({ error: 'Permission "reservations.manage" requise' }, { status: 403 });
  }
  const supabase = getSupabaseAdmin();
  const { data: reservation } = await supabase.from('reservations')
    .select('id, confirmation_number, status, total_amount, currency_code')
    .eq('id', params.id).eq('hotel_id', session.hotelId).maybeSingle();
  if (!reservation) return NextResponse.json({ error: 'Réservation introuvable' }, { status: 404 });

  const { data: deposits, error } = await supabase.from('reservation_deposits')
    .select('id, amount, currency_code, method, status, transaction_reference, received_at, resolved_at, resolution_note')
    .eq('reservation_id', params.id).eq('hotel_id', session.hotelId)
    .order('received_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    reservation, deposits: deposits ?? [],
    canRecord: hasPermission(session, 'reservations.manage'),
    canResolve: hasPermission(session, 'finance.manage'),
  });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSessionFromRequest(req);
  if (!session || !hasPermission(session, 'reservations.manage')) {
    return NextResponse.json({ error: 'Permission "reservations.manage" requise' }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const checked = validateDeposit(body ?? {});
  if (!checked.ok) return NextResponse.json({ error: checked.errors.join(' ; '), errors: checked.errors }, { status: 400 });

  const idempotencyKey = typeof body?.idempotencyKey === 'string' && body.idempotencyKey.length <= 100 ? body.idempotencyKey : null;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc('record_deposit', {
    p_reservation_id: params.id,
    p_hotel_id: session.hotelId,
    p_amount: checked.value.amount,
    p_method: checked.value.method,
    p_staff_user_id: session.staffUserId,
    p_idempotency_key: idempotencyKey,
    p_reference: checked.value.reference,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 422 });
  return NextResponse.json({ deposit: data }, { status: 201 });
}
