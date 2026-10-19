import { describe, expect, it } from 'vitest';
import {
  EXPENSE_CATEGORIES, PAYMENT_METHODS, categoryFromLabel, computeExpenseKpis, expenseFingerprint,
  parseExpenseDate, paymentMethodFromLabel, summarizeExpenses, validateExpense,
} from '../src/lib/expenses';

const TODAY = '2026-10-18';
const base = { expense_date: '2026-10-10', category: 'energy', amount_ttc: 4800000, vat_deductible: 800000 };

describe('validateExpense', () => {
  it('accepte une dépense complète et arrondit les montants', () => {
    const r = validateExpense({ ...base, description: ' Facture JIRAMA ', supplier: 'JIRAMA', document_number: 'F-1', payment_method: 'Virement', amount_ttc: '4 800 000,456' }, TODAY);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toMatchObject({ expense_date: '2026-10-10', category: 'energy', payment_method: 'transfer', amount_ttc: 4800000.46, vat_deductible: 800000, description: 'Facture JIRAMA' });
    }
  });
  it('met 0 en TVA déductible et espèces par défaut', () => {
    const r = validateExpense({ expense_date: '2026-10-10', category: 'other', amount_ttc: 5000 }, TODAY);
    expect(r.ok && r.value.vat_deductible).toBe(0);
    expect(r.ok && r.value.payment_method).toBe('cash');
  });
  it('refuse une date future, un montant nul, une TVA supérieure au total et une catégorie inconnue', () => {
    const r = validateExpense({ expense_date: '2026-10-19', category: 'inconnue', amount_ttc: 0, vat_deductible: 5 }, TODAY);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join(' | ')).toMatch(/futur/);
      expect(r.errors.join(' | ')).toMatch(/Catégorie inconnue/);
      expect(r.errors.join(' | ')).toMatch(/Montant TTC invalide/);
    }
    const v = validateExpense({ ...base, vat_deductible: 5000000 }, TODAY);
    expect(!v.ok && v.errors.join(' ')).toMatch(/dépasse/);
  });
  it('refuse un texte trop long et une date impossible', () => {
    expect(validateExpense({ ...base, description: 'x'.repeat(501) }, TODAY).ok).toBe(false);
    expect(validateExpense({ ...base, expense_date: '31/02/2026' }, TODAY).ok).toBe(false);
    expect(validateExpense({ ...base, payment_method: 'bitcoin' }, TODAY).ok).toBe(false);
  });
});

describe('lecture des libellés et des dates (import du classeur)', () => {
  it('reconnaît chaque libellé de catégorie et de paiement, sans accents ni casse', () => {
    for (const c of EXPENSE_CATEGORIES) {
      expect(categoryFromLabel(c.label)).toBe(c.code);
      expect(categoryFromLabel(c.label.toUpperCase())).toBe(c.code);
      expect(categoryFromLabel(c.code)).toBe(c.code);
    }
    for (const m of PAYMENT_METHODS) expect(paymentMethodFromLabel(m.label)).toBe(m.code);
    expect(categoryFromLabel('Divers')).toBeNull();
    expect(paymentMethodFromLabel('')).toBe('cash');
    expect(paymentMethodFromLabel('Troc')).toBeNull();
  });
  it('lit JJ/MM/AAAA, AAAA-MM-JJ, un objet Date et un numéro de série Excel', () => {
    expect(parseExpenseDate('12/03/2026')).toBe('2026-03-12');
    expect(parseExpenseDate('2026-03-12')).toBe('2026-03-12');
    expect(parseExpenseDate(new Date(Date.UTC(2026, 2, 12)))).toBe('2026-03-12');
    expect(parseExpenseDate(46093)).toBe('2026-03-12'); // 12/03/2026 en numéro de série Excel
    expect(parseExpenseDate('n/a')).toBeNull();
    expect(parseExpenseDate('')).toBeNull();
  });
  it("l'empreinte est stable et ne dépend pas de la casse du fournisseur", () => {
    const a = validateExpense({ ...base, supplier: 'JIRAMA' }, TODAY);
    const b = validateExpense({ ...base, supplier: 'jirama' }, TODAY);
    expect(a.ok && b.ok && expenseFingerprint(a.value) === expenseFingerprint(b.value)).toBe(true);
    const c = validateExpense({ ...base, amount_ttc: 4800001 }, TODAY);
    expect(a.ok && c.ok && expenseFingerprint(a.value) !== expenseFingerprint(c.value)).toBe(true);
  });
});

describe('summarizeExpenses', () => {
  const rows = [
    { expense_date: '2026-03-12', category: 'energy', amount_ttc: 4800000, amount_ht: 4000000, status: 'approved' as const },
    { expense_date: '2026-03-12', category: 'personnel', amount_ttc: 3000000, amount_ht: 3000000, status: 'approved' as const },
    { expense_date: '2026-03-20', category: 'laundry', amount_ttc: 1200000, amount_ht: '1000000', status: 'approved' as const },
    { expense_date: '2026-04-05', category: 'maintenance', amount_ttc: 2400000, amount_ht: 2000000, status: 'approved' as const },
    { expense_date: '2026-04-06', category: 'office', amount_ttc: 600000, amount_ht: 600000, status: 'pending' as const },
    { expense_date: '2026-04-07', category: 'other', amount_ttc: 99, amount_ht: 99, status: 'rejected' as const },
  ];
  it('ne compte que les dépenses approuvées par jour, mois et catégorie', () => {
    const s = summarizeExpenses(rows);
    expect(s.approved).toEqual({ count: 4, ht: 10000000, ttc: 11400000 });
    expect(s.pending).toEqual({ count: 1, ht: 600000, ttc: 600000 });
    expect(s.rejected.count).toBe(1);
    expect(s.byDay).toEqual([
      { date: '2026-03-12', ht: 7000000, ttc: 7800000 },
      { date: '2026-03-20', ht: 1000000, ttc: 1200000 },
      { date: '2026-04-05', ht: 2000000, ttc: 2400000 },
    ]);
    expect(s.byMonth.map((m) => [m.month, m.ht])).toEqual([['2026-03', 8000000], ['2026-04', 2000000]]);
    expect(s.byCategory[0]).toMatchObject({ category: 'energy', ht: 4000000 });
    expect(s.byCategory.reduce((t, c) => t + c.share, 0)).toBeCloseTo(1, 10);
  });
  it('renvoie des totaux vides sans dépense', () => {
    const s = summarizeExpenses([]);
    expect(s.approved.ht).toBe(0);
    expect(s.byDay).toEqual([]);
    expect(s.byCategory).toEqual([]);
  });
});

describe('computeExpenseKpis', () => {
  it('calcule GOP, marge, GOPPAR, CPOR et ratios', () => {
    const k = computeExpenseKpis({ revenue: 100_000_000, expensesHt: 60_000_000, roomsAvailable: 3600, roomsOccupied: 1500 });
    expect(k.gop).toBe(40_000_000);
    expect(k.gopMargin).toBeCloseTo(0.4, 10);
    expect(k.goppar).toBeCloseTo(11111.11, 2);
    expect(k.cpor).toBe(40000);
    expect(k.expensePerAvailableRoom).toBeCloseTo(16666.67, 2);
    expect(k.expenseRatio).toBeCloseTo(0.6, 10);
  });
  it('ne divise jamais par zéro', () => {
    const k = computeExpenseKpis({ revenue: 0, expensesHt: 5000, roomsAvailable: 0, roomsOccupied: 0 });
    expect(k).toMatchObject({ gop: -5000, gopMargin: 0, goppar: 0, cpor: 0, expenseRatio: 0 });
  });
});
