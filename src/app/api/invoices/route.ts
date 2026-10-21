import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSessionFromRequest, hasPermission } from '@/lib/session';
import { PAYMENT_STATUSES, summarizeRevenue, type InvoiceLite } from '@/lib/invoices';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PAGE = 1000;
const COLS = 'id, invoice_number, partner_name, invoice_date, due_date, payment_terms, amount_ttc, payment_status, payment_date';

export async function GET(req: NextRequest) {
  const hotelId = req.nextUrl.searchParams.get('hotelId');
  if (!hotelId) return NextResponse.json({ error: 'hotelId requis' }, { status: 400 });

  const session = await getSessionFromRequest(req);
  if (!session || session.hotelId !== hotelId) {
    return NextResponse.json({ error: 'Accès refusé à cet hôtel' }, { status: 403 });
  }
  if (!hasPermission(session, 'finance.manage')) {
    return NextResponse.json({ error: 'Permission "finance.manage" requise' }, { status: 403 });
  }

  const today = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
  const p = req.nextUrl.searchParams;
  const asOfParam = p.get('asOf');
  const asOf = asOfParam && DATE_RE.test(asOfParam) && asOfParam <= today ? asOfParam : today;
  const fromParam = p.get('from');
  const toParam = p.get('to');
  const from = fromParam && DATE_RE.test(fromParam) ? fromParam : `${asOf.slice(0, 7)}-01`;
  const to = toParam && DATE_RE.test(toParam) ? toParam : asOf;
  const status = p.get('paymentStatus');
  const q = (p.get('q') ?? '').replace(/[,()%_\\]/g, ' ').trim().slice(0, 60);

  const supabase = getSupabaseAdmin();
  const { data: hotel } = await supabase.from('hotels').select('vat_rate').eq('id', hotelId).single();
  const vatRate = Number(hotel?.vat_rate ?? 0);

  // Lecture par pages de 1 000 lignes (limite PostgREST), ordre stable pour ne rien sauter ni compter deux fois.
  async function fetchAll(build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<InvoiceLite[]> {
    const all: InvoiceLite[] = [];
    for (let start = 0; ; start += PAGE) {
      const { data, error } = await build(start, start + PAGE - 1);
      if (error) throw new Error(error.message);
      all.push(...((data ?? []) as InvoiceLite[]));
      if (!data || data.length < PAGE) break;
    }
    return all;
  }

  try {
    const yearStart = `${asOf.slice(0, 4)}-01-01`;
    const [yearRows, openRows] = await Promise.all([
      // Factures de l'annee + factures payees cette annee (meme si emises avant) pour les encaissements.
      fetchAll((a, b) => supabase.from('invoices').select('id, invoice_date, due_date, amount_ttc, payment_status, payment_date')
        .eq('hotel_id', hotelId).or(`invoice_date.gte.${yearStart},payment_date.gte.${yearStart}`)
        .order('invoice_date').order('id').range(a, b)),
      // Creances de toutes les annees.
      fetchAll((a, b) => supabase.from('invoices').select('id, invoice_date, due_date, amount_ttc, payment_status, payment_date')
        .eq('hotel_id', hotelId).in('payment_status', ['unpaid', 'partial'])
        .order('invoice_date').order('id').range(a, b)),
    ]);
    const summary = summarizeRevenue([...yearRows, ...openRows].map((r) => ({ ...r, amount_ttc: Number(r.amount_ttc) })), asOf, vatRate);

    let list = supabase.from('invoices').select(COLS).eq('hotel_id', hotelId).gte('invoice_date', from).lte('invoice_date', to);
    if (status && PAYMENT_STATUSES.some((s) => s.code === status)) list = list.eq('payment_status', status);
    if (q) list = list.or(`partner_name.ilike.%${q}%,invoice_number.ilike.%${q}%`);
    const { data: invoices, error } = await list.order('invoice_date', { ascending: false }).order('id').limit(300);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ asOf, from, to, summary, invoices: invoices ?? [], listLimit: 300 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erreur de lecture des factures' }, { status: 500 });
  }
}
