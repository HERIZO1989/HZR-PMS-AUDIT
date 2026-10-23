import { describe, expect, it } from 'vitest';
import { applySupplierRules, groupBySupplier, supplierRuleKey } from '../src/lib/expenseRules';
import type { ExpenseCategory } from '../src/lib/expenses';

describe('règles fournisseur → catégorie', () => {
  it('rapproche les variantes de casse, d’espaces et d’apostrophe', () => {
    expect(supplierRuleKey("  COMMUNE   URBAINE D 'ANTANANARIVO ")).toBe("commune urbaine d'antananarivo");
    expect(supplierRuleKey('Autres Services')).toBe(supplierRuleKey('AUTRES  SERVICES'));
    expect(supplierRuleKey(null)).toBe('');
  });

  it('regroupe par fournisseur normalisé, plus gros montants d’abord, sans les dépenses sans fournisseur', () => {
    const g = groupBySupplier([
      { supplier: 'STEP UP', amount_ht: 1000 }, { supplier: 'Step  Up', amount_ht: 500.5 },
      { supplier: 'PRAXI', amount_ht: 5000 }, { supplier: null, amount_ht: 99999 }, { supplier: '  ', amount_ht: 1 },
    ]);
    expect(g.map((x) => [x.key, x.count, x.amountHt])).toEqual([['praxi', 1, 5000], ['step up', 2, 1500.5]]);
    expect(g[1].rawNames).toEqual(['STEP UP', 'Step  Up']);
  });

  it('applique les règles de l’hôtel par-dessus la catégorie déduite, sans toucher aux autres lignes', () => {
    const rules = new Map<string, ExpenseCategory>([['autres services', 'personnel'], ['quincaillerie tsaradia', 'supplies']]);
    const rows = [
      { supplier: 'Autres Services', category: 'other' as ExpenseCategory, n: 1 },
      { supplier: 'QUINCAILLERIE TSARADIA', category: 'maintenance' as ExpenseCategory, n: 2 },
      { supplier: 'Jirama', category: 'energy' as ExpenseCategory, n: 3 },
      { supplier: null, category: 'other' as ExpenseCategory, n: 4 },
    ];
    expect(applySupplierRules(rows, rules).map((r) => r.category)).toEqual(['personnel', 'supplies', 'energy', 'other']);
    expect(applySupplierRules(rows, new Map())).toBe(rows);
  });
});
