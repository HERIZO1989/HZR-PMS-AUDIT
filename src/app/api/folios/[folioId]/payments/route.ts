import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSessionFromRequest, hasPermission } from '@/lib/session';

/**
 * PARTIE D — Paiement. Le montant n'est JAMAIS pris tel quel sans validation : la fonction
 * SQL add_payment revalide le folio et rejette tout montant <= 0. idempotencyKey DOIT etre
 * generee une seule fois cote client (au moment du clic) et renvoyee a l'identique en cas de
 * retry reseau — la generer ici cote serveur casserait la garantie (une nouvelle cle a chaque
 * appel ne protegerait plus rien).
 */
export async function POST(req: NextRequest, { params }: { params: { folioId: string } }) {
  const session = await getSessionFromRequest(req);
  if (!hasPermission(session, 'finance.manage')) {
    return NextResponse.json({ error: 'Permission "finance.manage" requise' }, { status: 403 });
  }

  const body = await req.json();
  const { amount, method, idempotencyKey } = body ?? {};
  if (amount === undefined || !method || !idempotencyKey) {
    return NextResponse.json({ error: 'amount, method et idempotencyKey requis' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc('add_payment', {
    p_folio_id: params.folioId,
    p_hotel_id: session!.hotelId,
    p_amount: amount,
    p_method: method,
    p_staff_user_id: session!.staffUserId,
    p_idempotency_key: idempotencyKey,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 422 });
  return NextResponse.json({ folio: data });
}
