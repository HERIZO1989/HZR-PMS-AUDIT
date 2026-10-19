import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSessionFromRequest, hasPermission } from '@/lib/session';
import { computeExpenseKpis, summarizeExpenses, validateExpense } from '@/lib/expenses';

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
  const { data: rows, error } = await supabase
    .from('expenses')
    .select('id, expense_date, category, description, supplier, document_number, payment_method, amount_ttc, vat_deductible, amount_ht, status, created_by, approved_at, rejection_reason')
    .eq('hotel_id', hotelId)
    .gte('expense_date', from)
    .lte('expense_date', to)
    .order('expense_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(2000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const summary = summarizeExpenses(rows ?? []);

  // Recettes et nuitees de la meme periode, telles que calculees par le moteur KPI du PMS.
  const { data: kpi } = await supabase
    .from('kpi_daily_snapshots')
    .select('rooms_available, rooms_occupied, total_revenue')
    .eq('hotel_id', hotelId)
    .gte('business_date', from)
    .lte('business_date', to);
  const sum = (key: 'rooms_available' | 'rooms_occupied' | 'total_revenue') =>
    (kpi ?? []).reduce((s, r) => s + Number(r[key] ?? 0), 0);
  const kpis = computeExpenseKpis({
    revenue: sum('total_revenue'),
    expensesHt: summary.approved.ht,
    roomsAvailable: sum('rooms_available'),
    roomsOccupied: sum('rooms_occupied'),
  });

  return NextResponse.json({
    from, to, expenses: rows ?? [], summary, kpis,
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
