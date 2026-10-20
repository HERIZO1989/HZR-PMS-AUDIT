// Export Odoo « Bons de commande fournisseur » lu comme journal de dépenses.
// Colonnes de l'export : Priorité, Référence de commande, Arrivée, Fournisseur, Acheteur,
// Échéance de commande, Activités, Document d'origine, Total, Statut.
// L'export n'a ni catégorie ni détail d'articles : la catégorie est déduite du fournisseur.

import type { ExpenseCategory } from './expenses';

const norm = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[°º]/g, '').trim().toLowerCase();

/** Un total inférieur à ce seuil n'est pas crédible en Ariary (Booking.com, Expedia, Air Austral…) : probablement une autre devise. */
export const CURRENCY_REVIEW_THRESHOLD = 1000;

/** Seuls ces statuts sont de vraies dépenses ; Annulé, Demande de prix, etc. sont écartés et comptés. */
const INCLUDED_STATUSES = new Set(['bon de commande fournisseur', 'bon de commande', 'verrouille']);

const REF_COLUMN = 'reference de commande';
const DATE_COLUMNS = ['echeance de commande', 'date de commande', 'date de confirmation', 'date limite de commande'];
const TOTAL_COLUMNS = ['total', 'montant total'];

/** Variantes d'un même fournisseur dans Odoo → libellé unique (clé : nom normalisé, apostrophes recollées). */
const SUPPLIER_ALIASES: Record<string, string> = {
  'autre achat': 'Autres achat',
  "commune urbaine d'antananarivo": "Commune Urbaine d'Antananarivo",
  'papietrie moderne': 'PAPETERIE MODERNE',
  'quicaillerie tsaradia': 'QUINCAILLERIE TSARADIA',
  'quicaillerie moravidy (mr romuald)': 'QUINCAILLERIE MORA VIDY',
  'quincaillerie tsimanavaka': 'QUINCAILLERIE TSY MANAVAKA',
  'quincaillerie geberal mme dina': 'QUINCAILLERIE GENERALE MME DINA',
};

/** Règles fournisseur → catégorie, dans l'ordre ; premier fragment trouvé gagne. Modifiable sans toucher au reste. */
export const SUPPLIER_CATEGORY_RULES: { match: string[]; category: ExpenseCategory }[] = [
  { match: ['jirama', 'galana', 'station jovena', 'station galana'], category: 'energy' },
  { match: ['airtel', 'madagascar towers', 'telecom malagasy', 'canal+', 'jose telephone'], category: 'telecom' },
  { match: ['booking.com', 'expedia'], category: 'commissions' },
  { match: ['centre fiscal', 'commune urbaine', 'ministere du tourisme'], category: 'taxes' },
  { match: ['sanlam', 'allianz'], category: 'insurance' },
  { match: ['biskot', 'little india', 'arlequin', 'restaurant', 'mix market', 'mirchi massala'], category: 'food' },
  { match: ['lave and go', 'pressing'], category: 'laundry' },
  { match: ['ecoclean'], category: 'supplies' },
  { match: ['papeterie', 'papietrie', 'imprimerie', 'print shop', 'bureau net', "cart'in", 'cbl repro'], category: 'office' },
  {
    match: ['quincaillerie', 'quicaillerie', 'quincaillere', 'vitrerie', 'centre technique', 'terlin', 'pieces electriques',
      'auto pieces', 'auto import', 'bricoflex', 'batimax', 'climatel', 'technicien', 'reparation'],
    category: 'maintenance',
  },
];

const supplierKey = (name: string) => norm(name).replace(/\s*'\s*/g, "'").replace(/\s+/g, ' ');

export function normalizeSupplier(name: unknown): string | null {
  const raw = String(name ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return null;
  return SUPPLIER_ALIASES[supplierKey(raw)] ?? raw;
}

export function categoryFromSupplier(name: unknown): ExpenseCategory {
  const key = supplierKey(String(name ?? ''));
  for (const rule of SUPPLIER_CATEGORY_RULES) {
    if (rule.match.some((m) => key.includes(m))) return rule.category;
  }
  return 'other';
}

/** Retrouve une colonne de l'export quelle que soit la casse ou l'accentuation de son en-tête. */
function pick(row: Record<string, unknown>, names: string[]): unknown {
  const byKey = new Map(Object.entries(row).map(([k, v]) => [norm(k), v]));
  for (const n of names) {
    const v = byKey.get(n);
    if (v !== undefined && String(v).trim() !== '') return v;
  }
  return undefined;
}

export function isOdooPurchaseOrderHeaders(keys: string[]): boolean {
  const k = new Set(keys.map(norm));
  return k.has(REF_COLUMN) && k.has('fournisseur') && k.has('statut') && TOTAL_COLUMNS.some((t) => k.has(t));
}

export type OdooRowResult =
  | { kind: 'blank' }
  | { kind: 'skipped'; statusLabel: string }
  | { kind: 'row'; mapped: Record<string, unknown>; sourceKey?: string; needsReview: boolean };

export function mapOdooPurchaseOrderRow(row: Record<string, unknown>): OdooRowResult {
  const ref = String(pick(row, [REF_COLUMN]) ?? '').trim();
  const supplierRaw = pick(row, ['fournisseur']);
  const totalRaw = pick(row, TOTAL_COLUMNS);
  if (!ref && supplierRaw === undefined && totalRaw === undefined) return { kind: 'blank' };

  const statusLabel = String(pick(row, ['statut']) ?? '').trim();
  if (!INCLUDED_STATUSES.has(norm(statusLabel))) return { kind: 'skipped', statusLabel: statusLabel || '(sans statut)' };

  const supplier = normalizeSupplier(supplierRaw);
  const total = typeof totalRaw === 'number' ? totalRaw : Number(String(totalRaw ?? '').replace(/[\s\u00a0\u202f]/g, '').replace(',', '.'));
  const needsReview = Number.isFinite(total) && total > 0 && total < CURRENCY_REVIEW_THRESHOLD;
  const label = ref ? `Bon de commande ${ref}` : 'Bon de commande';

  return {
    kind: 'row',
    needsReview,
    // Clé d'idempotence = la référence Odoo : recharger le fichier, ou changer les règles de catégorie, ne crée jamais de doublon.
    sourceKey: ref ? `odoo_po|${ref.toLowerCase()}` : undefined,
    mapped: {
      expense_date: pick(row, DATE_COLUMNS),
      category: categoryFromSupplier(supplier),
      description: needsReview ? `À vérifier (montant inférieur à 1 000, devise ?) - ${label}` : label,
      supplier,
      document_number: ref || null,
      payment_method: '',
      amount_ttc: totalRaw,
      vat_deductible: 0,
    },
  };
}
