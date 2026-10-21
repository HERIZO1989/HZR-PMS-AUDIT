import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { createHash } from 'crypto';
import { parseExpenseDate } from './expenses';
import type { PaymentStatus } from './invoices';

// Export Odoo « Pièces comptables » (account.move) : Numéro, Date d'échéance, Nom d'affichage du partenaire de la facture,
// Date de facturation, Conditions de paiement, Total signé, Statut du paiement, Date de Paiement, Statut.

export const MAX_INVOICE_ROWS = 20000;

const norm = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[°º]/g, '').trim().toLowerCase();

const NUMBER_COLS = ['numero'];
const PARTNER_COLS = ["nom d'affichage du partenaire de la facture", 'partenaire de la facture', 'partenaire', 'client'];
const DATE_COLS = ['date de facturation', 'date de la facture', 'date de facture'];
const DUE_COLS = ["date d'echeance", 'echeance'];
const TERMS_COLS = ['conditions de paiement'];
const TOTAL_COLS = ['total signe', 'total'];
const PAY_STATUS_COLS = ['statut du paiement'];
const PAY_DATE_COLS = ['date de paiement'];
const STATUS_COLS = ['statut'];

/** Seules les factures comptabilisées sont du CA ; Annulée, Brouillon et tout autre statut sont écartés et comptés. */
const POSTED = 'comptabilise';

const PAYMENT_STATUS_MAP: Record<string, PaymentStatus> = {
  'non paye': 'unpaid',
  'en paiement': 'in_payment',
  'partiellement regle': 'partial',
  'paye': 'paid',
  'extourne': 'reversed',
};

function pick(row: Record<string, unknown>, names: string[]): unknown {
  const byKey = new Map(Object.entries(row).map(([k, v]) => [norm(k), v]));
  for (const n of names) {
    const v = byKey.get(n);
    if (v !== undefined && String(v).trim() !== '') return v;
  }
  return undefined;
}

export function isOdooInvoiceHeaders(keys: string[]): boolean {
  const k = new Set(keys.map(norm));
  return NUMBER_COLS.some((c) => k.has(c)) && TOTAL_COLS.some((c) => k.has(c)) && k.has('statut du paiement') && k.has('statut');
}

/** Lit un classeur Excel ou un CSV. Les dates Excel sont lues en numéros de série bruts : le jour affiché est conservé, sans décalage de fuseau. */
export function readInvoiceRows(buffer: Buffer, fileName: string): Record<string, unknown>[] {
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (ext === 'csv' || ext === 'txt') {
    return Papa.parse<Record<string, unknown>>(buffer.toString('utf8'), { header: true, skipEmptyLines: true }).data;
  }
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[name], { defval: '', raw: true });
    if (rows.length > 0 && isOdooInvoiceHeaders(Object.keys(rows[0]))) return rows;
  }
  return [];
}

export interface PreparedInvoice {
  invoice_number: string | null;
  partner_name: string;
  invoice_date: string;
  due_date: string | null;
  payment_terms: string | null;
  amount_ttc: number;
  payment_status: PaymentStatus;
  payment_date: string | null;
  /** Clé d'idempotence : le numéro Odoo n'est pas unique, donc numéro + client + date + montant. */
  key: string;
}

export interface PreparedInvoices {
  valid: PreparedInvoice[];
  invalid: { row: number; errors: string[] }[];
  blankRows: number;
  duplicatesInFile: number;
  skippedByStatus: Record<string, number>;
}

const toNumber = (v: unknown): number =>
  typeof v === 'number' ? v : Number(String(v ?? '').replace(/[\s\u00a0\u202f]/g, '').replace(',', '.'));

export function invoiceKey(number: string | null, partner: string, date: string, amount: number): string {
  return createHash('sha1').update(`odoo|${(number ?? '').toLowerCase()}|${partner.trim().toLowerCase()}|${date}|${amount.toFixed(2)}`).digest('hex');
}

export function prepareInvoiceRows(raw: Record<string, unknown>[], today: string = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10)): PreparedInvoices {
  const out: PreparedInvoices = { valid: [], invalid: [], blankRows: 0, duplicatesInFile: 0, skippedByStatus: {} };
  const seen = new Set<string>();
  raw.forEach((r, i) => {
    const numberRaw = String(pick(r, NUMBER_COLS) ?? '').trim();
    const partnerRaw = String(pick(r, PARTNER_COLS) ?? '').replace(/\s+/g, ' ').trim();
    const totalRaw = pick(r, TOTAL_COLS);
    const statusLabel = String(pick(r, STATUS_COLS) ?? '').trim();
    if (!numberRaw && !partnerRaw && totalRaw === undefined && !statusLabel) { out.blankRows++; return; }
    if (norm(statusLabel) !== POSTED) {
      const label = statusLabel || '(sans statut)';
      out.skippedByStatus[label] = (out.skippedByStatus[label] ?? 0) + 1;
      return;
    }

    const errors: string[] = [];
    if (!partnerRaw) errors.push('Client manquant');
    const invoiceDate = parseExpenseDate(pick(r, DATE_COLS));
    if (!invoiceDate) errors.push('Date de facturation invalide');
    else if (invoiceDate > today) errors.push('Date de facturation dans le futur');
    const amount = totalRaw === undefined ? NaN : toNumber(totalRaw);
    if (!Number.isFinite(amount) || amount <= 0) errors.push('Total invalide ou vide');
    const payStatus = PAYMENT_STATUS_MAP[norm(String(pick(r, PAY_STATUS_COLS) ?? ''))];
    if (!payStatus) errors.push(`Statut du paiement inconnu : « ${String(pick(r, PAY_STATUS_COLS) ?? '')} »`);
    if (errors.length > 0 || !invoiceDate || !payStatus) { out.invalid.push({ row: i + 2, errors }); return; }

    const number = numberRaw && numberRaw !== '/' ? numberRaw.slice(0, 60) : null;
    const terms = String(pick(r, TERMS_COLS) ?? '').trim();
    const key = invoiceKey(number, partnerRaw, invoiceDate, amount);
    if (seen.has(key)) { out.duplicatesInFile++; return; }
    seen.add(key);
    const payDate = parseExpenseDate(pick(r, PAY_DATE_COLS));
    out.valid.push({
      invoice_number: number,
      partner_name: partnerRaw.slice(0, 200),
      invoice_date: invoiceDate,
      due_date: parseExpenseDate(pick(r, DUE_COLS)),
      payment_terms: terms ? terms.slice(0, 100) : null,
      amount_ttc: Math.round(amount * 100) / 100,
      payment_status: payStatus,
      payment_date: payStatus === 'unpaid' ? null : payDate,
      key,
    });
  });
  return out;
}
