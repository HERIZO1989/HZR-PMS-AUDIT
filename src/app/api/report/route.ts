import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSessionFromRequest, hasPermission } from '@/lib/session';
import { fetchAllPages } from '@/lib/dbPaging';
import { buildMonthlyReport, type ReportExpense, type ReportInvoice } from '@/lib/monthlyReport';
import { reportWorkbook } from '@/lib/reportWorkbook';
import type { SnapshotLite } from '@/lib/performance';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Rapport mensuel de performance : JSON pour l'ecran, ou classeur Excel avec ?format=xlsx. */
export async function GET(req: NextRequest) {
  const hotelId = req.nextUrl.searchParams.get('hotelId');
  if (!hotelId) return NextResponse.json({ error: 'hotelId requis' }, { status: 400 });
  const session = await getSessionFromRequest(req);
  if (!session || session.hotelId !== hotelId) return NextResponse.json({ error: 'Accès refusé à cet hôtel' }, { status: 403 });
  if (!hasPermission(session, 'finance.manage')) return NextResponse.json({ error: 'Permission "finance.manage" requise' }, { status: 403 });

  const today = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
  const monthParam = req.nextUrl.searchParams.get('month') ?? '';
  if (!MONTH_RE.test(monthParam) || monthParam > today.slice(0, 7)) return NextResponse.json({ error: 'month requis (AAAA-MM, pas dans le futur)' }, { status: 400 });
  const year = monthParam.slice(0, 4);

  const supabase = getSupabaseAdmin();
  try {
    const [{ data: hotel }, snapshots, invoices, expenses] = await Promise.all([
      supabase.from('hotels').select('name, vat_rate, currency_code').eq('id', hotelId).single(),
      fetchAllPages<SnapshotLite>((a, b) => supabase.from('kpi_daily_snapshots')
        .select('business_date, rooms_available, rooms_occupied, total_room_revenue')
        .eq('hotel_id', hotelId).gte('business_date', `${year}-01-01`).lte('business_date', today).order('business_date').range(a, b)),
      fetchAllPages<ReportInvoice>((a, b) => supabase.from('invoices')
        .select('invoice_number, partner_name, invoice_date, due_date, amount_ttc, payment_status')
        .eq('hotel_id', hotelId).order('invoice_date').order('id').range(a, b)),
      fetchAllPages<ReportExpense>((a, b) => supabase.from('expenses')
        .select('expense_date, amount_ht, category')
        .eq('hotel_id', hotelId).eq('status', 'approved').gte('expense_date', `${year}-01-01`).lte('expense_date', today).order('expense_date').order('id').range(a, b)),
    ]);
    const report = buildMonthlyReport({ month: monthParam, today, vatRate: Number(hotel?.vat_rate ?? 0), snapshots, invoices, expenses });
    const meta = { hotelName: hotel?.name ?? 'Hôtel', currencyCode: hotel?.currency_code ?? 'EUR', generatedAt: new Date().toISOString() };

    if (req.nextUrl.searchParams.get('format') === 'xlsx') {
      const buf = reportWorkbook(report, meta.hotelName, meta.currencyCode);
      return new NextResponse(new Uint8Array(buf), { headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="rapport_mensuel_${monthParam}.xlsx"`,
      } });
    }
    return NextResponse.json({ ...meta, report });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erreur de génération du rapport' }, { status: 500 });
  }
}
