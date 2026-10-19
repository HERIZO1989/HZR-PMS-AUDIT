import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSessionFromRequest, hasPermission } from '@/lib/session';
import { expenseFingerprint } from '@/lib/expenses';
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
    return NextResponse.json({ error: 'Aucune ligne de dépense trouvée (colonnes attendues : Date, Catégorie, Montant TTC…)' }, { status: 400 });
  }
  if (raw.length > MAX_EXPENSE_ROWS) {
    return NextResponse.json({ error: `Fichier trop volumineux (${MAX_EXPENSE_ROWS} lignes maximum)` }, { status: 400 });
  }

  const prepared = prepareExpenseRows(raw);
  const autoApprove = hasPermission(session, 'expenses.approve');
  const nowIso = new Date().toISOString();
  const toInsert = prepared.valid.map((v) => ({
    ...v,
    tenant_id: session.tenantId,
    hotel_id: session.hotelId,
    created_by: session.staffUserId,
    status: autoApprove ? 'approved' : 'pending',
    approved_by: autoApprove ? session.staffUserId : null,
    approved_at: autoApprove ? nowIso : null,
    idempotency_key: createHash('sha1').update(expenseFingerprint(v)).digest('hex'),
  }));

  const supabase = getSupabaseAdmin();
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
  });
}
