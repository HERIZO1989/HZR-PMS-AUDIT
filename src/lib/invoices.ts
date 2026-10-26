// Registre des factures clients : etats de paiement, synthese du CA (jour, mois, annee), encaissements et creances.

export const PAYMENT_STATUSES = [
  { code: 'unpaid', label: 'Non payée' },
  { code: 'in_payment', label: 'En paiement' },
  { code: 'partial', label: 'Partiellement réglée' },
  { code: 'paid', label: 'Payée' },
  { code: 'reversed', label: 'Extournée' },
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]['code'];

export interface InvoiceLite {
  id?: string;
  invoice_date: string;
  due_date: string | null;
  amount_ttc: number;
  payment_status: PaymentStatus;
  payment_date: string | null;
}

export interface Totals { count: number; ttc: number; ht: number; vat: number }
export interface CashTotals { count: number; ttc: number }

export interface RevenueSummary {
  asOf: string;
  vatRate: number;
  day: Totals;
  month: Totals;
  year: Totals;
  previousMonth: Totals;
  monthly: ({ month: string } & Totals)[];
  cashed: { day: CashTotals; month: CashTotals; year: CashTotals };
  receivables: { count: number; ttc: number; overdueCount: number; overdueTtc: number; partialCount: number };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Le « Total signé » d'Odoo est toujours TTC : le HT est ramené avec le taux de TVA de l'hôtel (0 = pas de TVA). */
export function splitVat(ttc: number, vatRate: number): { ttc: number; ht: number; vat: number } {
  const ht = vatRate > 0 ? ttc / (1 + vatRate) : ttc;
  return { ttc: round2(ttc), ht: round2(ht), vat: round2(ttc - ht) };
}

const emptyTotals = (): Totals => ({ count: 0, ttc: 0, ht: 0, vat: 0 });
const addTotals = (t: Totals, ttc: number, vatRate: number) => {
  const s = splitVat(ttc, vatRate);
  t.count += 1; t.ttc = round2(t.ttc + s.ttc); t.ht = round2(t.ht + s.ht); t.vat = round2(t.vat + s.vat);
};

function previousMonthKey(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/**
 * CA = factures comptabilisees a la date de facture ; les factures extournees n'en font pas partie.
 * Encaisse = factures « Payée » ou « En paiement » a la date de paiement (pour « Partiellement réglée », Odoo ne donne pas le montant regle :
 * elles restent en creances pour leur montant complet).
 * Creances = « Non payée » + « Partiellement réglée », toutes annees confondues ; echues si la date d'echeance est passee.
 */
export function summarizeRevenue(rows: InvoiceLite[], asOf: string, vatRate: number): RevenueSummary {
  const ym = asOf.slice(0, 7);
  const year = asOf.slice(0, 4);
  const prevYm = previousMonthKey(ym);
  const out: RevenueSummary = {
    asOf, vatRate,
    day: emptyTotals(), month: emptyTotals(), year: emptyTotals(), previousMonth: emptyTotals(),
    monthly: Array.from({ length: 12 }, (_, i) => ({ month: `${year}-${String(i + 1).padStart(2, '0')}`, ...emptyTotals() })),
    cashed: { day: { count: 0, ttc: 0 }, month: { count: 0, ttc: 0 }, year: { count: 0, ttc: 0 } },
    receivables: { count: 0, ttc: 0, overdueCount: 0, overdueTtc: 0, partialCount: 0 },
  };
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.id) { if (seen.has(r.id)) continue; seen.add(r.id); }
    if (r.payment_status === 'reversed') continue;
    const amount = Number(r.amount_ttc);
    if (r.invoice_date <= asOf) {
      if (r.invoice_date === asOf) addTotals(out.day, amount, vatRate);
      if (r.invoice_date.startsWith(ym)) addTotals(out.month, amount, vatRate);
      if (r.invoice_date.startsWith(prevYm)) addTotals(out.previousMonth, amount, vatRate);
      if (r.invoice_date.startsWith(year)) {
        addTotals(out.year, amount, vatRate);
        addTotals(out.monthly[Number(r.invoice_date.slice(5, 7)) - 1], amount, vatRate);
      }
    }
    if ((r.payment_status === 'paid' || r.payment_status === 'in_payment') && r.payment_date && r.payment_date <= asOf) {
      const add = (c: CashTotals) => { c.count += 1; c.ttc = round2(c.ttc + amount); };
      if (r.payment_date === asOf) add(out.cashed.day);
      if (r.payment_date.startsWith(ym)) add(out.cashed.month);
      if (r.payment_date.startsWith(year)) add(out.cashed.year);
    }
    if ((r.payment_status === 'unpaid' || r.payment_status === 'partial') && r.invoice_date <= asOf) {
      out.receivables.count += 1; out.receivables.ttc = round2(out.receivables.ttc + amount);
      if (r.payment_status === 'partial') out.receivables.partialCount += 1;
      if (r.due_date && r.due_date < asOf) { out.receivables.overdueCount += 1; out.receivables.overdueTtc = round2(out.receivables.overdueTtc + amount); }
    }
  }
  return out;
}

/** Date de la derniere facture connue jusqu'a `asOf` (null s'il n'y en a aucune). */
export function lastInvoiceDateOf(rows: { invoice_date: string }[], asOf: string): string | null {
  return rows.reduce<string | null>((m, r) => (r.invoice_date <= asOf && (m === null || r.invoice_date > m) ? r.invoice_date : m), null);
}

/** Les factures sont importees a la main : si la derniere facture est anterieure a la date demandee, on retient ce dernier jour reel plutot qu'un « CA du jour » a zero trompeur. */
export function effectiveAsOf(lastInvoiceDate: string | null, asOf: string): string {
  return lastInvoiceDate && lastInvoiceDate < asOf ? lastInvoiceDate : asOf;
}
