// Performance mensuelle : occupation, ADR, RevPAR (sejours), TRevPAR et GOP (CA facture HT et depenses HT).
// Hors taxe partout : les factures Odoo sont TTC (ramenees HT avec le taux de TVA de l'hotel), les indicateurs d'hebergement du PMS sont deja HT.

export interface SnapshotLite { business_date: string; rooms_available: number; rooms_occupied: number; total_room_revenue: number }
export interface InvoiceLiteForPerf { invoice_date: string; amount_ttc: number }
export interface ExpenseLiteForPerf { expense_date: string; amount_ht: number; category: string }

export interface PerfRow {
  month: string;
  days: number;
  roomsAvailable: number;
  roomsOccupied: number;
  occupancy: number;
  adr: number;
  revpar: number;
  /** Revenu hebergement des sejours (HT). */
  roomRevenue: number;
  /** CA des factures comptabilisees (HT) : base du TRevPAR et du GOP. */
  billedRevenue: number;
  /** CA facture moins hebergement : revenus hors chambre, mais aussi decalages de facturation (peut etre negatif sur un mois). */
  billedMinusRooms: number;
  trevpar: number;
  expenses: number;
  personnelExpenses: number;
  gop: number;
  goppar: number;
  gopMargin: number;
  /** Mois en cours ou incomplet : jours de calcul inferieurs aux jours du mois. */
  partial: boolean;
}

export interface Performance { months: PerfRow[]; total: PerfRow }

const round2 = (n: number) => Math.round(n * 100) / 100;
const daysInMonth = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };

function finish(month: string, a: { days: number; avail: number; occ: number; room: number; billed: number; exp: number; staff: number }, partial: boolean): PerfRow {
  const gop = a.billed - a.exp;
  return {
    month, days: a.days, roomsAvailable: a.avail, roomsOccupied: a.occ,
    occupancy: a.avail > 0 ? a.occ / a.avail : 0,
    adr: a.occ > 0 ? round2(a.room / a.occ) : 0,
    revpar: a.avail > 0 ? round2(a.room / a.avail) : 0,
    roomRevenue: round2(a.room), billedRevenue: round2(a.billed), billedMinusRooms: round2(a.billed - a.room),
    trevpar: a.avail > 0 ? round2(a.billed / a.avail) : 0,
    expenses: round2(a.exp), personnelExpenses: round2(a.staff),
    gop: round2(gop), goppar: a.avail > 0 ? round2(gop / a.avail) : 0,
    gopMargin: a.billed > 0 ? gop / a.billed : 0,
    partial,
  };
}

/**
 * Regroupe par mois (du 1er janvier a la date `asOf` de l'annee) :
 * - nuitees et hebergement : instantanes KPI du PMS (jours <= asOf) ;
 * - CA : factures comptabilisees, non extournees, a la date de facture, ramenees HT ;
 * - depenses : approuvees, HT, a la date de depense.
 * Les mois sans aucune donnee ne sont pas listes.
 */
export function computePerformance(
  input: { snapshots: SnapshotLite[]; invoices: InvoiceLiteForPerf[]; expenses: ExpenseLiteForPerf[]; vatRate: number },
  year: string, asOf: string,
): Performance {
  const acc = new Map<string, { days: number; avail: number; occ: number; room: number; billed: number; exp: number; staff: number }>();
  const get = (m: string) => {
    let a = acc.get(m);
    if (!a) { a = { days: 0, avail: 0, occ: 0, room: 0, billed: 0, exp: 0, staff: 0 }; acc.set(m, a); }
    return a;
  };
  const inScope = (d: string) => d.startsWith(year) && d <= asOf;
  const vat = input.vatRate > 0 ? 1 + input.vatRate : 1;

  for (const s of input.snapshots) {
    if (!inScope(s.business_date)) continue;
    const a = get(s.business_date.slice(0, 7));
    a.days += 1; a.avail += Number(s.rooms_available); a.occ += Number(s.rooms_occupied); a.room += Number(s.total_room_revenue);
  }
  for (const i of input.invoices) {
    if (inScope(i.invoice_date)) get(i.invoice_date.slice(0, 7)).billed += Number(i.amount_ttc) / vat;
  }
  for (const e of input.expenses) {
    if (!inScope(e.expense_date)) continue;
    const a = get(e.expense_date.slice(0, 7));
    a.exp += Number(e.amount_ht);
    if (e.category === 'personnel') a.staff += Number(e.amount_ht);
  }

  const keys = [...acc.keys()].sort();
  const months = keys.map((m) => {
    const a = acc.get(m)!;
    const expected = m === asOf.slice(0, 7) ? Number(asOf.slice(8, 10)) : daysInMonth(m);
    return finish(m, a, a.days < expected);
  });
  const sum = { days: 0, avail: 0, occ: 0, room: 0, billed: 0, exp: 0, staff: 0 };
  for (const a of acc.values()) { sum.days += a.days; sum.avail += a.avail; sum.occ += a.occ; sum.room += a.room; sum.billed += a.billed; sum.exp += a.exp; sum.staff += a.staff; }
  return { months, total: finish('total', sum, months.some((m) => m.partial)) };
}
