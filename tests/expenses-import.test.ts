import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { prepareExpenseRows, readExpenseRows } from '../src/lib/expensesImport';

const TODAY = '2026-10-18';
const HEADERS = ['Date', 'Catégorie', 'Description', 'Fournisseur', 'N° de pièce', 'Mode de paiement', 'Montant TTC (Ar)', 'TVA déductible (Ar)', 'Montant HT (Ar)'];
const ENERGY = 'Énergie (électricité, eau, gaz, carburant groupe)';

function workbook(rows: unknown[][], withLegend = true): Buffer {
  const wb = XLSX.utils.book_new();
  if (withLegend) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Légende'], ['Montant TTC : texte sans rapport']]), 'Légende');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEADERS, ...rows]), 'Journal des dépenses');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellDates: true }) as Buffer;
}

describe('import du journal des dépenses (classeur fourni)', () => {
  it('lit la feuille « Journal des dépenses » parmi plusieurs feuilles et ignore les lignes vides', () => {
    const buf = workbook([
      [new Date(Date.UTC(2026, 2, 12)), ENERGY, 'Facture JIRAMA mars', 'JIRAMA', 'F-1', 'Virement', 4800000, 800000, ''],
      ['', '', '', '', '', '', '', '', ''],
      ['20/03/2026', 'Blanchisserie et linge', 'Linge', 'Pressing', '', 'Espèces', '1 200 000', 200000, ''],
    ]);
    const raw = readExpenseRows(buf, 'Anjary_depenses_et_marge.xlsx');
    const p = prepareExpenseRows(raw, TODAY);
    expect(p.valid).toHaveLength(2);
    expect(p.blankRows).toBe(1);
    expect(p.invalid).toEqual([]);
    expect(p.valid[0]).toMatchObject({ expense_date: '2026-03-12', category: 'energy', payment_method: 'transfer', amount_ttc: 4800000, vat_deductible: 800000 });
    expect(p.valid[1]).toMatchObject({ expense_date: '2026-03-20', category: 'laundry', payment_method: 'cash', amount_ttc: 1200000 });
  });

  it('signale les lignes refusées avec leur numéro de ligne Excel et écarte les doublons du fichier', () => {
    const buf = workbook([
      ['12/03/2026', ENERGY, 'JIRAMA', 'JIRAMA', 'F-1', 'Virement', 4800000, 800000, ''],
      ['12/03/2026', ENERGY, 'jirama', 'jirama', 'f-1', 'Virement', 4800000, 800000, ''],   // meme depense, autre casse
      ['25/12/2030', ENERGY, 'Futur', '', '', '', 1000, 0, ''],                              // date future
      ['12/03/2026', 'Catégorie fantaisie', 'x', '', '', '', 1000, 0, ''],                   // categorie inconnue
      ['12/03/2026', ENERGY, 'sans montant', '', '', '', '', '', ''],
    ]);
    const p = prepareExpenseRows(readExpenseRows(buf, 'depenses.xlsx'), TODAY);
    expect(p.valid).toHaveLength(1);
    expect(p.duplicatesInFile).toBe(1);
    expect(p.invalid.map((x) => x.row)).toEqual([4, 5, 6]);
    expect(p.invalid[0].errors.join(' ')).toMatch(/futur/);
    expect(p.invalid[1].errors.join(' ')).toMatch(/Catégorie inconnue/);
    expect(p.invalid[2].errors.join(' ')).toMatch(/Montant TTC invalide/);
  });

  it('lit un CSV avec les mêmes colonnes et retourne vide un classeur sans colonne Montant TTC', () => {
    const csv = 'Date,Catégorie,Description,Fournisseur,N° de pièce,Mode de paiement,Montant TTC (Ar),TVA déductible (Ar)\n05/04/2026,Maintenance et réparations,Plomberie,Artisan,,Espèces,2400000,400000\n';
    const p = prepareExpenseRows(readExpenseRows(Buffer.from(csv, 'utf8'), 'depenses.csv'), TODAY);
    expect(p.valid).toHaveLength(1);
    expect(p.valid[0]).toMatchObject({ category: 'maintenance', amount_ttc: 2400000, vat_deductible: 400000 });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Nom', 'Valeur'], ['a', 1]]), 'Autre');
    const other = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    expect(readExpenseRows(other, 'autre.xlsx')).toEqual([]);
  });
});
