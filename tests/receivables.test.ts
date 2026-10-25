import { describe, expect, it } from 'vitest';
import { bucketOf, buildReceivables, buildReminder, tagInvoices, type OpenInvoice } from '../src/lib/receivables';

const TODAY = '2026-10-24';
const inv = (partner_name: string, invoice_date: string, amount_ttc: number, payment_status = 'unpaid', due_date: string | null = null, invoice_number: string | null = null): OpenInvoice =>
  ({ invoice_number, partner_name, invoice_date, due_date, amount_ttc, payment_status });

describe('tranches d’ancienneté', () => {
  it('classe aux bornes exactes (30, 60, 90 et 180 jours)', () => {
    expect([0, 30, 31, 60, 61, 90, 91, 180, 181, 400].map(bucketOf)).toEqual(['d0_30', 'd0_30', 'd31_60', 'd31_60', 'd61_90', 'd61_90', 'd91_180', 'd91_180', 'd180p', 'd180p']);
  });
});

describe('synthèse des créances', () => {
  const rows = [
    inv('PORT', '2026-10-20', 100000, 'unpaid', '2026-11-19'),          // 4 j, non échue
    inv('PORT', '2026-08-01', 300000, 'unpaid', '2026-08-31'),          // 84 j, échue
    inv('PORT', '2026-04-01', 600000, 'partial', '2026-05-01'),         // 206 j, échue, partielle
    inv('PETIT', '2026-06-01', 50000, 'unpaid'),                        // 145 j, sans échéance : date de facture
    inv('SOLDE', '2026-01-01', 999999, 'paid'),                         // ignorée
    inv('EN PAIEMENT', '2026-01-01', 888888, 'in_payment'),             // ignorée
    inv('FUTUR', '2026-11-05', 777777, 'unpaid'),                       // date après aujourd’hui : ignorée
  ];
  const s = buildReceivables(rows, TODAY);

  it('totalise les factures non soldées, les échues et celles de plus de 90 jours', () => {
    expect(s).toMatchObject({ count: 4, total: 1050000, overdueCount: 3, overdue: 950000, over90: 650000, clientCount: 2 });
  });

  it('répartit par tranche', () => {
    expect(Object.fromEntries(s.buckets.map((b) => [b.code, [b.count, b.amount]]))).toEqual({
      d0_30: [1, 100000], d31_60: [0, 0], d61_90: [1, 300000], d91_180: [1, 50000], d180p: [1, 600000],
    });
  });

  it('classe les clients par montant, avec leur plus ancienne facture et leurs tranches', () => {
    expect(s.clients.map((c) => c.client)).toEqual(['PORT', 'PETIT']);
    expect(s.clients[0]).toMatchObject({ count: 3, total: 1000000, over90: 600000, overdue: 900000, oldest: '2026-04-01' });
    expect(s.clients[0].buckets).toEqual({ d0_30: 100000, d31_60: 0, d61_90: 300000, d91_180: 0, d180p: 600000 });
    expect(s.top20Share).toBe(1);
  });

  it('une base vide ne produit ni division par zéro ni client', () => {
    expect(buildReceivables([], TODAY)).toMatchObject({ count: 0, total: 0, clientCount: 0, top20Share: 0 });
  });
});

describe('message de relance', () => {
  const list = [inv('PORT', '2026-08-01', 300000, 'unpaid', null, 'FAC/2026/04000'), inv('PORT', '2026-04-01', 600000, 'partial', null, 'FAC/2026/01000'), inv('PORT', '2026-01-01', 5, 'paid', null, 'FAC/PAYEE')];
  const msg = buildReminder('PORT DE TOAMASINA', list, 'Hôtel Anjary', 'MGA', TODAY);

  it('liste les factures impayées, les plus anciennes d’abord, avec le total, sans les factures payées', () => {
    expect(msg).toContain('2 factures de Hôtel Anjary restent à régler à la date du 24/10/2026 pour PORT DE TOAMASINA');
    expect(msg.indexOf('FAC/2026/01000')).toBeLessThan(msg.indexOf('FAC/2026/04000'));
    expect(msg).toContain('- FAC/2026/01000 du 01/04/2026 : 600 000 Ar');
    expect(msg).toContain('Total à régler : 900 000 Ar.');
    expect(msg).not.toContain('FAC/PAYEE');
    expect(msg.trim().endsWith('Hôtel Anjary')).toBe(true);
  });

  it('résume au-delà de la limite de lignes et accorde le singulier', () => {
    const many = Array.from({ length: 20 }, (_, i) => inv('X', `2026-0${(i % 9) + 1}-01`, 1000, 'unpaid', null, `F${i}`));
    expect(buildReminder('X', many, 'H', 'MGA', TODAY, 15)).toContain('… et 5 autre(s) facture(s)');
    expect(buildReminder('X', [many[0]], 'H', 'MGA', TODAY)).toContain('une facture de H reste à régler');
  });
});

describe('créances à rapprocher (numéro en double et paiement proche)', () => {
  const base = [
    inv('MARTIN', '2026-08-01', 190000, 'paid', null, 'FAC/2026/00100'),           // séjour réglé
    inv('MARTIN', '2026-09-20', 20000, 'unpaid', null, 'FAC/2026/00100'),          // petite facture, même numéro, client ayant payé à 50 j : à rapprocher
    inv('LOIN', '2026-03-01', 150000, 'paid', null, 'FAC/2026/00200'),
    inv('LOIN', '2026-09-20', 15000, 'unpaid', null, 'FAC/2026/00200'),            // payé il y a plus de 60 jours : numéro en double sans paiement proche
    inv('SEUL', '2026-09-01', 80000, 'unpaid', null, 'FAC/2026/00300'),            // numéro unique : créance fiable
    inv('PARTIEL', '2026-09-01', 90000, 'partial', null, 'FAC/2026/00400'),
    inv('PARTIEL', '2026-09-02', 10000, 'paid', null, 'FAC/2026/00400'),           // partielle : jamais étiquetée
    inv('SANSNUM', '2026-09-01', 5000, 'unpaid', null, null),
  ];
  const tagged = tagInvoices(base);

  it('étiquette uniquement les « non payées » au numéro en double', () => {
    expect(tagged.map((i) => i.reconcile)).toEqual([null, 'a_rapprocher', null, 'double_sans_paiement', null, null, null, null]);
  });

  it('sépare les créances fiables de celles à rapprocher, par client et au total', () => {
    const s = buildReceivables(tagged.filter((i) => i.payment_status === 'unpaid' || i.payment_status === 'partial'), TODAY);
    expect(s.toReconcile).toEqual({ count: 1, amount: 20000 });
    expect(s.reliable).toEqual({ count: 4, amount: 190000 });
    expect(s.total).toBe(210000);
    expect(s.clients.find((c) => c.client === 'MARTIN')?.toReconcile).toBe(20000);
    expect(s.clients.find((c) => c.client === 'LOIN')?.toReconcile).toBe(0);
  });

  it('ne réclame jamais au client les factures à rapprocher', () => {
    const martin = tagged.filter((i) => i.partner_name === 'MARTIN');
    const msg = buildReminder('MARTIN', martin, 'Hôtel Anjary', 'MGA', TODAY);
    expect(msg).toContain('Total à régler : 0 Ar.');
    const loin = buildReminder('LOIN', tagged.filter((i) => i.partner_name === 'LOIN'), 'Hôtel Anjary', 'MGA', TODAY);
    expect(loin).toContain('Total à régler : 15 000 Ar.');
  });

  it('la fenêtre est de ± 60 jours, bornes comprises', () => {
    const t = tagInvoices([
      inv('A', '2026-07-01', 100, 'paid', null, 'N1'), inv('A', '2026-08-30', 10, 'unpaid', null, 'N1'),   // 60 j : proche
      inv('B', '2026-07-01', 100, 'paid', null, 'N2'), inv('B', '2026-08-31', 10, 'unpaid', null, 'N2'),   // 61 j : trop loin
      inv('C', '2026-09-20', 100, 'in_payment', null, 'N3'), inv('C', '2026-08-01', 10, 'unpaid', null, 'N3'), // paiement 50 j après : fenêtre symétrique
      inv('D', '2026-10-25', 100, 'in_payment', null, 'N4'), inv('D', '2026-08-01', 10, 'unpaid', null, 'N4'), // paiement 85 j après : trop loin
    ]);
    expect([t[1].reconcile, t[3].reconcile, t[5].reconcile, t[7].reconcile]).toEqual(['a_rapprocher', 'double_sans_paiement', 'a_rapprocher', 'double_sans_paiement']);
  });
});
