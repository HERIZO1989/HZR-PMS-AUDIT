import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { expenseFingerprint, validateExpense, type ValidExpense } from './expenses';
import { isOdooPurchaseOrderHeaders, mapOdooPurchaseOrderRow } from './odooPurchaseOrders';

export const MAX_EXPENSE_ROWS = 5000;

const COLUMNS: Record<string, string> = {
  date: 'expense_date',
  categorie: 'category',
  description: 'description',
  fournisseur: 'supplier',
  'n de piece': 'document_number',
  'mode de paiement': 'payment_method',
  'montant ttc (ar)': 'amount_ttc',
  'montant ttc': 'amount_ttc',
  'tva deductible (ar)': 'vat_deductible',
  'tva deductible': 'vat_deductible',
};
const norm = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[°º]/g, '').trim().toLowerCase();

/**
 * Lit un classeur Excel ou un CSV. Deux formats sont reconnus :
 * - le classeur fourni (feuille « Journal des dépenses ») ;
 * - l'export Odoo « Bons de commande fournisseur » (Référence de commande, Fournisseur, Total, Statut…).
 */
export function readExpenseRows(buffer: Buffer, fileName: string): Record<string, unknown>[] {
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (ext === 'csv' || ext === 'txt') {
    return Papa.parse<Record<string, unknown>>(buffer.toString('utf8'), { header: true, skipEmptyLines: true }).data;
  }
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const named = wb.SheetNames.find((n) => norm(n).startsWith('journal des depenses'));
  const candidates = named ? [named] : wb.SheetNames;
  for (const name of candidates) {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[name], { defval: '', raw: true });
    if (rows.length === 0) continue;
    const keys = Object.keys(rows[0]);
    if (keys.some((k) => norm(k).startsWith('montant ttc'))) return rows;
    if (isOdooPurchaseOrderHeaders(keys)) {
      // Dates et heures Odoo (ex. 19/10/2026 23:50) : on relit les numéros de série bruts pour garder le jour affiché, sans décalage de fuseau.
      const rawWb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
      return XLSX.utils.sheet_to_json<Record<string, unknown>>(rawWb.Sheets[name], { defval: '', raw: true });
    }
  }
  return [];
}

/** Dépense validée ; sourceKey = clé d'idempotence propre à la source (référence Odoo), needsReview = à valider à la main avant de compter. */
export type PreparedExpense = ValidExpense & { sourceKey?: string; needsReview?: boolean };

export interface PreparedExpenses {
  valid: PreparedExpense[];
  invalid: { row: number; errors: string[] }[];
  blankRows: number;
  duplicatesInFile: number;
  format: 'journal' | 'odoo_po';
  /** Export Odoo : lignes écartées selon leur statut (Annulé, Demande de prix…), avec le nombre par statut. */
  skippedByStatus: Record<string, number>;
  needsReviewCount: number;
}

/** Valide les lignes brutes : lignes vides ignorées, doublons du fichier écartés, erreurs listées avec leur numéro de ligne Excel. */
export function prepareExpenseRows(raw: Record<string, unknown>[], today?: string): PreparedExpenses {
  const odoo = raw.length > 0 && isOdooPurchaseOrderHeaders(Object.keys(raw[0]));
  const out: PreparedExpenses = {
    valid: [], invalid: [], blankRows: 0, duplicatesInFile: 0,
    format: odoo ? 'odoo_po' : 'journal', skippedByStatus: {}, needsReviewCount: 0,
  };
  const seen = new Set<string>();
  raw.forEach((r, i) => {
    let mapped: Record<string, unknown> = {};
    let sourceKey: string | undefined;
    let needsReview = false;
    if (odoo) {
      const res = mapOdooPurchaseOrderRow(r);
      if (res.kind === 'blank') { out.blankRows++; return; }
      if (res.kind === 'skipped') { out.skippedByStatus[res.statusLabel] = (out.skippedByStatus[res.statusLabel] ?? 0) + 1; return; }
      mapped = res.mapped; sourceKey = res.sourceKey; needsReview = res.needsReview;
    } else {
      for (const [k, v] of Object.entries(r)) {
        const target = COLUMNS[norm(k)];
        if (target) mapped[target] = v;
      }
      if (Object.values(mapped).every((v) => String(v ?? '').trim() === '')) { out.blankRows++; return; }
    }
    const checked = validateExpense(mapped, today);
    if (!checked.ok) { out.invalid.push({ row: i + 2, errors: checked.errors }); return; }
    const fp = sourceKey ?? expenseFingerprint(checked.value);
    if (seen.has(fp)) { out.duplicatesInFile++; return; }
    seen.add(fp);
    if (needsReview) out.needsReviewCount++;
    out.valid.push({ ...checked.value, ...(sourceKey ? { sourceKey } : {}), ...(needsReview ? { needsReview: true } : {}) });
  });
  return out;
}
