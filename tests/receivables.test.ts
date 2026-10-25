import { describe, expect, it } from 'vitest';
import { bucketOf, buildReceivables, buildReminder, type OpenInvoice } from '../src/lib/receivables';

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
