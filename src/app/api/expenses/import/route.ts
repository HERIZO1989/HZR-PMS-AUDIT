import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSessionFromRequest, hasPermission } from '@/lib/session';
import { expenseFingerprint, type ExpenseCategory } from '@/lib/expenses';
import { supplierRuleKey } from '@/lib/expenseRules';
import { MAX_EXPENSE_ROWS, prepareExpenseRows, readExpenseRows } from '@/lib/expensesImport';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  const hotelId = formData.get('hotelId') as string | null;
  if (!file || !hotelId) return NextResponse.json({ error: 'file et hotelId sont requis' }, { status: 400 });

  const session = await getSessionFromRequest(req);
  if (!session || session.hotelId !== hotelId) {
    return NextResponse.json({ error: 'Accès refusé à cet hôtel' }, { status: 403 });
  }
  if (!hasPermission(session, 'expenses.manage')) {
    return NextResponse.json({ error: 'Permission "expenses.manage" requise' }, { status: 403 });
  }

  const raw = readExpenseRows(Buffer.from(await file.arrayBuffer()), file.name);
  if (raw.length === 0) {
    return NextResponse.json({ error: 'Aucune ligne de dépense trouvée (colonnes attendues : Date, Catégorie, Montant TTC… ou export Odoo des bons de commande)' }, { status: 400 });
  }
  if (raw.length > MAX_EXPENSE_ROWS) {
    return NextResponse.json({ error: `Fichier trop volumineux (${MAX_EXPENSE_ROWS} lignes maximum)` }, { status: 400 });
  }

  const prepared = prepareExpenseRows(raw);
  const supabase = getSupabaseAdmin();
  // Regles fournisseur -> categorie de l'hotel : elles remplacent la categorie deduite. Le doublon est detecte AVANT le reclassement,
  // pour qu'un changement de regle ne cree jamais de depense en double au rechargement du meme fichier.
  const { data: ruleRows } = await supabase.from('expense_supplier_rules').select('supplier_key, category').eq('hotel_id', session.hotelId);
  const rules = new Map<string, ExpenseCategory>((ruleRows ?? []).map((r) => [r.supplier_key as string, r.category as ExpenseCategory]));
  const autoApprove = hasPermission(session, 'expenses.approve');
  const nowIso = new Date().toISOString();
  const toInsert = prepared.valid.map(({ sourceKey, needsReview, ...v }) => {
    // Les lignes « à vérifier » (montant douteux) restent en attente : elles ne comptent dans aucun total tant qu'un valideur ne les a pas approuvées.
    const approve = autoApprove && !needsReview;
    const idempotencyKey = createHash('sha1').update(sourceKey ?? expenseFingerprint(v)).digest('hex');
    const ruled = v.supplier ? rules.get(supplierRuleKey(v.supplier)) : undefined;
    return {
      ...v,
      ...(ruled ? { category: ruled } : {}),
      tenant_id: session.tenantId,
      hotel_id: session.hotelId,
      created_by: session.staffUserId,
      status: approve ? 'approved' : 'pending',
      approved_by: approve ? session.staffUserId : null,
      approved_at: approve ? nowIso : null,
      idempotency_key: idempotencyKey,
    };
  });

  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += 200) {
    const chunk = toInsert.slice(i, i + 200);
    const { data, error } = await supabase
      .from('expenses')
      .upsert(chunk, { onConflict: 'hotel_id,idempotency_key', ignoreDuplicates: true })
      .select('id');
    if (error) return NextResponse.json({ error: error.message, inserted }, { status: 500 });
    inserted += data?.length ?? 0;
  }

  return NextResponse.json({
    inserted,
    alreadyPresent: toInsert.length - inserted,
    duplicatesInFile: prepared.duplicatesInFile,
    blankRows: prepared.blankRows,
    invalid: prepared.invalid.slice(0, 50),
    invalidCount: prepared.invalid.length,
    status: autoApprove ? 'approved' : 'pending',
    format: prepared.format,
    skippedByStatus: prepared.skippedByStatus,
    needsReviewCount: prepared.needsReviewCount,
  });
}
