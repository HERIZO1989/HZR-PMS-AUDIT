import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSessionFromRequest, hasPermission } from '@/lib/session';
import { computeExpenseKpis, summarizeExpenses, validateExpense } from '@/lib/expenses';
import { fetchAllPages } from '@/lib/dbPaging';

const EXPENSE_LIST_LIMIT = 500;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function canUseExpenses(session: Awaited<ReturnType<typeof getSessionFromRequest>>): boolean {
  return hasPermission(session, 'expenses.manage') || hasPermission(session, 'expenses.approve');
}

export async function GET(req: NextRequest) {
  const hotelId = req.nextUrl.searchParams.get('hotelId');
  if (!hotelId) return NextResponse.json({ error: 'hotelId requis' }, { status: 400 });

  const session = await getSessionFromRequest(req);
  if (!session || session.hotelId !== hotelId) {
    return NextResponse.json({ error: 'Accès refusé à cet hôtel' }, { status: 403 });
  }
  if (!canUseExpenses(session)) {
    return NextResponse.json({ error: 'Permission "expenses.manage" requise' }, { status: 403 });
  }

  const today = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
  const fromParam = req.nextUrl.searchParams.get('from');
  const toParam = req.nextUrl.searchParams.get('to');
  const from = fromParam && DATE_RE.test(fromParam) ? fromParam : `${today.slice(0, 7)}-01`;
  const to = toParam && DATE_RE.test(toParam) ? toParam : today;

  const supabase = getSupabaseAdmin();
  type ListedExpense = { expense_date: string; category: string; amount_ttc: number; amount_ht: number; status: 'pending' | 'approved' | 'rejected' } & Record<string, unknown>;
  let allRows: ListedExpense[];
  try {
    // Toutes les depenses de la periode (pages de 1 000) : les totaux et le GOP ne doivent jamais etre tronques par une limite d'affichage.
    allRows = await fetchAllPages<ListedExpense>((a, b) => supabase
      .from('expenses')
      .select('id, expense_date, category, description, supplier, document_number, payment_method, amount_ttc, vat_deductible, amount_ht, status, created_by, approved_at, rejection_reason')
      .eq('hotel_id', hotelId).gte('expense_date', from).lte('expense_date', to)
      .order('expense_date', { ascending: false }).order('id').range(a, b));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erreur de lecture des dépenses' }, { status: 500 });
  }
  const summary = summarizeExpenses(allRows);

  // Nuitees : moteur KPI du PMS. Recettes : CA des factures comptabilisees (HT) quand il y en a sur la periode, sinon revenu hebergement du PMS.
  const kpi = await fetchAllPages<{ rooms_available: number; rooms_occupied: number; total_revenue: number }>((a, b) => supabase
    .from('kpi_daily_snapshots').select('rooms_available, rooms_occupied, total_revenue')
    .eq('hotel_id', hotelId).gte('business_date', from).lte('business_date', to).order('business_date').range(a, b)).catch(() => []);
  const sum = (key: 'rooms_available' | 'rooms_occupied' | 'total_revenue') => kpi.reduce((t, r) => t + Number(r[key] ?? 0), 0);

  const { data: hotel } = await supabase.from('hotels').select('vat_rate').eq('id', hotelId).single();
  const vat = Number(hotel?.vat_rate ?? 0) > 0 ? 1 + Number(hotel?.vat_rate) : 1;
  const invoices = await fetchAllPages<{ amount_ttc: number }>((a, b) => supabase
    .from('invoices').select('amount_ttc')
    .eq('hotel_id', hotelId).neq('payment_status', 'reversed').gte('invoice_date', from).lte('invoice_date', to).order('invoice_date').order('id').range(a, b)).catch(() => []);
  const billedHt = invoices.reduce((t, r) => t + Number(r.amount_ttc), 0) / vat;
  const revenueSource = invoices.length > 0 ? 'invoices' : 'kpi';

  const kpis = computeExpenseKpis({
    revenue: Math.round((revenueSource === 'invoices' ? billedHt : sum('total_revenue')) * 100) / 100,
    expensesHt: summary.approved.ht,
    roomsAvailable: sum('rooms_available'),
    roomsOccupied: sum('rooms_occupied'),
  });

  return NextResponse.json({
    from, to, expenses: allRows.slice(0, EXPENSE_LIST_LIMIT), expensesTotal: allRows.length, listLimit: EXPENSE_LIST_LIMIT,
    summary, kpis, revenueSource,
    hasPersonnelExpenses: allRows.some((r) => r.category === 'personnel' && r.status === 'approved'),
    canApprove: hasPermission(session, 'expenses.approve'),
    currentStaffUserId: session.staffUserId,
  });
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !hasPermission(session, 'expenses.manage')) {
    return NextResponse.json({ error: 'Permission "expenses.manage" requise' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  const checked = validateExpense(body);
  if (!checked.ok) return NextResponse.json({ error: checked.errors.join(' ; '), errors: checked.errors }, { status: 400 });

  // Le saisisseur qui peut aussi valider (OWNER, GM) n'a pas besoin d'un second passage : la depense est approuvee tout de suite.
  const autoApprove = hasPermission(session, 'expenses.approve');
  const idempotencyKey = typeof body.idempotency_key === 'string' && body.idempotency_key.length <= 100 ? body.idempotency_key : null;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('expenses')
    .insert({
      ...checked.value,
      tenant_id: session.tenantId,
      hotel_id: session.hotelId,
      created_by: session.staffUserId,
      status: autoApprove ? 'approved' : 'pending',
      approved_by: autoApprove ? session.staffUserId : null,
      approved_at: autoApprove ? new Date().toISOString() : null,
      idempotency_key: idempotencyKey,
    })
    .select('id, status')
    .single();

  if (error) {
    if (error.code === '23505') return NextResponse.json({ duplicate: true }, { status: 200 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ expense: data }, { status: 201 });
}
