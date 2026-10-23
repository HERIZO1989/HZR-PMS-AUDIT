import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSessionFromRequest, hasPermission } from '@/lib/session';
import { fetchAllPages } from '@/lib/dbPaging';
import { EXPENSE_CATEGORIES } from '@/lib/expenses';
import { supplierRuleKey } from '@/lib/expenseRules';

/** Classe un fournisseur : memorise la regle et reclasse ses depenses deja enregistrees (les montants ne changent pas). */
export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !hasPermission(session, 'expenses.manage')) {
    return NextResponse.json({ error: 'Permission "expenses.manage" requise' }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const supplier = typeof body?.supplier === 'string' ? body.supplier.trim() : '';
  const category = EXPENSE_CATEGORIES.find((c) => c.code === body?.category)?.code;
  if (!supplier || !category) return NextResponse.json({ error: 'supplier et category (valide) requis' }, { status: 400 });

  const key = supplierRuleKey(supplier);
  const supabase = getSupabaseAdmin();
  try {
    // Libelles bruts du meme fournisseur (variantes de casse ou d'espaces) : le rapprochement se fait ici, pas en base.
    const rows = await fetchAllPages<{ supplier: string | null }>((a, b) => supabase
      .from('expenses').select('supplier').eq('hotel_id', session.hotelId).not('supplier', 'is', null).order('id').range(a, b));
    const raw = [...new Set(rows.map((r) => r.supplier as string).filter((s) => supplierRuleKey(s) === key))];
    if (raw.length === 0) return NextResponse.json({ error: 'Aucune dépense pour ce fournisseur' }, { status: 404 });

    const { data, error } = await supabase.rpc('reclassify_supplier_expenses', {
      p_hotel_id: session.hotelId, p_supplier_key: key, p_supplier_label: supplier,
      p_raw_suppliers: raw, p_category: category, p_staff_user_id: session.staffUserId,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 422 });
    return NextResponse.json({ changed: Number(data ?? 0), supplier, category });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erreur de reclassement' }, { status: 500 });
  }
}
