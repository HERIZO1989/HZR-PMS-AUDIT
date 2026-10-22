// Acomptes sur reservation : libelles, validation et synthese. Un acompte est une avance, pas du CA.

export const DEPOSIT_METHODS = [
  { code: 'cash', label: 'Espèces' },
  { code: 'card', label: 'Carte' },
  { code: 'bank_transfer', label: 'Virement' },
  { code: 'online', label: 'Mobile money / en ligne' },
  { code: 'other', label: 'Autre' },
] as const;
export type DepositMethod = (typeof DEPOSIT_METHODS)[number]['code'];

export const DEPOSIT_STATUSES = [
  { code: 'held', label: 'En attente' },
  { code: 'applied', label: 'Reporté sur le folio' },
  { code: 'refunded', label: 'Remboursé' },
  { code: 'forfeited', label: 'Conservé' },
] as const;
export type DepositStatus = (typeof DEPOSIT_STATUSES)[number]['code'];

export type ValidDeposit = { amount: number; method: DepositMethod; reference: string | null };

/** Valide la saisie d'un acompte (le montant ne peut pas dépasser le séjour : cette règle est vérifiée en base, sous verrou). */
export function validateDeposit(input: Record<string, unknown>): { ok: true; value: ValidDeposit } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const amount = typeof input.amount === 'number' ? input.amount : Number(String(input.amount ?? '').replace(/[\s\u00a0\u202f]/g, '').replace(',', '.'));
  if (!Number.isFinite(amount) || amount <= 0) errors.push("Montant de l'acompte invalide");
  const method = DEPOSIT_METHODS.find((m) => m.code === input.method)?.code;
  if (!method) errors.push('Mode de paiement invalide');
  const reference = typeof input.reference === 'string' && input.reference.trim() ? input.reference.trim().slice(0, 100) : null;
  if (errors.length > 0 || !method) return { ok: false, errors };
  return { ok: true, value: { amount: Math.round(amount * 100) / 100, method, reference } };
}

export interface DepositLite {
  amount: number;
  status: DepositStatus;
  received_at: string;
  resolved_at: string | null;
  reservation_status: string | null;
}
export interface Sum { count: number; amount: number }
export interface DepositSummary {
  received: { day: Sum; month: Sum; year: Sum };
  /** En attente d'arrivée : réservation encore tentative ou confirmée. */
  held: Sum;
  /** À traiter : annulation ou no-show, à rembourser ou à conserver. */
  toResolve: Sum;
  /** À reporter : client arrivé mais acompte non reporté sur le folio (à relancer). */
  toApply: Sum;
  refundedYear: Sum;
  forfeitedYear: Sum;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const add = (s: Sum, amount: number) => { s.count += 1; s.amount = round2(s.amount + amount); };
const zero = (): Sum => ({ count: 0, amount: 0 });
/** Date calendaire à Madagascar (UTC+3), comme le reste du PMS. */
export const localDate = (iso: string): string => new Date(new Date(iso).getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10);

export function summarizeDeposits(rows: DepositLite[], asOf: string): DepositSummary {
  const out: DepositSummary = {
    received: { day: zero(), month: zero(), year: zero() }, held: zero(), toResolve: zero(), toApply: zero(), refundedYear: zero(), forfeitedYear: zero(),
  };
  const ym = asOf.slice(0, 7);
  const year = asOf.slice(0, 4);
  for (const r of rows) {
    const amount = Number(r.amount);
    const received = localDate(r.received_at);
    if (received <= asOf) {
      if (received === asOf) add(out.received.day, amount);
      if (received.startsWith(ym)) add(out.received.month, amount);
      if (received.startsWith(year)) add(out.received.year, amount);
    }
    if (r.status === 'held') {
      if (r.reservation_status === 'tentative' || r.reservation_status === 'confirmed') add(out.held, amount);
      else if (r.reservation_status === 'cancelled' || r.reservation_status === 'no_show') add(out.toResolve, amount);
      else add(out.toApply, amount);
    } else if ((r.status === 'refunded' || r.status === 'forfeited') && r.resolved_at) {
      const resolved = localDate(r.resolved_at);
      if (resolved <= asOf && resolved.startsWith(year)) add(r.status === 'refunded' ? out.refundedYear : out.forfeitedYear, amount);
    }
  }
  return out;
}
