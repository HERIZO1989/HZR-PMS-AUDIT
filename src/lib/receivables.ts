// Suivi des creances clients : anciennete, concentration par client, message de relance.

/** À rapprocher : numéro de facture en double ET le client a déjà payé une autre facture à ±60 jours (consommations restaurant/buanderie probablement réglées avec le séjour).
 *  double_sans_paiement : numéro en double mais aucun paiement proche : reste une créance, à vérifier. */
export type ReconcileTag = 'a_rapprocher' | 'double_sans_paiement' | null;

export interface OpenInvoice {
  invoice_number: string | null;
  partner_name: string;
  invoice_date: string;
  due_date: string | null;
  amount_ttc: number;
  payment_status: string;
  reconcile?: ReconcileTag;
}

export const RECONCILE_WINDOW_DAYS = 60;

interface TaggableInvoice { invoice_number: string | null; partner_name: string; invoice_date: string; payment_status: string }

/** Etiquette chaque facture « Non payée » dont le numéro est porté par une autre facture. Les autres factures reçoivent null. */
export function tagInvoices<T extends TaggableInvoice>(all: T[]): (T & { reconcile: ReconcileTag })[] {
  const perNumber = new Map<string, number>();
  for (const i of all) if (i.invoice_number) perNumber.set(i.invoice_number, (perNumber.get(i.invoice_number) ?? 0) + 1);
  const paidDays = new Map<string, number[]>();
  for (const i of all) {
    if (i.payment_status !== 'paid' && i.payment_status !== 'in_payment') continue;
    const list = paidDays.get(i.partner_name) ?? [];
    list.push(Date.parse(`${i.invoice_date}T00:00:00Z`) / 86400000);
    paidDays.set(i.partner_name, list);
  }
  for (const list of paidDays.values()) list.sort((a, b) => a - b);
  const nearPaid = (partner: string, date: string) => {
    const list = paidDays.get(partner);
    if (!list) return false;
    const d = Date.parse(`${date}T00:00:00Z`) / 86400000;
    let lo = 0, hi = list.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid] < d) lo = mid + 1; else hi = mid - 1;
    }
    return (lo < list.length && list[lo] - d <= RECONCILE_WINDOW_DAYS) || (lo > 0 && d - list[lo - 1] <= RECONCILE_WINDOW_DAYS);
  };
  return all.map((i) => {
    if (i.payment_status !== 'unpaid' || !i.invoice_number || (perNumber.get(i.invoice_number) ?? 0) < 2) return { ...i, reconcile: null };
    return { ...i, reconcile: nearPaid(i.partner_name, i.invoice_date) ? 'a_rapprocher' : 'double_sans_paiement' };
  });
}

export const BUCKETS = [
  { code: 'd0_30', label: '0-30 j', max: 30 },
  { code: 'd31_60', label: '31-60 j', max: 60 },
  { code: 'd61_90', label: '61-90 j', max: 90 },
  { code: 'd91_180', label: '91-180 j', max: 180 },
  { code: 'd180p', label: '+ de 180 j', max: Infinity },
] as const;
export type BucketCode = (typeof BUCKETS)[number]['code'];

export interface BucketTotal { code: BucketCode; label: string; count: number; amount: number }
export interface ClientRow {
  client: string;
  count: number;
  total: number;
  over90: number;
  overdue: number;
  oldest: string;
  toReconcile: number;
  buckets: Record<BucketCode, number>;
}
export interface ReceivablesSummary {
  today: string;
  count: number;
  total: number;
  overdue: number;
  overdueCount: number;
  over90: number;
  clientCount: number;
  top20Share: number;
  /** Creances « à rapprocher » (probablement reglees) et creances fiables (le reste). */
  toReconcile: { count: number; amount: number };
  reliable: { count: number; amount: number };
  buckets: BucketTotal[];
  clients: ClientRow[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
export const bucketOf = (days: number): BucketCode => (BUCKETS.find((b) => days <= b.max) ?? BUCKETS[BUCKETS.length - 1]).code;

/** Anciennete = jours depuis la date de facture. Echue = date d'echeance depassee (a defaut, la date de facture). Les creances partielles comptent pour leur montant complet (le montant regle n'est pas connu). */
export function buildReceivables(invoices: OpenInvoice[], today: string): ReceivablesSummary {
  const buckets: BucketTotal[] = BUCKETS.map((b) => ({ code: b.code, label: b.label, count: 0, amount: 0 }));
  const clients = new Map<string, ClientRow>();
  let total = 0, overdue = 0, overdueCount = 0, over90 = 0, count = 0;
  const rec = { count: 0, amount: 0 };

  for (const i of invoices) {
    if (i.payment_status !== 'unpaid' && i.payment_status !== 'partial') continue;
    if (i.invoice_date > today) continue;
    const amount = Number(i.amount_ttc);
    const age = daysBetween(i.invoice_date, today);
    const code = bucketOf(age);
    const isOverdue = (i.due_date ?? i.invoice_date) < today;

    count += 1; total += amount;
    const b = buckets.find((x) => x.code === code)!; b.count += 1; b.amount += amount;
    if (isOverdue) { overdue += amount; overdueCount += 1; }
    if (age > 90) over90 += amount;

    const toRec = i.reconcile === 'a_rapprocher';
    if (toRec) { rec.count += 1; rec.amount += amount; }
    const c = clients.get(i.partner_name) ?? { client: i.partner_name, count: 0, total: 0, over90: 0, overdue: 0, oldest: i.invoice_date, toReconcile: 0, buckets: { d0_30: 0, d31_60: 0, d61_90: 0, d91_180: 0, d180p: 0 } };
    c.count += 1; c.total += amount; c.buckets[code] += amount;
    if (toRec) c.toReconcile += amount;
    if (age > 90) c.over90 += amount;
    if (isOverdue) c.overdue += amount;
    if (i.invoice_date < c.oldest) c.oldest = i.invoice_date;
    clients.set(i.partner_name, c);
  }

  const rows = [...clients.values()].map((c) => ({
    ...c, total: round2(c.total), over90: round2(c.over90), overdue: round2(c.overdue), toReconcile: round2(c.toReconcile),
    buckets: Object.fromEntries(Object.entries(c.buckets).map(([k, v]) => [k, round2(v)])) as Record<BucketCode, number>,
  })).sort((a, b) => b.total - a.total || a.client.localeCompare(b.client));
  const top20 = rows.slice(0, 20).reduce((t, r) => t + r.total, 0);

  return {
    today, count, total: round2(total), overdue: round2(overdue), overdueCount, over90: round2(over90),
    clientCount: rows.length, top20Share: total > 0 ? top20 / total : 0,
    toReconcile: { count: rec.count, amount: round2(rec.amount) }, reliable: { count: count - rec.count, amount: round2(total - rec.amount) },
    buckets: buckets.map((b) => ({ ...b, amount: round2(b.amount) })), clients: rows,
  };
}

const money = (n: number, currency: string) => `${Math.round(n).toLocaleString('fr-FR').replace(/[\u202f\u00a0]/g, ' ')} ${currency === 'MGA' ? 'Ar' : currency}`;
const dmy = (d: string) => d.split('-').reverse().join('/');

/** Message de relance courtois, pret a copier (WhatsApp ou e-mail) : factures a reclamer (les plus anciennes d'abord, sans celles a rapprocher) et total. */
export function buildReminder(client: string, invoices: OpenInvoice[], hotelName: string, currency: string, today: string, maxLines = 15): string {
  // Les factures « à rapprocher » (probablement deja reglees) ne sont jamais reclamees au client.
  const open = invoices.filter((i) => (i.payment_status === 'unpaid' || i.payment_status === 'partial') && i.reconcile !== 'a_rapprocher')
    .sort((a, b) => a.invoice_date.localeCompare(b.invoice_date) || (a.invoice_number ?? '').localeCompare(b.invoice_number ?? ''));
  const total = open.reduce((t, i) => t + Number(i.amount_ttc), 0);
  const lines = open.slice(0, maxLines).map((i) => `- ${i.invoice_number ?? 'facture'} du ${dmy(i.invoice_date)} : ${money(Number(i.amount_ttc), currency)}`);
  const more = open.length > maxLines ? [`- … et ${open.length - maxLines} autre(s) facture(s)`] : [];
  return [
    `Bonjour,`, '',
    `Sauf erreur de notre part, ${open.length > 1 ? `${open.length} factures de ${hotelName} restent` : `une facture de ${hotelName} reste`} à régler à la date du ${dmy(today)} pour ${client} :`, '',
    ...lines, ...more, '',
    `Total à régler : ${money(total, currency)}.`, '',
    `Si le règlement a déjà été effectué, merci de nous en transmettre la preuve afin que nous mettions à jour votre compte. Sinon, pourriez-vous nous indiquer la date de paiement prévue ?`, '',
    `Merci d'avance et bien cordialement,`, hotelName,
  ].join('\n');
}
