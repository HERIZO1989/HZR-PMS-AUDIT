// Regles fournisseur -> categorie saisies par l'hotel : elles priment sur les categories deduites automatiquement a l'import.
import type { ExpenseCategory } from './expenses';

/** Cle de rapprochement d'un fournisseur : espaces recolles, apostrophes recollees, casse ignoree. */
export function supplierRuleKey(name: unknown): string {
  return String(name ?? '').replace(/\s+/g, ' ').trim().replace(/\s*'\s*/g, "'").toLowerCase();
}

export interface SupplierGroup { key: string; label: string; count: number; amountHt: number; rawNames: string[] }

/** Regroupe des depenses par fournisseur normalise (plus gros montants d'abord) ; les depenses sans fournisseur sont ignorees. */
export function groupBySupplier(rows: { supplier: string | null; amount_ht: number | string }[]): SupplierGroup[] {
  const groups = new Map<string, SupplierGroup>();
  for (const r of rows) {
    if (!r.supplier || !r.supplier.trim()) continue;
    const key = supplierRuleKey(r.supplier);
    const g = groups.get(key) ?? { key, label: r.supplier.replace(/\s+/g, ' ').trim(), count: 0, amountHt: 0, rawNames: [] };
    g.count += 1; g.amountHt = Math.round((g.amountHt + Number(r.amount_ht)) * 100) / 100;
    if (!g.rawNames.includes(r.supplier)) g.rawNames.push(r.supplier);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.amountHt - a.amountHt);
}

/** Applique les regles de l'hotel : la categorie de la regle remplace celle deduite a l'import. */
export function applySupplierRules<T extends { supplier: string | null; category: ExpenseCategory }>(rows: T[], rules: Map<string, ExpenseCategory>): T[] {
  if (rules.size === 0) return rows;
  return rows.map((r) => {
    const cat = r.supplier ? rules.get(supplierRuleKey(r.supplier)) : undefined;
    return cat && cat !== r.category ? { ...r, category: cat } : r;
  });
}
