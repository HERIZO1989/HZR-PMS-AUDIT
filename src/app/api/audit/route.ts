import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSessionFromRequest, hasPermission } from '@/lib/session';
import { fetchAllPages } from '@/lib/dbPaging';
import { buildFindings, type AuditExpenseStats, type AuditInvoice, type AuditReservation } from '@/lib/audit';
import { groupBySupplier } from '@/lib/expenseRules';
import { summarizeDeposits, type DepositLite, type DepositStatus } from '@/lib/deposits';

/** Controles d'audit des donnees de l'hotel (factures, sejours, depenses, acomptes) : lecture seule. */
export async function GET(req: NextRequest) {
  const hotelId = req.nextUrl.searchParams.get('hotelId');
  if (!hotelId) return NextResponse.json({ error: 'hotelId requis' }, { status: 400 });
  const session = await getSessionFromRequest(req);
  if (!session || session.hotelId !== hotelId) return NextResponse.json({ error: 'Accès refusé à cet hôtel' }, { status: 403 });
  if (!hasPermission(session, 'finance.manage')) return NextResponse.json({ error: 'Permission "finance.manage" requise' }, { status: 403 });

  const today = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
  const yearStartUtc = new Date(Date.UTC(Number(today.slice(0, 4)), 0, 1) - 3 * 3600 * 1000).toISOString();
  const supabase = getSupabaseAdmin();

  try {
    const [invoices, confirmedPast, expenseRows, depositRows] = await Promise.all([
      fetchAllPages<AuditInvoice>((a, b) => supabase.from('invoices')
        .select('invoice_number, partner_name, invoice_date, due_date, amount_ttc, payment_status, payment_date')
        .eq('hotel_id', hotelId).order('invoice_date').order('id').range(a, b)),
      fetchAllPages<AuditReservation>((a, b) => supabase.from('reservations')
        .select('confirmation_number, arrival_date, departure_date, total_amount')
        .eq('hotel_id', hotelId).eq('status', 'confirmed').lt('departure_date', today).order('departure_date').order('id').range(a, b)),
      fetchAllPages<{ supplier: string | null; category: string; amount_ht: number; status: string }>((a, b) => supabase.from('expenses')
        .select('supplier, category, amount_ht, status').eq('hotel_id', hotelId).in('status', ['approved', 'pending']).order('id').range(a, b)),
      fetchAllPages<{ amount: number; status: DepositStatus; received_at: string; resolved_at: string | null; reservations: { status: string } | { status: string }[] | null }>((a, b) => supabase.from('reservation_deposits')
        .select('amount, status, received_at, resolved_at, reservations(status)')
        .eq('hotel_id', hotelId).or(`received_at.gte.${yearStartUtc},status.eq.held`).order('received_at').order('id').range(a, b)),
    ]);

    const activeStatuses = ['tentative', 'confirmed', 'checked_in', 'checked_out'];
    const [{ count: noTypeCount }, { data: noTypeExamples }] = await Promise.all([
      supabase.from('reservations').select('id', { count: 'exact', head: true }).eq('hotel_id', hotelId).is('room_type_id', null).in('status', activeStatuses),
      supabase.from('reservations').select('confirmation_number, arrival_date, departure_date, total_amount')
        .eq('hotel_id', hotelId).is('room_type_id', null).in('status', activeStatuses).order('total_amount', { ascending: false }).limit(10),
    ]);

    const approved = expenseRows.filter((r) => r.status === 'approved');
    const pending = expenseRows.filter((r) => r.status === 'pending');
    const other = approved.filter((r) => r.category === 'other');
    const sum = (rows: { amount_ht: number }[]) => rows.reduce((t, r) => t + Number(r.amount_ht), 0);
    const expenses: AuditExpenseStats = {
      approvedHt: sum(approved), otherHt: sum(other),
      topOtherSuppliers: groupBySupplier(other).slice(0, 10).map((g) => ({ label: g.label, count: g.count, amountHt: g.amountHt })),
      pendingCount: pending.length, pendingHt: sum(pending),
      personnelApprovedHt: sum(approved.filter((r) => r.category === 'personnel')),
    };

    const deposits = summarizeDeposits(depositRows.map((d): DepositLite => ({
      amount: Number(d.amount), status: d.status, received_at: d.received_at, resolved_at: d.resolved_at,
      reservation_status: (Array.isArray(d.reservations) ? d.reservations[0]?.status : d.reservations?.status) ?? null,
    })), today);

    const findings = buildFindings({
      today,
      invoices: invoices.map((i) => ({ ...i, amount_ttc: Number(i.amount_ttc) })),
      confirmedPast: confirmedPast.map((r) => ({ ...r, total_amount: Number(r.total_amount) })),
      noRoomType: { count: noTypeCount ?? 0, examples: (noTypeExamples ?? []).map((r) => ({ ...r, total_amount: Number(r.total_amount) })) as AuditReservation[] },
      expenses, deposits,
    });
    return NextResponse.json({ today, findings, counts: {
      high: findings.filter((f) => f.severity === 'high').length, medium: findings.filter((f) => f.severity === 'medium').length,
      low: findings.filter((f) => f.severity === 'low').length, ok: findings.filter((f) => f.severity === 'ok').length } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erreur des contrôles d\'audit' }, { status: 500 });
  }
}
