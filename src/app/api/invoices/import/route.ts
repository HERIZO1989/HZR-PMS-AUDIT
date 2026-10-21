import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSessionFromRequest, hasPermission } from '@/lib/session';
import { MAX_INVOICE_ROWS, prepareInvoiceRows, readInvoiceRows } from '@/lib/invoicesImport';

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
  if (!hasPermission(session, 'finance.manage')) {
    return NextResponse.json({ error: 'Permission "finance.manage" requise' }, { status: 403 });
  }

  const raw = readInvoiceRows(Buffer.from(await file.arrayBuffer()), file.name);
  if (raw.length === 0) {
    return NextResponse.json({ error: 'Aucune facture trouvée (export Odoo « Pièces comptables » attendu : Numéro, Date de facturation, Total signé, Statut du paiement, Statut…)' }, { status: 400 });
  }
  if (raw.length > MAX_INVOICE_ROWS) {
    return NextResponse.json({ error: `Fichier trop volumineux (${MAX_INVOICE_ROWS} lignes maximum)` }, { status: 400 });
  }
  const prepared = prepareInvoiceRows(raw);

  const supabase = getSupabaseAdmin();
  // Etat actuel : une facture deja connue n'est mise a jour que si son paiement ou son echeance a change (Non paye -> Paye).
  const existing = new Map<string, string>();
  for (let start = 0; ; start += 1000) {
    const { data, error } = await supabase.from('invoices')
      .select('idempotency_key, payment_status, payment_date, due_date')
      .eq('hotel_id', hotelId).order('id').range(start, start + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const r of data ?? []) existing.set(r.idempotency_key, `${r.payment_status}|${r.payment_date ?? ''}|${r.due_date ?? ''}`);
    if (!data || data.length < 1000) break;
  }

  const nowIso = new Date().toISOString();
  const toWrite: Record<string, unknown>[] = [];
  let inserted = 0, updated = 0, unchanged = 0;
  for (const { key, ...v } of prepared.valid) {
    const prev = existing.get(key);
    const sig = `${v.payment_status}|${v.payment_date ?? ''}|${v.due_date ?? ''}`;
    if (prev === undefined) inserted++;
    else if (prev !== sig) updated++;
    else { unchanged++; continue; }
    toWrite.push({
      ...v, source: 'odoo', tenant_id: session.tenantId, hotel_id: session.hotelId,
      imported_by: session.staffUserId, idempotency_key: key, updated_at: nowIso,
    });
  }

  for (let i = 0; i < toWrite.length; i += 200) {
    const { error } = await supabase.from('invoices').upsert(toWrite.slice(i, i + 200), { onConflict: 'hotel_id,idempotency_key' });
    if (error) return NextResponse.json({ error: error.message, written: i }, { status: 500 });
  }

  return NextResponse.json({
    inserted, updated, unchanged,
    duplicatesInFile: prepared.duplicatesInFile,
    blankRows: prepared.blankRows,
    invalid: prepared.invalid.slice(0, 50),
    invalidCount: prepared.invalid.length,
    skippedByStatus: prepared.skippedByStatus,
  });
}
