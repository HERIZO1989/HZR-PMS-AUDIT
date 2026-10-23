'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatCurrency } from '@/lib/formatters';
import { EXPENSE_CATEGORIES } from '@/lib/expenses';

interface SupplierRow { key: string; label: string; count: number; amountHt: number }

/** Classer les fournisseurs encore en « Autres dépenses » : un geste par fournisseur, mémorisé pour les prochains imports. */
export function SupplierClassifier({ hotelId, currencyCode, onChanged }: { hotelId: string; currencyCode: string; onChanged: () => void }) {
  const [rows, setRows] = useState<SupplierRow[] | null>(null);
  const [total, setTotal] = useState({ suppliers: 0, ht: 0 });
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/expenses/suppliers?hotelId=${hotelId}`);
    if (res.status === 403) return setHidden(true);
    const json = await res.json();
    if (!res.ok) return setError(json.error ?? 'Échec du chargement');
    setRows(json.suppliers);
    setTotal({ suppliers: json.totalSuppliers, ht: json.totalHt });
  }, [hotelId]);

  useEffect(() => { void load(); }, [load]);

  async function apply(row: SupplierRow) {
    const category = choice[row.key];
    if (!category) return;
    setBusy(row.key);
    setError(null);
    setMessage(null);
    const res = await fetch('/api/expenses/reclassify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ supplier: row.label, category }),
    });
    const json = await res.json();
    setBusy(null);
    if (!res.ok) return setError(json.error ?? 'Échec du classement');
    const label = EXPENSE_CATEGORIES.find((c) => c.code === category)?.label ?? category;
    setMessage(`${row.label} : ${json.changed} dépense(s) classée(s) en « ${label} ». Les prochains imports suivront cette règle.`);
    await load();
    onChanged();
  }

  if (hidden || !rows || total.suppliers === 0) return null;
  const money = (n: number) => formatCurrency(n, currencyCode);

  return (
    <details className="panel mb-6 p-5">
      <summary className="cursor-pointer font-display text-lg">
        Classer les fournisseurs en « Autres dépenses » <span className="text-sm font-normal text-black/60">({total.suppliers} fournisseurs · {money(total.ht)} HT)</span>
      </summary>
      <p className="mt-2 text-sm text-black/70">Choisissez une catégorie par fournisseur : toutes ses dépenses sont reclassées et la règle est mémorisée pour les prochains imports. Les montants ne changent pas. Les charges de personnel (extras, intérimaires) doivent être classées en « Personnel » pour un GOP juste.</p>
      {message && <p role="status" className="mt-3 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm">{message}</p>}
      {error && <p role="alert" className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <ul className="mt-3 divide-y divide-black/10">
        {rows.map((r) => (
          <li key={r.key} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
            <span className="min-w-[10rem] flex-1">{r.label}<span className="block text-xs text-black/60">{r.count} dépense(s) · {money(r.amountHt)} HT</span></span>
            <select aria-label={`Catégorie de ${r.label}`} value={choice[r.key] ?? ''} onChange={(e) => setChoice((c) => ({ ...c, [r.key]: e.target.value }))} className="field w-auto max-w-[16rem]">
              <option value="">Choisir…</option>
              {EXPENSE_CATEGORIES.filter((c) => c.code !== 'other').map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select>
            <button onClick={() => apply(r)} disabled={!choice[r.key] || busy === r.key} className="btn-primary btn-sm">{busy === r.key ? 'Classement…' : 'Appliquer'}</button>
          </li>
        ))}
      </ul>
      {total.suppliers > rows.length && <p className="mt-3 text-xs text-black/60">Les {rows.length} plus gros fournisseurs sur {total.suppliers} sont affichés ; classez-les, puis les suivants apparaîtront.</p>}
    </details>
  );
}
