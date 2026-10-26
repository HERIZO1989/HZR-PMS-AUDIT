import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSessionFromRequest, hasPermission } from '@/lib/session';
import { PAYMENT_STATUSES, effectiveAsOf, lastInvoiceDateOf, summarizeRevenue, type InvoiceLite } from '@/lib/invoices';
import { summarizeDeposits, type DepositLite, type DepositStatus } from '@/lib/deposits';

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
  // Tableau de bord : seule la synthese est utile (pas de liste, pas d'acomptes), pour un chargement rapide.
  const summaryOnly = p.get('summaryOnly') === '1';
  const status = p.get('paymentStatus');
  const q = (p.get('q') ?? '').replace(/[,()%_\\]/g, ' ').trim().slice(0, 60);

  const supabase = getSupabaseAdmin();
  const { data: hotel } = await supabase.from('hotels').select('vat_rate').eq('id', hotelId).single();
  const vatRate = Number(hotel?.vat_rate ?? 0);

  // Lecture par pages de 1 000 lignes (limite PostgREST), ordre stable pour ne rien sauter ni compter deux fois.
  async function fetchAll<T = InvoiceLite>(build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<T[]> {
    const all: T[] = [];
    for (let start = 0; ; start += PAGE) {
      const { data, error } = await build(start, start + PAGE - 1);
      if (error) throw new Error(error.message);
      all.push(...((data ?? []) as T[]));
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
    let deposits = null as ReturnType<typeof summarizeDeposits> | null;
    if (!summaryOnly) {
      // Acomptes : recus cette annee (heure de Madagascar, UTC+3) + tous ceux encore en attente, avec le statut de leur reservation.
      const yearStartUtc = new Date(Date.UTC(Number(asOf.slice(0, 4)), 0, 1) - 3 * 3600 * 1000).toISOString();
      type DepositRow = { amount: number; status: DepositStatus; received_at: string; resolved_at: string | null; reservations: { status: string } | { status: string }[] | null };
      const depositRows = await fetchAll<DepositRow>((a, b) => supabase.from('reservation_deposits')
        .select('amount, status, received_at, resolved_at, reservations(status)')
        .eq('hotel_id', hotelId).or(`received_at.gte.${yearStartUtc},status.eq.held`)
        .order('received_at').order('id').range(a, b));
      deposits = summarizeDeposits(depositRows.map((d): DepositLite => ({
        amount: Number(d.amount), status: d.status, received_at: d.received_at, resolved_at: d.resolved_at,
        reservation_status: (Array.isArray(d.reservations) ? d.reservations[0]?.status : d.reservations?.status) ?? null,
      })), asOf);
    }

    const allRows = [...yearRows, ...openRows].map((r) => ({ ...r, amount_ttc: Number(r.amount_ttc) }));
    // Les factures sont importees a la main : la date du jour peut etre posterieure a la derniere facture connue.
    const lastInvoiceDate = lastInvoiceDateOf(allRows, asOf);
    // Tableau de bord : on affiche le dernier jour reellement importe plutot qu'un « CA du jour » a zero trompeur.
    const shownAsOf = summaryOnly ? effectiveAsOf(lastInvoiceDate, asOf) : asOf;
    const summary = summarizeRevenue(allRows, shownAsOf, vatRate);

    if (summaryOnly) return NextResponse.json({ asOf: shownAsOf, requestedAsOf: asOf, lastInvoiceDate, summary });

    let list = supabase.from('invoices').select(COLS).eq('hotel_id', hotelId).gte('invoice_date', from).lte('invoice_date', to);
    if (status && PAYMENT_STATUSES.some((s) => s.code === status)) list = list.eq('payment_status', status);
    if (q) list = list.or(`partner_name.ilike.%${q}%,invoice_number.ilike.%${q}%`);
    const { data: invoices, error } = await list.order('invoice_date', { ascending: false }).order('id').limit(300);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ asOf, from, to, lastInvoiceDate, summary, deposits, invoices: invoices ?? [], listLimit: 300 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erreur de lecture des factures' }, { status: 500 });
  }
}
