import { describe, expect, it } from 'vitest';
import { buildFindings, type AuditInput, type AuditInvoice } from '../src/lib/audit';
import { summarizeDeposits } from '../src/lib/deposits';

const inv = (invoice_number: string | null, partner_name: string, invoice_date: string, amount_ttc: number, payment_status: string, payment_date: string | null = null): AuditInvoice =>
  ({ invoice_number, partner_name, invoice_date, due_date: null, amount_ttc, payment_status, payment_date });

const base = (over: Partial<AuditInput> = {}): AuditInput => ({
  today: '2026-10-24',
  invoices: [],
  confirmedPast: [],
  noRoomType: { count: 0, examples: [] },
  expenses: { approvedHt: 1000, otherHt: 0, topOtherSuppliers: [], pendingCount: 0, pendingHt: 0, personnelApprovedHt: 100 },
  deposits: summarizeDeposits([], '2026-10-24'),
  ...over,
});
const find = (input: AuditInput, id: string) => buildFindings(input).find((f) => f.id === id)!;

describe('contrôles d’audit', () => {
  it('une base saine donne uniquement des contrôles conformes', () => {
    const f = buildFindings(base({ invoices: [inv('FAC/1', 'A', '2026-10-20', 1000, 'paid', '2026-10-21')] }));
    expect(f.every((x) => x.severity === 'ok')).toBe(true);
  });

  it('détecte les numéros de facture portés par plusieurs factures, avec montant et exemples', () => {
    const f = find(base({ invoices: [
      inv('FAC/2026/00030', 'Transfert', '2026-01-20', 21000, 'unpaid'), inv('FAC/2026/00030', 'FAZELE', '2026-01-27', 11000, 'paid', '2026-01-27'),
      inv('FAC/2026/00032', 'X', '2026-02-01', 5000, 'paid', '2026-02-01'),
      inv(null, 'Sans numero', '2026-02-02', 1, 'unpaid'), inv(null, 'Autre sans numero', '2026-02-03', 1, 'unpaid'),
    ] }), 'duplicate-invoice-numbers');
    expect(f).toMatchObject({ severity: 'high', count: 1, amount: 32000 });
    expect(f.examples[0]).toEqual(['FAC/2026/00030', '2', 'Transfert / FAZELE', '32 000']);
  });

  it('mesure les créances de plus de 90 jours, leur part et les principaux débiteurs', () => {
    const f = find(base({ invoices: [
      inv('F1', 'GROS DEBITEUR', '2026-05-01', 600000, 'unpaid'), inv('F2', 'GROS DEBITEUR', '2026-06-01', 200000, 'partial'),
      inv('F3', 'PETIT', '2026-07-01', 100000, 'unpaid'),
      inv('F4', 'RECENT', '2026-10-10', 100000, 'unpaid'),
      inv('F5', 'SOLDE', '2026-01-01', 999999, 'paid', '2026-01-02'),
    ] }), 'aged-receivables');
    // 24/10 : F1 (176 j), F2 (145 j) et F3 (115 j) dépassent 90 jours ; F4 (14 j) non ; F5 est payée.
    expect(f).toMatchObject({ severity: 'high', count: 3, amount: 900000 });
    expect(f.detail).toContain('90 %');
    expect(f.examples[0]).toEqual(['GROS DEBITEUR', '2', '2026-05-01', '800 000']);
  });

  it('une petite part de créances anciennes reste « à traiter » et non critique', () => {
    const f = find(base({ invoices: [inv('F1', 'A', '2026-05-01', 10, 'unpaid'), inv('F2', 'B', '2026-10-20', 1000, 'unpaid')] }), 'aged-receivables');
    expect(f.severity).toBe('medium');
  });

  it('signale les séjours terminés restés « Confirmé » avec leurs nuits et leur montant', () => {
    const f = find(base({ confirmedPast: [
      { confirmation_number: 'B1', arrival_date: '2026-09-01', departure_date: '2026-09-04', total_amount: 300000 },
      { confirmation_number: 'B2', arrival_date: '2026-09-10', departure_date: '2026-09-12', total_amount: 500000 },
    ] }), 'confirmed-past-stays');
    expect(f).toMatchObject({ severity: 'medium', count: 2, amount: 800000 });
    expect(f.detail).toContain('5 nuits');
    expect(f.examples[0][0]).toBe('B2');
  });

  it('classe les dépenses non classées selon leur part et signale l’absence de personnel', () => {
    const f = find(base({ expenses: { approvedHt: 1000, otherHt: 367, topOtherSuppliers: [{ label: 'STEP UP', count: 13, amountHt: 200 }], pendingCount: 2, pendingHt: 50, personnelApprovedHt: 0 } }), 'unclassified-expenses');
    expect(f).toMatchObject({ severity: 'medium', amount: 367 });
    expect(f.examples[0]).toEqual(['STEP UP', '13', '200']);
    expect(find(base({ expenses: { approvedHt: 1000, otherHt: 0, topOtherSuppliers: [], pendingCount: 2, pendingHt: 50, personnelApprovedHt: 0 } }), 'missing-payroll').severity).toBe('high');
    expect(find(base({ expenses: { approvedHt: 1000, otherHt: 0, topOtherSuppliers: [], pendingCount: 2, pendingHt: 50, personnelApprovedHt: 0 } }), 'pending-expenses')).toMatchObject({ severity: 'low', count: 2, amount: 50 });
  });

  it('signale les acomptes à reporter (critique) et ceux d’annulations à traiter', () => {
    const deposits = summarizeDeposits([
      { amount: 70000, status: 'held', received_at: '2026-10-10T10:00:00Z', resolved_at: null, reservation_status: 'checked_in' },
      { amount: 80000, status: 'held', received_at: '2026-09-20T10:00:00Z', resolved_at: null, reservation_status: 'cancelled' },
    ], '2026-10-24');
    expect(find(base({ deposits }), 'deposits-to-apply')).toMatchObject({ severity: 'high', count: 1, amount: 70000 });
    expect(find(base({ deposits }), 'deposits-to-resolve')).toMatchObject({ severity: 'medium', count: 1, amount: 80000 });
  });

  it('trie les contrôles du plus grave au conforme', () => {
    const order = buildFindings(base({ invoices: [inv('F', 'A', '2026-01-01', 10, 'unpaid'), inv('F', 'B', '2026-01-02', 10, 'unpaid')], noRoomType: { count: 3, examples: [] } })).map((f) => f.severity);
    const rank = { high: 0, medium: 1, low: 2, ok: 3 };
    expect(order).toEqual([...order].sort((a, b) => rank[a as keyof typeof rank] - rank[b as keyof typeof rank]));
    expect(order[0]).toBe('high');
  });
});
