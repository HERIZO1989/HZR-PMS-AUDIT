import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { expenseFingerprint, validateExpense, type ValidExpense } from './expenses';

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

/** Lit un classeur Excel ou un CSV. Dans le classeur fourni (plusieurs feuilles), on prend « Journal des dépenses ». */
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
    if (rows.length > 0 && Object.keys(rows[0]).some((k) => norm(k).startsWith('montant ttc'))) return rows;
  }
  return [];
}

export interface PreparedExpenses {
  valid: ValidExpense[];
  invalid: { row: number; errors: string[] }[];
  blankRows: number;
  duplicatesInFile: number;
}

/** Valide les lignes brutes : lignes vides ignorées, doublons du fichier écartés, erreurs listées avec leur numéro de ligne Excel. */
export function prepareExpenseRows(raw: Record<string, unknown>[], today?: string): PreparedExpenses {
  const out: PreparedExpenses = { valid: [], invalid: [], blankRows: 0, duplicatesInFile: 0 };
  const seen = new Set<string>();
  raw.forEach((r, i) => {
    const mapped: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) {
      const target = COLUMNS[norm(k)];
      if (target) mapped[target] = v;
    }
    if (Object.values(mapped).every((v) => String(v ?? '').trim() === '')) { out.blankRows++; return; }
    const checked = validateExpense(mapped, today);
    if (!checked.ok) { out.invalid.push({ row: i + 2, errors: checked.errors }); return; }
    const fp = expenseFingerprint(checked.value);
    if (seen.has(fp)) { out.duplicatesInFile++; return; }
    seen.add(fp);
    out.valid.push(checked.value);
  });
  return out;
}
