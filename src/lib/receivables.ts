// Suivi des creances clients : anciennete, concentration par client, message de relance.

export interface OpenInvoice {
  invoice_number: string | null;
  partner_name: string;
  invoice_date: string;
  due_date: string | null;
  amount_ttc: number;
  payment_status: string;
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

    const c = clients.get(i.partner_name) ?? { client: i.partner_name, count: 0, total: 0, over90: 0, overdue: 0, oldest: i.invoice_date, buckets: { d0_30: 0, d31_60: 0, d61_90: 0, d91_180: 0, d180p: 0 } };
    c.count += 1; c.total += amount; c.buckets[code] += amount;
    if (age > 90) c.over90 += amount;
    if (isOverdue) c.overdue += amount;
    if (i.invoice_date < c.oldest) c.oldest = i.invoice_date;
    clients.set(i.partner_name, c);
  }

  const rows = [...clients.values()].map((c) => ({
    ...c, total: round2(c.total), over90: round2(c.over90), overdue: round2(c.overdue),
    buckets: Object.fromEntries(Object.entries(c.buckets).map(([k, v]) => [k, round2(v)])) as Record<BucketCode, number>,
  })).sort((a, b) => b.total - a.total || a.client.localeCompare(b.client));
  const top20 = rows.slice(0, 20).reduce((t, r) => t + r.total, 0);

  return {
    today, count, total: round2(total), overdue: round2(overdue), overdueCount, over90: round2(over90),
    clientCount: rows.length, top20Share: total > 0 ? top20 / total : 0,
    buckets: buckets.map((b) => ({ ...b, amount: round2(b.amount) })), clients: rows,
  };
}

const money = (n: number, currency: string) => `${Math.round(n).toLocaleString('fr-FR').replace(/[\u202f\u00a0]/g, ' ')} ${currency === 'MGA' ? 'Ar' : currency}`;
const dmy = (d: string) => d.split('-').reverse().join('/');

/** Message de relance courtois, pret a copier (WhatsApp ou e-mail) : liste des factures echues (les plus anciennes d'abord) et total. */
export function buildReminder(client: string, invoices: OpenInvoice[], hotelName: string, currency: string, today: string, maxLines = 15): string {
  const open = invoices.filter((i) => i.payment_status === 'unpaid' || i.payment_status === 'partial')
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
