import { describe, expect, it } from 'vitest';
import { effectiveAsOf, lastInvoiceDateOf, splitVat, summarizeRevenue, type InvoiceLite } from '../src/lib/invoices';

const inv = (id: string, invoice_date: string, amount_ttc: number, payment_status: InvoiceLite['payment_status'], payment_date: string | null = null, due_date: string | null = null): InvoiceLite =>
  ({ id, invoice_date, amount_ttc, payment_status, payment_date, due_date });

describe('synthèse du CA, des encaissements et des créances', () => {
  const rows = [
    inv('1', '2026-10-19', 120000, 'paid', '2026-10-19'),
    inv('2', '2026-10-19', 1158000, 'in_payment', '2026-10-19'),
    inv('3', '2026-10-19', 60000, 'unpaid', null, '2026-10-19'),
    inv('4', '2026-10-02', 240000, 'unpaid', null, '2026-10-05'),
    inv('5', '2026-09-30', 100000, 'partial', null, '2026-11-15'),
    inv('6', '2026-09-07', 47000, 'reversed'),
    inv('7', '2026-03-10', 300000, 'paid', '2026-10-19'),
    inv('8', '2025-12-31', 50000, 'unpaid', null, '2026-01-30'),
    inv('9', '2026-10-20', 999, 'unpaid'),
  ];
  const s = summarizeRevenue([...rows, rows[0]], '2026-10-19', 0.2);

  it('calcule le CA du jour, du mois et de l’année (extournées, doublons d’identifiant et dates futures exclus)', () => {
    expect(s.day).toMatchObject({ count: 3, ttc: 1338000 });
    expect(s.month).toMatchObject({ count: 4, ttc: 1578000 });
    expect(s.previousMonth).toMatchObject({ count: 1, ttc: 100000 });
    expect(s.year).toMatchObject({ count: 6, ttc: 1978000 });
    expect(s.monthly[9].ttc).toBe(1578000);
    expect(s.monthly[2].ttc).toBe(300000);
  });

  it('ramène le HT avec le taux de TVA de l’hôtel', () => {
    expect(splitVat(120000, 0.2)).toEqual({ ttc: 120000, ht: 100000, vat: 20000 });
    expect(splitVat(120000, 0)).toEqual({ ttc: 120000, ht: 120000, vat: 0 });
    expect(s.day.ht).toBe(1115000);
  });

  it('compte les encaissements à la date de paiement, y compris pour une facture plus ancienne', () => {
    expect(s.cashed.day).toEqual({ count: 3, ttc: 1578000 });
    expect(s.cashed.year.ttc).toBe(1578000);
  });

  it('cumule les créances toutes années confondues avec les échues et les partielles', () => {
    expect(s.receivables).toEqual({ count: 4, ttc: 450000, overdueCount: 2, overdueTtc: 290000, partialCount: 1 });
  });
});

describe('fraîcheur des factures importées', () => {
  const rows = [{ invoice_date: '2026-10-19' }, { invoice_date: '2026-10-05' }, { invoice_date: '2026-10-30' }];
  it('retient la dernière facture connue jusqu’à la date demandée', () => {
    expect(lastInvoiceDateOf(rows, '2026-10-25')).toBe('2026-10-19');
    expect(lastInvoiceDateOf(rows, '2026-10-04')).toBeNull();
    expect(lastInvoiceDateOf([], '2026-10-25')).toBeNull();
  });
  it('affiche le dernier jour réel plutôt qu’un jour à zéro, sans reculer quand les données sont à jour', () => {
    expect(effectiveAsOf('2026-10-19', '2026-10-25')).toBe('2026-10-19');
    expect(effectiveAsOf('2026-10-25', '2026-10-25')).toBe('2026-10-25');
    expect(effectiveAsOf(null, '2026-10-25')).toBe('2026-10-25');
  });
  it('le CA du dernier jour importé n’est pas nul alors que celui d’aujourd’hui l’est', () => {
    const inv = [{ id: '1', invoice_date: '2026-10-19', due_date: null, amount_ttc: 120000, payment_status: 'paid' as const, payment_date: '2026-10-19' }];
    expect(summarizeRevenue(inv, '2026-10-25', 0.2).day.ttc).toBe(0);
    expect(summarizeRevenue(inv, effectiveAsOf(lastInvoiceDateOf(inv, '2026-10-25'), '2026-10-25'), 0.2).day.ttc).toBe(120000);
  });
});
