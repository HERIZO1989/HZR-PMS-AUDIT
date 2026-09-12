import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSessionFromRequest, hasPermission } from '@/lib/session';

/** PARTIE C — Ajout de ligne de folio. Reserve a finance.manage (coherent avec le RBAC existant). */
export async function POST(req: NextRequest, { params }: { params: { folioId: string } }) {
  const session = await getSessionFromRequest(req);
  if (!hasPermission(session, 'finance.manage')) {
    return NextResponse.json({ error: 'Permission "finance.manage" requise' }, { status: 403 });
  }

  const body = await req.json();
  const { lineType, description, amount, quantity } = body ?? {};
  if (!lineType || !description || amount === undefined) {
    return NextResponse.json({ error: 'lineType, description, amount requis' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc('add_folio_line', {
    p_folio_id: params.folioId,
    p_hotel_id: session!.hotelId,
    p_line_type: lineType,
    p_description: description,
    p_amount: amount,
    p_quantity: quantity ?? 1,
    p_staff_user_id: session!.staffUserId,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 422 });
  return NextResponse.json({ folio: data });
}
