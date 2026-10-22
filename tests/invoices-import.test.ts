import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { invoiceKey, prepareInvoiceRows, readInvoiceRows } from '../src/lib/invoicesImport';

const TODAY = '2026-10-20';
const HEADERS = ['Numéro', "Date d'échéance", "Nom d'affichage du partenaire de la facture", 'Notes', 'Date de facturation', 'Conditions de paiement', 'Total signé', 'Total signé en devises', 'Statut du paiement', 'Date de Paiement', 'Statut'];
const serial = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 86400000 + 25569;
const row = (num: string, partner: string, date: number | '', total: unknown, pay: string, payDate: number | '' = '', status = 'Comptabilisé', terms = '') =>
  [num, date, partner, '', date, terms, total, total, pay, payDate, status];

function workbook(rows: unknown[][]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEADERS, ...rows]), 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
const prepare = (rows: unknown[][]) => prepareInvoiceRows(readInvoiceRows(workbook(rows), 'Pièce_comptable__account_move_.xlsx'), TODAY);

describe('import des factures : export Odoo « Pièces comptables »', () => {
  it('lit les factures comptabilisées avec leur état de paiement', () => {
    const p = prepare([
      row('FAC/2026/06356', 'ROSSANALY DELSSADE', serial(2026, 10, 19), 1158000, 'En paiement', serial(2026, 10, 19)),
      row('FAC/2026/06355', 'YUSUF ABBAS BHAI JARWALA', serial(2026, 10, 19), 120000, 'Partiellement réglé'),
      row('FAC/2026/06352', 'FATOUMA AHMAD', serial(2026, 10, 19), 18000, 'Payé', serial(2026, 10, 19)),
      row('FAC/2026/06300', 'ANDREAS', serial(2026, 10, 1), 22000.5, 'Non payé', '', 'Comptabilisé', '30 jours'),
    ]);
    expect(p.invalid).toEqual([]);
    expect(p.valid.map((v) => v.payment_status)).toEqual(['in_payment', 'partial', 'paid', 'unpaid']);
    expect(p.valid[0]).toMatchObject({ invoice_number: 'FAC/2026/06356', invoice_date: '2026-10-19', payment_date: '2026-10-19', amount_ttc: 1158000 });
    expect(p.valid[3]).toMatchObject({ amount_ttc: 22000.5, payment_terms: '30 jours', payment_date: null });
  });

  it('écarte Annulée et Brouillon (comptés), refuse un total vide ou une date future, garde un numéro « / » sans numéro', () => {
    const p = prepare([
      row('/', 'JACQUES ELIE', '', 120000, 'Non payé', '', 'Annulée'),
      row('/', 'ALPHA', serial(2026, 9, 1), 603600, 'Non payé', '', 'Brouillon'),
      row('FAC/2026/03220', 'GOULAMALY DEMNATI SHARDA', serial(2026, 6, 15), '', 'Non payé'),
      row('FAC/2026/06999', 'FUTUR', serial(2026, 10, 25), 1000, 'Non payé'),
      row('/', 'SANS NUMERO', serial(2026, 10, 1), 5000, 'Non payé'),
    ]);
    expect(p.skippedByStatus).toEqual({ Annulée: 1, Brouillon: 1 });
    expect(p.invalid.map((x) => x.row)).toEqual([4, 5]);
    expect(p.invalid[0].errors.join(' ')).toMatch(/Total invalide/);
    expect(p.invalid[1].errors.join(' ')).toMatch(/futur/);
    expect(p.valid).toHaveLength(1);
    expect(p.valid[0].invoice_number).toBeNull();
  });

  it('garde deux factures différentes qui portent le même numéro, et ne compte qu’une fois une vraie répétition', () => {
    const p = prepare([
      row('FAC/2026/00030', '03 - Transfert Anjary Hotel', serial(2026, 1, 20), 21000, 'Non payé'),
      row('FAC/2026/00030', 'FAZELE HOUSSEN Housseiny', serial(2026, 1, 27), 11000, 'Payé', serial(2026, 1, 27)),
      row('FAC/2026/00030', 'FAZELE HOUSSEN Housseiny', serial(2026, 1, 27), 11000, 'Payé', serial(2026, 1, 27)),
    ]);
    expect(p.valid).toHaveLength(2);
    expect(p.duplicatesInFile).toBe(1);
    expect(p.valid[0].key).not.toBe(p.valid[1].key);
  });

  it('la clé ne dépend pas de l’état de paiement : un export plus récent met à jour au lieu de dupliquer', () => {
    const avant = prepare([row('FAC/2026/06300', 'ANDREAS', serial(2026, 10, 1), 22000, 'Non payé')]).valid[0];
    const apres = prepare([row('FAC/2026/06300', 'ANDREAS', serial(2026, 10, 1), 22000, 'Payé', serial(2026, 10, 12))]).valid[0];
    expect(apres.key).toBe(avant.key);
    expect(apres.payment_status).toBe('paid');
    expect(invoiceKey('FAC/2026/06300', ' andreas ', '2026-10-01', 22000)).toBe(avant.key);
  });

  it('lit aussi un CSV et ne confond pas avec un autre export', () => {
    const csv = `${HEADERS.join(',')}\nFAC/2026/06352,19/10/2026,FATOUMA AHMAD,,19/10/2026,,"18000,00","18000,00",Payé,19/10/2026,Comptabilisé\n`;
    const p = prepareInvoiceRows(readInvoiceRows(Buffer.from(csv, 'utf8'), 'f.csv'), TODAY);
    expect(p.valid[0]).toMatchObject({ invoice_date: '2026-10-19', amount_ttc: 18000, payment_status: 'paid', payment_date: '2026-10-19' });
    const other = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(other, XLSX.utils.aoa_to_sheet([['Référence de commande', 'Fournisseur', 'Total', 'Statut'], ['P1', 'X', 1, 'Verrouillé']]), 'S');
    expect(readInvoiceRows(XLSX.write(other, { type: 'buffer', bookType: 'xlsx' }) as Buffer, 'bc.xlsx')).toEqual([]);
  });
});
