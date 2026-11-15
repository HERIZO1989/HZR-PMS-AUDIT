// Paiements du jour en temps reel : statut de paiement de chaque sejour (paye, partiel, non paye, a facturer) avec son acompte, et caisse du jour.
// Source : folios, paiements et acomptes du PMS. Seuls les paiements enregistres dans le PMS apparaissent.

export type PayStatus = 'paid' | 'partial' | 'unpaid' | 'to_bill';
export type StayGroup = 'arrival' | 'inhouse' | 'departure';

export const PAY_STATUS_LABEL: Record<PayStatus, string> = { paid: 'Payé', partial: 'Partiellement payé', unpaid: 'Non payé', to_bill: 'À facturer' };

/** Tolerance d'arrondi : un solde inferieur a 1 Ar est considere comme solde. */
export const BALANCE_TOLERANCE = 1;

export interface StayInput {
  reservationId: string;
  confirmationNumber: string;
  guest: string;
  room: string | null;
  status: string;
  arrivalDate: string;
  departureDate: string;
  /** Montant total du sejour (reservation), utilise tant qu'aucun folio n'existe. */
  totalAmount: number;
  hasFolio: boolean;
  /** Total facture sur le folio (nuitees, taxes, frais) : solde + paiements encaisses. */
  charges: number;
  /** Paiements encaisses sur le folio (acomptes reportes compris). */
  paid: number;
  /** Acomptes recus mais pas encore reportes sur un folio. */
  depositsHeld: number;
  /** Acomptes deja reportes sur le folio (compris dans « paid »). */
  depositsApplied: number;
}

export interface StayPayment extends StayInput {
  group: StayGroup;
  /** Montant a payer pris en reference : facture du folio, ou montant du sejour avant le check-in. */
  due: number;
  /** Montant deja regle (paiements du folio, ou acomptes avant le check-in). */
  received: number;
  balance: number;
  deposit: number;
  payStatus: PayStatus;
}

export const groupOf = (s: Pick<StayInput, 'arrivalDate' | 'departureDate'>, date: string): StayGroup =>
  s.arrivalDate === date ? 'arrival' : s.departureDate === date ? 'departure' : 'inhouse';

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Classe un sejour :
 * - avec folio et facture > 0 : paye si le solde est nul, partiel si une partie est reglee, non paye sinon ;
 * - avec folio mais rien de facture : « a facturer » (la nuitee n'est pas encore posee) ;
 * - sans folio (client pas encore enregistre) : le montant du sejour est compare aux acomptes recus.
 */
export function classifyStay(s: StayInput, date: string): StayPayment {
  const deposit = r2(s.depositsHeld + s.depositsApplied);
  let due: number; let received: number;
  if (s.hasFolio) { due = r2(s.charges); received = r2(s.paid); }
  else { due = r2(s.totalAmount); received = r2(s.depositsHeld); }
  const balance = r2(due - received);

  let payStatus: PayStatus;
  if (due <= BALANCE_TOLERANCE) payStatus = 'to_bill';
  else if (balance <= BALANCE_TOLERANCE) payStatus = 'paid';
  else if (received > 0) payStatus = 'partial';
  else payStatus = 'unpaid';
  return { ...s, group: groupOf(s, date), due, received, balance, deposit, payStatus };
}

export interface OverviewSummary {
  count: number;
  byStatus: Record<PayStatus, { count: number; balance: number }>;
  due: number;
  received: number;
  balance: number;
  deposits: number;
}

export function summarizeStays(rows: StayPayment[]): OverviewSummary {
  const byStatus: OverviewSummary['byStatus'] = { paid: { count: 0, balance: 0 }, partial: { count: 0, balance: 0 }, unpaid: { count: 0, balance: 0 }, to_bill: { count: 0, balance: 0 } };
  let due = 0, received = 0, balance = 0, deposits = 0;
  for (const r of rows) {
    byStatus[r.payStatus].count += 1;
    byStatus[r.payStatus].balance = r2(byStatus[r.payStatus].balance + Math.max(0, r.balance));
    due += r.due; received += r.received; balance += Math.max(0, r.balance); deposits += r.deposit;
  }
  return { count: rows.length, byStatus, due: r2(due), received: r2(received), balance: r2(balance), deposits: r2(deposits) };
}

export interface CashPayment { method: string; amount: number; reference: string | null; at: string }
export interface CashDeposit { method: string; amount: number; at: string }
export interface CashSummary {
  byMethod: { method: string; count: number; amount: number }[];
  payments: { count: number; amount: number };
  deposits: { count: number; amount: number };
  total: number;
}

/**
 * Caisse du jour : paiements captures ce jour (hors acomptes reportes au check-in, qui sont comptes a leur date de reception) + acomptes recus ce jour.
 * `localDay` convertit un horodatage en date locale de l'hotel.
 */
export function summarizeCash(payments: CashPayment[], deposits: CashDeposit[], date: string, localDay: (iso: string) => string): CashSummary {
  const methods = new Map<string, { count: number; amount: number }>();
  const add = (m: string, amount: number) => { const c = methods.get(m) ?? { count: 0, amount: 0 }; c.count += 1; c.amount = r2(c.amount + amount); methods.set(m, c); };
  let pc = 0, pa = 0, dc = 0, da = 0;
  for (const p of payments) {
    if (localDay(p.at) !== date || (p.reference ?? '').startsWith('ACOMPTE')) continue;
    add(p.method, p.amount); pc += 1; pa += p.amount;
  }
  for (const d of deposits) {
    if (localDay(d.at) !== date) continue;
    add(d.method, d.amount); dc += 1; da += d.amount;
  }
  return {
    byMethod: [...methods.entries()].map(([method, v]) => ({ method, ...v })).sort((a, b) => b.amount - a.amount),
    payments: { count: pc, amount: r2(pa) }, deposits: { count: dc, amount: r2(da) }, total: r2(pa + da),
  };
}
