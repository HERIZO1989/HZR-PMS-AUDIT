// Rapport mensuel de performance (HT) : KPI du mois, comparaison, depenses par categorie, creances, points d'attention.
import { computePerformance, type PerfRow, type SnapshotLite } from './performance';
import { buildReceivables, tagInvoices, type ClientRow } from './receivables';
import { lastInvoiceDateOf } from './invoices';
import { EXPENSE_CATEGORIES } from './expenses';

export interface ReportInvoice {
  invoice_number: string | null; partner_name: string; invoice_date: string; due_date: string | null; amount_ttc: number; payment_status: string;
}
export interface ReportExpense { expense_date: string; amount_ht: number; category: string }

export interface ReportInput {
  month: string;                 // AAAA-MM
  today: string;                 // AAAA-MM-JJ (heure de Madagascar)
  vatRate: number;
  snapshots: SnapshotLite[];
  invoices: ReportInvoice[];     // toutes les factures comptabilisees de l'hotel
  expenses: ReportExpense[];     // depenses approuvees
}

export interface Delta { value: number; unit: 'pts' | '%' }
export interface MonthlyReport {
  month: string;
  label: string;
  asOf: string;
  kpi: { month: PerfRow | null; previous: PerfRow | null; ytd: PerfRow };
  deltas: Partial<Record<'occupancy' | 'adr' | 'revpar' | 'trevpar' | 'billedRevenue' | 'gop' | 'goppar', Delta>>;
  expensesByCategory: { category: string; label: string; amountHt: number; share: number }[];
  receivables: { total: number; reliable: number; toReconcile: number; over90: number; overdue: number; count: number; clientCount: number; top: ClientRow[] };
  freshness: { lastInvoiceDate: string | null; lastSnapshotDate: string | null };
  attention: string[];
}

export const MONTH_NAMES = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export const monthLabel = (ym: string) => `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const daysInMonth = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
const monthEnd = (ym: string) => `${ym}-${String(daysInMonth(ym)).padStart(2, '0')}`;
const previousMonth = (ym: string) => { const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };
const round2 = (n: number) => Math.round(n * 100) / 100;
const pct = (now: number, before: number): Delta | undefined => (before > 0 ? { value: (now / before - 1) * 100, unit: '%' } : undefined);

export function buildMonthlyReport(input: ReportInput): MonthlyReport {
  const { month, today, vatRate } = input;
  const year = month.slice(0, 4);
  const asOf = monthEnd(month) < today ? monthEnd(month) : today;
  const billing = input.invoices.filter((i) => i.payment_status !== 'reversed');
  const perf = computePerformance({
    snapshots: input.snapshots,
    invoices: billing.map((i) => ({ invoice_date: i.invoice_date, amount_ttc: Number(i.amount_ttc) })),
    expenses: input.expenses.map((e) => ({ expense_date: e.expense_date, amount_ht: Number(e.amount_ht), category: e.category })),
    vatRate,
  }, year, asOf);

  const cur = perf.months.find((m) => m.month === month) ?? null;
  const prev = perf.months.find((m) => m.month === previousMonth(month)) ?? null;

  const deltas: MonthlyReport['deltas'] = {};
  if (cur && prev) {
    if (prev.roomsAvailable > 0) deltas.occupancy = { value: (cur.occupancy - prev.occupancy) * 100, unit: 'pts' };
    const set = (k: 'adr' | 'revpar' | 'trevpar' | 'billedRevenue' | 'gop' | 'goppar') => { const d = pct(cur[k], prev[k]); if (d) deltas[k] = d; };
    (['adr', 'revpar', 'trevpar', 'billedRevenue', 'gop', 'goppar'] as const).forEach(set);
  }

  const inMonth = input.expenses.filter((e) => e.expense_date.startsWith(month) && e.expense_date <= asOf);
  const totalExp = inMonth.reduce((t, e) => t + Number(e.amount_ht), 0);
  const byCat = new Map<string, number>();
  for (const e of inMonth) byCat.set(e.category, (byCat.get(e.category) ?? 0) + Number(e.amount_ht));
  const expensesByCategory = [...byCat.entries()].sort((a, b) => b[1] - a[1]).map(([category, amount]) => ({
    category, label: EXPENSE_CATEGORIES.find((c) => c.code === category)?.label ?? category, amountHt: round2(amount), share: totalExp > 0 ? amount / totalExp : 0,
  }));

  const tagged = tagInvoices(input.invoices.map((i) => ({ ...i, amount_ttc: Number(i.amount_ttc) })));
  const open = tagged.filter((i) => i.payment_status === 'unpaid' || i.payment_status === 'partial');
  const rec = buildReceivables(open, today);

  const lastInvoiceDate = lastInvoiceDateOf(input.invoices, today);
  const lastSnapshotDate = input.snapshots.reduce<string | null>((m, s) => (s.business_date <= today && (m === null || s.business_date > m) ? s.business_date : m), null);

  const attention: string[] = [];
  if (!cur) attention.push(`Aucune donnée pour ${monthLabel(month)} : vérifiez les imports et le recalcul des indicateurs.`);
  else if (cur.partial) attention.push(`Mois incomplet : ${cur.days} jour(s) calculé(s) sur ${asOf === monthEnd(month) ? daysInMonth(month) : Number(asOf.slice(8, 10))}.`);
  if (lastInvoiceDate && lastInvoiceDate < asOf) attention.push(`Les factures ne sont importées que jusqu'au ${lastInvoiceDate.split('-').reverse().join('/')} : le CA de la fin de période est incomplet.`);
  if (cur && !inMonth.some((e) => e.category === 'personnel')) attention.push('Aucune charge de personnel pour ce mois : le GOP et sa marge sont surévalués.');
  const other = byCat.get('other') ?? 0;
  if (totalExp > 0 && other / totalExp > 0.2) attention.push(`${Math.round((other / totalExp) * 100)} % des dépenses du mois sont non classées (« Autres dépenses »).`);
  if (rec.toReconcile.amount > 0) attention.push('Des petites factures (restaurant, buanderie) sont à rapprocher dans Odoo : elles sont présumées déjà réglées et exclues des créances fiables.');
  if (rec.total > 0 && rec.over90 / rec.total >= 0.25) attention.push(`${Math.round((rec.over90 / rec.total) * 100)} % des créances ont plus de 90 jours.`);

  return {
    month, label: monthLabel(month), asOf,
    kpi: { month: cur, previous: prev, ytd: perf.total }, deltas, expensesByCategory,
    receivables: { total: rec.total, reliable: rec.reliable.amount, toReconcile: rec.toReconcile.amount, over90: rec.over90, overdue: rec.overdue, count: rec.count, clientCount: rec.clientCount, top: rec.clients.slice(0, 10) },
    freshness: { lastInvoiceDate, lastSnapshotDate }, attention,
  };
}
