import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSessionFromRequest, hasPermission } from '@/lib/session';
import { fetchAllPages } from '@/lib/dbPaging';
import { groupBySupplier } from '@/lib/expenseRules';

/** Fournisseurs dont les depenses sont encore classees « Autres dépenses » (plus gros montants d'abord), a classer par l'hotel. */
export async function GET(req: NextRequest) {
  const hotelId = req.nextUrl.searchParams.get('hotelId');
  if (!hotelId) return NextResponse.json({ error: 'hotelId requis' }, { status: 400 });
  const session = await getSessionFromRequest(req);
  if (!session || session.hotelId !== hotelId) return NextResponse.json({ error: 'Accès refusé à cet hôtel' }, { status: 403 });
  if (!hasPermission(session, 'expenses.manage')) return NextResponse.json({ error: 'Permission "expenses.manage" requise' }, { status: 403 });

  const supabase = getSupabaseAdmin();
  try {
    const rows = await fetchAllPages<{ supplier: string | null; amount_ht: number }>((a, b) => supabase
      .from('expenses').select('supplier, amount_ht')
      .eq('hotel_id', hotelId).eq('category', 'other').neq('status', 'rejected').order('id').range(a, b));
    const all = groupBySupplier(rows);
    const totalHt = all.reduce((t, g) => t + g.amountHt, 0);
    return NextResponse.json({
      totalSuppliers: all.length,
      totalHt: Math.round(totalHt * 100) / 100,
      suppliers: all.slice(0, 40).map(({ key, label, count, amountHt }) => ({ key, label, count, amountHt })),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erreur de lecture' }, { status: 500 });
  }
}
