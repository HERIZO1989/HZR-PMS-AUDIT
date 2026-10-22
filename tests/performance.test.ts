import { describe, expect, it } from 'vitest';
import { computePerformance } from '../src/lib/performance';

const snap = (business_date: string, rooms_occupied: number, total_room_revenue: number) => ({ business_date, rooms_available: 100, rooms_occupied, total_room_revenue });

describe('performance mensuelle (HT)', () => {
  const snapshots = [snap('2026-03-30', 50, 6000000), snap('2026-03-31', 70, 8400000), snap('2026-04-01', 60, 7200000), snap('2026-04-02', 40, 4800000), snap('2026-05-01', 10, 1000000)];
  const invoices = [
    { invoice_date: '2026-03-31', amount_ttc: 18000000 },
    { invoice_date: '2026-04-01', amount_ttc: 24000000 },
    { invoice_date: '2026-04-02', amount_ttc: 12000000 },
    { invoice_date: '2025-12-31', amount_ttc: 9999999 },
    { invoice_date: '2026-04-05', amount_ttc: 5555555 },
  ];
  const expenses = [
    { expense_date: '2026-03-31', amount_ht: 5000000, category: 'energy' },
    { expense_date: '2026-04-01', amount_ht: 6000000, category: 'personnel' },
    { expense_date: '2026-04-02', amount_ht: 1000000, category: 'other' },
  ];
  const p = computePerformance({ snapshots, invoices, expenses, vatRate: 0.2 }, '2026', '2026-04-02');

  it('regroupe par mois et ignore l’autre année et les dates après la date de situation', () => {
    expect(p.months.map((m) => m.month)).toEqual(['2026-03', '2026-04']);
    expect(p.months[1].billedRevenue).toBe(30000000);
  });

  it('calcule occupation, ADR, RevPAR et TRevPAR sur chambres-nuits disponibles', () => {
    const avril = p.months[1];
    expect(avril).toMatchObject({ days: 2, roomsAvailable: 200, roomsOccupied: 100, occupancy: 0.5 });
    expect(avril.adr).toBe(120000);
    expect(avril.revpar).toBe(60000);
    expect(avril.trevpar).toBe(150000);
  });

  it('calcule le GOP, sa marge et le GOPPAR avec les dépenses HT, et détecte le personnel', () => {
    const avril = p.months[1];
    expect(avril).toMatchObject({ expenses: 7000000, personnelExpenses: 6000000, gop: 23000000, goppar: 115000 });
    expect(avril.gopMargin).toBeCloseTo(23000000 / 30000000, 6);
    expect(p.months[0].personnelExpenses).toBe(0);
  });

  it('cumule sur la période et donne l’écart facturé moins hébergement', () => {
    expect(p.total).toMatchObject({ days: 4, roomsAvailable: 400, billedRevenue: 45000000, expenses: 12000000, gop: 33000000 });
    expect(p.total.billedMinusRooms).toBe(45000000 - 26400000);
    expect(p.total.trevpar).toBe(112500);
  });

  it('marque partiel un mois dont les jours sont incomplets (mois de la date de situation)', () => {
    expect(p.months[0].partial).toBe(true);   // mars : seulement 2 jours de calcul
    expect(p.months[1].partial).toBe(false);  // avril : 2 jours calcules sur 2 jours écoulés
  });

  it('sans TVA configurée le TTC est pris tel quel', () => {
    const q = computePerformance({ snapshots: [snap('2026-04-01', 50, 100)], invoices: [{ invoice_date: '2026-04-01', amount_ttc: 600 }], expenses: [], vatRate: 0 }, '2026', '2026-04-30');
    expect(q.months[0].billedRevenue).toBe(600);
  });
});
