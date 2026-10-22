import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSessionFromRequest, hasPermission } from '@/lib/session';
import { fetchAllPages } from '@/lib/dbPaging';
import { computePerformance, type ExpenseLiteForPerf, type InvoiceLiteForPerf, type SnapshotLite } from '@/lib/performance';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Performance mensuelle de l'annee en cours (ou de l'annee de `asOf`) : RevPAR, TRevPAR et GOP, en HT. */
export async function GET(req: NextRequest) {
  const hotelId = req.nextUrl.searchParams.get('hotelId');
  if (!hotelId) return NextResponse.json({ error: 'hotelId requis' }, { status: 400 });
  const session = await getSessionFromRequest(req);
  if (!session || session.hotelId !== hotelId) return NextResponse.json({ error: 'Accès refusé à cet hôtel' }, { status: 403 });
  if (!hasPermission(session, 'finance.manage')) return NextResponse.json({ error: 'Permission "finance.manage" requise' }, { status: 403 });

  const today = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
  const asOfParam = req.nextUrl.searchParams.get('asOf');
  const asOf = asOfParam && DATE_RE.test(asOfParam) && asOfParam <= today ? asOfParam : today;
  const year = asOf.slice(0, 4);
  const yearStart = `${year}-01-01`;

  const supabase = getSupabaseAdmin();
  const { data: hotel } = await supabase.from('hotels').select('vat_rate').eq('id', hotelId).single();
  const vatRate = Number(hotel?.vat_rate ?? 0);

  try {
    const [snapshots, invoices, expenses] = await Promise.all([
      fetchAllPages<SnapshotLite>((a, b) => supabase.from('kpi_daily_snapshots')
        .select('business_date, rooms_available, rooms_occupied, total_room_revenue')
        .eq('hotel_id', hotelId).gte('business_date', yearStart).lte('business_date', asOf).order('business_date').range(a, b)),
      fetchAllPages<InvoiceLiteForPerf>((a, b) => supabase.from('invoices')
        .select('invoice_date, amount_ttc')
        .eq('hotel_id', hotelId).neq('payment_status', 'reversed').gte('invoice_date', yearStart).lte('invoice_date', asOf).order('invoice_date').order('id').range(a, b)),
      fetchAllPages<ExpenseLiteForPerf>((a, b) => supabase.from('expenses')
        .select('expense_date, amount_ht, category')
        .eq('hotel_id', hotelId).eq('status', 'approved').gte('expense_date', yearStart).lte('expense_date', asOf).order('expense_date').order('id').range(a, b)),
    ]);
    const performance = computePerformance({ snapshots, invoices, expenses, vatRate }, year, asOf);
    return NextResponse.json({ asOf, year, vatRate, ...performance, hasPersonnelExpenses: performance.total.personnelExpenses > 0 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erreur de calcul de la performance' }, { status: 500 });
  }
}
