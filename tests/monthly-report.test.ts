import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { buildMonthlyReport, monthLabel, type ReportInput } from '../src/lib/monthlyReport';
import { reportWorkbook } from '../src/lib/reportWorkbook';

const snap = (business_date: string, rooms_occupied: number, total_room_revenue: number) => ({ business_date, rooms_available: 100, rooms_occupied, total_room_revenue });
const days = (month: string, n: number, occ: number, rev: number) => Array.from({ length: n }, (_, i) => snap(`${month}-${String(i + 1).padStart(2, '0')}`, occ, rev));

const base = (over: Partial<ReportInput> = {}): ReportInput => ({
  month: '2026-09', today: '2026-10-25', vatRate: 0.2,
  snapshots: [...days('2026-08', 31, 40, 4800000), ...days('2026-09', 30, 50, 6000000)],
  invoices: [
    { invoice_number: 'F1', partner_name: 'A', invoice_date: '2026-08-15', due_date: null, amount_ttc: 12000000, payment_status: 'paid' },
    { invoice_number: 'F2', partner_name: 'B', invoice_date: '2026-09-15', due_date: null, amount_ttc: 24000000, payment_status: 'paid' },
    { invoice_number: 'F3', partner_name: 'GROS', invoice_date: '2026-05-01', due_date: null, amount_ttc: 6000000, payment_status: 'unpaid' },
    { invoice_number: 'F9', partner_name: 'X', invoice_date: '2026-09-20', due_date: null, amount_ttc: 999, payment_status: 'reversed' },
  ],
  expenses: [
    { expense_date: '2026-08-10', amount_ht: 3000000, category: 'personnel' },
    { expense_date: '2026-09-10', amount_ht: 5000000, category: 'personnel' },
    { expense_date: '2026-09-12', amount_ht: 3000000, category: 'energy' },
    { expense_date: '2026-09-14', amount_ht: 2000000, category: 'other' },
    { expense_date: '2026-10-02', amount_ht: 7777777, category: 'food' },
  ],
  ...over,
});

describe('rapport mensuel', () => {
  const r = buildMonthlyReport(base());

  it('calcule les indicateurs du mois, du mois précédent et du cumul (HT)', () => {
    expect(r.label).toBe('septembre 2026');
    expect(r.asOf).toBe('2026-09-30');
    expect(r.kpi.month).toMatchObject({ days: 30, occupancy: 0.5, adr: 120000, revpar: 60000, billedRevenue: 20000000, expenses: 10000000, gop: 10000000 });
    expect(r.kpi.month?.trevpar).toBeCloseTo(20000000 / 3000, 2);
    expect(r.kpi.previous).toMatchObject({ month: '2026-08', occupancy: 0.4, billedRevenue: 10000000 });
    expect(r.kpi.ytd.billedRevenue).toBe(30000000 + 5000000);
  });

  it('exclut les factures extournées et les dépenses postérieures à la fin de période du cumul', () => {
    expect(r.kpi.ytd.expenses).toBe(3000000 + 5000000 + 3000000 + 2000000);
  });

  it('donne l’évolution en points pour l’occupation et en pourcentage pour le reste', () => {
    expect(r.deltas.occupancy).toEqual({ value: expect.closeTo(10, 6), unit: 'pts' });
    expect(r.deltas.billedRevenue).toEqual({ value: expect.closeTo(100, 6), unit: '%' });
    expect(r.deltas.adr?.unit).toBe('%');
  });

  it('classe les dépenses du mois par catégorie avec leur part', () => {
    expect(r.expensesByCategory.map((c) => [c.category, c.amountHt, Math.round(c.share * 100)])).toEqual([['personnel', 5000000, 50], ['energy', 3000000, 30], ['other', 2000000, 20]]);
    expect(r.expensesByCategory[0].label).toContain('Personnel');
  });

  it('résume les créances actuelles et les plus anciennes', () => {
    expect(r.receivables).toMatchObject({ total: 6000000, reliable: 6000000, toReconcile: 0, over90: 6000000, count: 1, clientCount: 1 });
    expect(r.receivables.top[0].client).toBe('GROS');
  });

  it('signale les points d’attention utiles (factures en retard, créances anciennes) et rien d’inutile', () => {
    expect(r.attention.some((a) => a.includes('jusqu\'au 20/09/2026'))).toBe(true);
    expect(r.attention.some((a) => a.includes('créances ont plus de 90 jours'))).toBe(true);
    expect(r.attention.some((a) => a.includes('personnel'))).toBe(false);
  });

  it('avertit quand le personnel est absent et quand le mois est incomplet', () => {
    const noStaff = buildMonthlyReport(base({ expenses: [{ expense_date: '2026-09-12', amount_ht: 3000000, category: 'energy' }] }));
    expect(noStaff.attention.some((a) => a.includes('charge de personnel'))).toBe(true);
    const partial = buildMonthlyReport(base({ month: '2026-10', snapshots: days('2026-10', 10, 30, 3000000) }));
    expect(partial.asOf).toBe('2026-10-25');
    expect(partial.attention.some((a) => a.startsWith('Mois incomplet'))).toBe(true);
  });

  it('sans donnée pour le mois, ne plante pas et le dit', () => {
    const none = buildMonthlyReport(base({ month: '2026-03' }));
    expect(none.kpi.month).toBeNull();
    expect(none.attention[0]).toContain('Aucune donnée pour mars 2026');
  });

  it('le libellé du mois est en français', () => {
    expect(monthLabel('2026-02')).toBe('février 2026');
    expect(monthLabel('2026-12')).toBe('décembre 2026');
  });
});

describe('classeur Excel du rapport', () => {
  it('contient 4 feuilles avec de vrais nombres et les bons libellés', () => {
    const buf = reportWorkbook(buildMonthlyReport(base()), 'Hôtel Anjary', 'MGA');
    const wb = XLSX.read(buf, { type: 'buffer' });
    expect(wb.SheetNames).toEqual(['Synthèse', 'Dépenses', 'Créances', "Points d'attention"]);
    const syn = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['Synthèse'], { header: 1 });
    expect(syn[0]).toEqual(['Rapport mensuel - Hôtel Anjary']);
    const occ = syn.find((row) => row[0] === 'Occupation') as unknown[];
    expect(occ.slice(1)).toEqual([0.5, 0.4, expect.any(Number)]);
    const gop = syn.find((row) => row[0] === 'GOP') as unknown[];
    expect(gop[1]).toBe(10000000);
    const dep = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['Dépenses'], { header: 1 });
    expect(dep[1][1]).toBe(5000000);
  });
});
