import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { prepareExpenseRows, readExpenseRows } from '../src/lib/expensesImport';
import { categoryFromSupplier, normalizeSupplier } from '../src/lib/odooPurchaseOrders';
import { parseExpenseDate } from '../src/lib/expenses';

const TODAY = '2026-10-20';
const HEADERS = ['Priorité', 'Référence de commande', 'Arrivée', 'Fournisseur', 'Acheteur', 'Échéance de commande', 'Activités', "Document d'origine", 'Total', 'Statut'];
const BC = 'Bon de commande fournisseur';

/** Numéro de série Excel d'une date-heure « murale » (sans fuseau) : évite toute dépendance au fuseau du serveur de test. */
const serial = (y: number, m: number, d: number, h = 0, min = 0) => Date.UTC(y, m - 1, d, h, min) / 86400000 + 25569;
const row = (ref: string, supplier: string, date: number | string, total: unknown, status = BC) =>
  ['Normal', ref, '', supplier, 'Réception', date, '', '', total, status];

function odooWorkbook(rows: unknown[][]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEADERS, ...rows]), 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('import des dépenses : export Odoo « Bons de commande fournisseur »', () => {
  it('reconnaît le format, garde le jour affiché même tard le soir et classe selon le fournisseur', () => {
    const p = prepareExpenseRows(readExpenseRows(odooWorkbook([
      row('P07365', 'Jirama', serial(2026, 10, 19, 23, 50), 12032977.64),
      row('P07351', 'Biskot', serial(2026, 10, 19, 0, 5), 114500),
    ]), 'Bon_de_commande_fournisseur__purchase_order_.xlsx'), TODAY);
    expect(p.format).toBe('odoo_po');
    expect(p.invalid).toEqual([]);
    expect(p.valid).toHaveLength(2);
    expect(p.valid[0]).toMatchObject({ expense_date: '2026-10-19', category: 'energy', supplier: 'Jirama', document_number: 'P07365', amount_ttc: 12032977.64, vat_deductible: 0, payment_method: 'cash' });
    expect(p.valid[1]).toMatchObject({ expense_date: '2026-10-19', category: 'food' });
  });

  it('écarte Annulé et Demande de prix (comptés par statut), garde Verrouillé, rejette un total vide', () => {
    const p = prepareExpenseRows(readExpenseRows(odooWorkbook([
      row('P1', 'Biskot', serial(2026, 8, 28, 16), 425500, 'Annulé'),
      row('P2', 'Jary Design', serial(2026, 9, 28, 7), 2500, 'Demande de prix'),
      row('P3', 'STEP UP', serial(2026, 7, 31, 8), 176400, 'Verrouillé'),
      row('P4', 'PRAXI', serial(2026, 9, 1, 10), '', BC),
      row('P5', 'PRAXI', serial(2026, 9, 2, 10), '', 'Annulé'),
    ]), 'po.xlsx'), TODAY);
    expect(p.skippedByStatus).toEqual({ 'Annulé': 2, 'Demande de prix': 1 });
    expect(p.valid.map((v) => v.document_number)).toEqual(['P3']);
    expect(p.invalid.map((x) => x.row)).toEqual([5]);
    expect(p.invalid[0].errors.join(' ')).toMatch(/Montant TTC invalide/);
  });

  it('met en attente les montants inférieurs à 1 000 (devise douteuse) sans les convertir', () => {
    const p = prepareExpenseRows(readExpenseRows(odooWorkbook([
      row('P07070', 'Booking.com BV', serial(2026, 10, 5, 11), 141.52),
      row('P06293', 'Jirama', serial(2026, 8, 21, 14), 59832.16),
    ]), 'po.xlsx'), TODAY);
    expect(p.needsReviewCount).toBe(1);
    const booking = p.valid.find((v) => v.document_number === 'P07070')!;
    expect(booking).toMatchObject({ needsReview: true, category: 'commissions', amount_ttc: 141.52 });
    expect(booking.description).toMatch(/À vérifier/);
    expect(p.valid.find((v) => v.document_number === 'P06293')!.needsReview).toBeUndefined();
  });

  it('la clé d’idempotence est la référence Odoo : variantes de fournisseur et même référence ne créent pas de doublon', () => {
    const p = prepareExpenseRows(readExpenseRows(odooWorkbook([
      row('P05279', "COMMUNE URBAINE D 'ANTANANARIVO", serial(2026, 10, 16, 8), 1075000),
      row('P05279', "Commune Urbaine d'Antananarivo", serial(2026, 10, 16, 8), 1075000),
    ]), 'po.xlsx'), TODAY);
    expect(p.valid).toHaveLength(1);
    expect(p.duplicatesInFile).toBe(1);
    expect(p.valid[0]).toMatchObject({ supplier: "Commune Urbaine d'Antananarivo", category: 'taxes', sourceKey: 'odoo_po|p05279' });
  });

  it('normalise les variantes de noms et classe « Autres achat / Autres Services » en autres dépenses', () => {
    expect(normalizeSupplier('AUTRE ACHAT')).toBe('Autres achat');
    expect(normalizeSupplier('  QUICAILLERIE TSARADIA ')).toBe('QUINCAILLERIE TSARADIA');
    expect(categoryFromSupplier('QUINCAILLERIE AMBALAVAO ISOTRY')).toBe('maintenance');
    expect(categoryFromSupplier('AIRTEL')).toBe('telecom');
    expect(categoryFromSupplier('Autres Services')).toBe('other');
    expect(categoryFromSupplier('Autres achat')).toBe('other');
  });

  it('lit aussi un CSV Odoo (date JJ/MM/AAAA avec heure) et ne touche pas au format « Journal des dépenses »', () => {
    expect(parseExpenseDate('19/10/2026 23:50:12')).toBe('2026-10-19');
    expect(parseExpenseDate('2026-10-19 19:04:37')).toBe('2026-10-19');
    const csv = `${HEADERS.join(',')}\nNormal,P07365,,Jirama,Naya,19/10/2026 19:04:37,,,"12032977,64",Bon de commande fournisseur\n`;
    const p = prepareExpenseRows(readExpenseRows(Buffer.from(csv, 'utf8'), 'po.csv'), TODAY);
    expect(p.format).toBe('odoo_po');
    expect(p.valid[0]).toMatchObject({ expense_date: '2026-10-19', amount_ttc: 12032977.64, category: 'energy' });
  });
});
