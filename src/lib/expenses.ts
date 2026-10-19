// Module depenses : categories, validation, agregats journaliers et mensuels, indicateurs avec charges (GOP, GOPPAR, CPOR).

export const EXPENSE_CATEGORIES = [
  { code: 'personnel', label: 'Personnel (salaires, charges sociales, primes)' },
  { code: 'energy', label: 'Énergie (électricité, eau, gaz, carburant groupe)' },
  { code: 'laundry', label: 'Blanchisserie et linge' },
  { code: 'supplies', label: "Produits d'accueil et d'entretien" },
  { code: 'food', label: 'Petit-déjeuner et restauration (achats)' },
  { code: 'maintenance', label: 'Maintenance et réparations' },
  { code: 'commissions', label: 'Commissions et marketing (agences, OTA, publicité)' },
  { code: 'office', label: 'Fournitures et frais de bureau' },
  { code: 'telecom', label: 'Télécom et internet' },
  { code: 'insurance', label: 'Assurances' },
  { code: 'taxes', label: 'Taxes et impôts (hors TVA)' },
  { code: 'bank_fees', label: 'Frais bancaires' },
  { code: 'other', label: 'Autres dépenses' },
] as const;

export const PAYMENT_METHODS = [
  { code: 'cash', label: 'Espèces' },
  { code: 'mobile_money', label: 'Mobile money' },
  { code: 'transfer', label: 'Virement' },
  { code: 'cheque', label: 'Chèque' },
  { code: 'card', label: 'Carte' },
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]['code'];
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]['code'];
export type ExpenseStatus = 'pending' | 'approved' | 'rejected';

export interface ValidExpense {
  expense_date: string;
  category: ExpenseCategory;
  description: string | null;
  supplier: string | null;
  document_number: string | null;
  payment_method: PaymentMethod;
  amount_ttc: number;
  vat_deductible: number;
}

const norm = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Reconnait une categorie par son code ou son libelle (sans tenir compte des accents ni de la casse). */
export function categoryFromLabel(value: unknown): ExpenseCategory | null {
  const v = norm(String(value ?? ''));
  if (!v) return null;
  const hit = EXPENSE_CATEGORIES.find((c) => c.code === v || norm(c.label) === v);
  return hit ? hit.code : null;
}

export function paymentMethodFromLabel(value: unknown): PaymentMethod | null {
  const v = norm(String(value ?? ''));
  if (!v) return 'cash';
  const hit = PAYMENT_METHODS.find((p) => p.code === v || norm(p.label) === v);
  return hit ? hit.code : null;
}

function parseAmount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const s = String(value ?? '').replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Date au format AAAA-MM-JJ ; accepte aussi JJ/MM/AAAA, un objet Date ou un numero de serie Excel. */
export function parseExpenseDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    // Les dates Excel arrivent a minuit UTC ou local : on garde le jour calendaire affiche.
    const d = new Date(value.getTime() + 12 * 3600 * 1000);
    return d.toISOString().slice(0, 10);
  }
  if (typeof value === 'number' && value > 36526 && value < 80000) {
    return new Date(Math.round((value - 25569) * 86400 * 1000)).toISOString().slice(0, 10);
  }
  const s = String(value ?? '').trim();
  let y: number, m: number, d: number;
  let hit = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (hit) { y = +hit[1]; m = +hit[2]; d = +hit[3]; }
  else if ((hit = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) { d = +hit[1]; m = +hit[2]; y = +hit[3]; }
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/** Valide une depense saisie. today : AAAA-MM-JJ (une depense datee du futur est refusee). */
export function validateExpense(
  input: Record<string, unknown>,
  today: string = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10)
): { ok: true; value: ValidExpense } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const date = parseExpenseDate(input.expense_date);
  if (!date) errors.push('Date invalide (JJ/MM/AAAA)');
  else if (date > today) errors.push('Une dépense ne peut pas être datée du futur');
  else if (date < '2020-01-01') errors.push('Date trop ancienne');

  const category = categoryFromLabel(input.category);
  if (!category) errors.push('Catégorie inconnue');

  const method = paymentMethodFromLabel(input.payment_method);
  if (!method) errors.push('Mode de paiement inconnu');

  const ttc = parseAmount(input.amount_ttc);
  if (ttc === null || ttc <= 0) errors.push('Montant TTC invalide (supérieur à 0)');
  const vatRaw = input.vat_deductible;
  const vat = vatRaw === undefined || vatRaw === null || String(vatRaw).trim() === '' ? 0 : parseAmount(vatRaw);
  if (vat === null || vat < 0) errors.push('TVA déductible invalide (0 ou plus)');
  else if (ttc !== null && vat > ttc) errors.push('La TVA déductible dépasse le montant TTC');

  const text = (v: unknown, max: number, label: string): string | null => {
    const s = String(v ?? '').trim();
    if (s.length > max) { errors.push(`${label} trop long (${max} caractères maximum)`); return null; }
    return s || null;
  };
  const description = text(input.description, 500, 'Description');
  const supplier = text(input.supplier, 120, 'Fournisseur');
  const document_number = text(input.document_number, 60, 'N° de pièce');

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      expense_date: date!, category: category!, description, supplier, document_number,
      payment_method: method!, amount_ttc: round2(ttc!), vat_deductible: round2(vat ?? 0),
    },
  };
}

/** Cle d'idempotence d'une depense importee : recharger le meme fichier ne cree pas de doublon. */
export function expenseFingerprint(e: ValidExpense): string {
  return [e.expense_date, e.category, e.amount_ttc, e.vat_deductible, (e.supplier ?? '').toLowerCase(), (e.document_number ?? '').toLowerCase(), (e.description ?? '').toLowerCase()].join('|');
}

export interface ExpenseRow {
  expense_date: string;
  category: string;
  amount_ttc: number | string;
  amount_ht: number | string;
  status: ExpenseStatus;
}

export interface ExpenseSummary {
  approved: { count: number; ht: number; ttc: number };
  pending: { count: number; ht: number; ttc: number };
  rejected: { count: number };
  byDay: { date: string; ht: number; ttc: number }[];
  byMonth: { month: string; ht: number; ttc: number }[];
  byCategory: { category: string; ht: number; share: number }[];
}

/** Les agregats (jour, mois, categorie) ne comptent que les depenses approuvees ; les depenses en attente sont totalisees a part. */
export function summarizeExpenses(rows: ExpenseRow[]): ExpenseSummary {
  const out: ExpenseSummary = { approved: { count: 0, ht: 0, ttc: 0 }, pending: { count: 0, ht: 0, ttc: 0 }, rejected: { count: 0 }, byDay: [], byMonth: [], byCategory: [] };
  const day = new Map<string, { ht: number; ttc: number }>();
  const month = new Map<string, { ht: number; ttc: number }>();
  const cat = new Map<string, number>();
  for (const r of rows) {
    const ht = Number(r.amount_ht); const ttc = Number(r.amount_ttc);
    if (r.status === 'rejected') { out.rejected.count++; continue; }
    if (r.status === 'pending') { out.pending.count++; out.pending.ht += ht; out.pending.ttc += ttc; continue; }
    out.approved.count++; out.approved.ht += ht; out.approved.ttc += ttc;
    const d = day.get(r.expense_date) ?? { ht: 0, ttc: 0 }; d.ht += ht; d.ttc += ttc; day.set(r.expense_date, d);
    const mk = r.expense_date.slice(0, 7);
    const m = month.get(mk) ?? { ht: 0, ttc: 0 }; m.ht += ht; m.ttc += ttc; month.set(mk, m);
    cat.set(r.category, (cat.get(r.category) ?? 0) + ht);
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  out.approved.ht = r2(out.approved.ht); out.approved.ttc = r2(out.approved.ttc);
  out.pending.ht = r2(out.pending.ht); out.pending.ttc = r2(out.pending.ttc);
  out.byDay = [...day.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, v]) => ({ date, ht: r2(v.ht), ttc: r2(v.ttc) }));
  out.byMonth = [...month.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([m, v]) => ({ month: m, ht: r2(v.ht), ttc: r2(v.ttc) }));
  out.byCategory = [...cat.entries()].sort(([, a], [, b]) => b - a).map(([category, ht]) => ({ category, ht: r2(ht), share: out.approved.ht > 0 ? ht / out.approved.ht : 0 }));
  return out;
}

export interface ExpenseKpis {
  revenue: number;
  expensesHt: number;
  gop: number;
  gopMargin: number;
  goppar: number;
  cpor: number;
  expensePerAvailableRoom: number;
  expenseRatio: number;
}

/** Indicateurs avec charges : recettes et depenses hors taxe sur la meme periode. */
export function computeExpenseKpis(p: { revenue: number; expensesHt: number; roomsAvailable: number; roomsOccupied: number }): ExpenseKpis {
  const gop = p.revenue - p.expensesHt;
  return {
    revenue: p.revenue,
    expensesHt: p.expensesHt,
    gop,
    gopMargin: p.revenue > 0 ? gop / p.revenue : 0,
    goppar: p.roomsAvailable > 0 ? gop / p.roomsAvailable : 0,
    cpor: p.roomsOccupied > 0 ? p.expensesHt / p.roomsOccupied : 0,
    expensePerAvailableRoom: p.roomsAvailable > 0 ? p.expensesHt / p.roomsAvailable : 0,
    expenseRatio: p.revenue > 0 ? p.expensesHt / p.revenue : 0,
  };
}
