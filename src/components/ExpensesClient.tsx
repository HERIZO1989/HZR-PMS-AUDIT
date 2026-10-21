'use client';

import { useCallback, useEffect, useState } from 'react';
import { EXPENSE_CATEGORIES, PAYMENT_METHODS, type ExpenseKpis, type ExpenseSummary } from '@/lib/expenses';
import { formatCurrency, formatDate, formatPercent } from '@/lib/formatters';

interface ExpenseItem {
  id: string;
  expense_date: string;
  category: string;
  description: string | null;
  supplier: string | null;
  document_number: string | null;
  payment_method: string;
  amount_ttc: number | string;
  amount_ht: number | string;
  status: 'pending' | 'approved' | 'rejected';
  created_by: string | null;
  rejection_reason: string | null;
}

interface Payload {
  from: string;
  to: string;
  expenses: ExpenseItem[];
  summary: ExpenseSummary;
  kpis: ExpenseKpis;
  canApprove: boolean;
  currentStaffUserId: string;
}

interface ImportResult {
  inserted: number;
  alreadyPresent: number;
  duplicatesInFile: number;
  invalidCount: number;
  invalid: { row: number; errors: string[] }[];
  format?: 'journal' | 'odoo_po';
  skippedByStatus?: Record<string, number>;
  needsReviewCount?: number;
}

const CATEGORY_LABELS = Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c.code, c.label]));
const METHOD_LABELS = Object.fromEntries(PAYMENT_METHODS.map((m) => [m.code, m.label]));
const STATUS_LABELS = { pending: 'En attente', approved: 'Approuvée', rejected: 'Rejetée' } as const;
const STATUS_STYLES = {
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-800',
} as const;

function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  const end = `${month}-${String(last).padStart(2, '0')}`;
  const today = todayLocal();
  return { from: `${month}-01`, to: end > today ? today : end };
}

const EMPTY_FORM = {
  expense_date: todayLocal(),
  category: 'other',
  description: '',
  supplier: '',
  document_number: '',
  payment_method: 'cash',
  amount_ttc: '',
  vat_deductible: '',
};

export function ExpensesClient({ hotelId, currencyCode }: { hotelId: string; currencyCode: string }) {
  const [month, setMonth] = useState(todayLocal().slice(0, 7));
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const money = (n: number | string) => formatCurrency(Number(n), currencyCode);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { from, to } = monthRange(month);
    const res = await fetch(`/api/expenses?hotelId=${hotelId}&from=${from}&to=${to}`);
    const json = await res.json();
    setLoading(false);
    if (!res.ok) { setData(null); return setError(json.error ?? 'Impossible de charger les dépenses'); }
    setData(json);
  }, [hotelId, month]);

  useEffect(() => { void load(); }, [load]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    const res = await fetch('/api/expenses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        amount_ttc: form.amount_ttc,
        vat_deductible: form.vat_deductible,
        idempotency_key: `ui-${crypto.randomUUID()}`,
      }),
    });
    const json = await res.json();
    setSaving(false);
    if (!res.ok) return setFormError(json.error ?? "Échec de l'enregistrement");
    setForm({ ...EMPTY_FORM, expense_date: form.expense_date, category: form.category });
    void load();
  }

  async function handleDecision(id: string, action: 'approve' | 'reject') {
    let reason = '';
    if (action === 'reject') {
      reason = window.prompt('Motif du rejet ?')?.trim() ?? '';
      if (!reason) return;
    }
    const res = await fetch(`/api/expenses/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, reason }),
    });
    if (!res.ok) setError((await res.json()).error ?? 'Échec');
    void load();
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Supprimer cette dépense en attente ?')) return;
    const res = await fetch(`/api/expenses/${id}`, { method: 'DELETE' });
    if (!res.ok) setError((await res.json()).error ?? 'Échec');
    void load();
  }

  async function handleImport() {
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    setError(null);
    const body = new FormData();
    body.append('file', file);
    body.append('hotelId', hotelId);
    const res = await fetch('/api/expenses/import', { method: 'POST', body });
    const json = await res.json();
    setImporting(false);
    if (!res.ok) return setError(json.error ?? "Échec de l'import");
    setImportResult(json);
    setFile(null);
    void load();
  }

  const k = data?.kpis;
  const s = data?.summary;

  return (
    <div className="max-w-6xl">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Dépenses</h1>
          <p className="page-subtitle">Journal quotidien, synthèse mensuelle et indicateurs avec charges (hors taxe)</p>
        </div>
        <div>
          <label htmlFor="expenses-month" className="field-label">Mois</label>
          <input id="expenses-month" type="month" value={month} max={todayLocal().slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} className="field" />
        </div>
      </header>

      {error && <p role="alert" className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      {k && s && (
        <section aria-label="Indicateurs" className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="panel p-4"><p className="field-label">Dépenses approuvées (HT)</p><p className="text-xl font-semibold tabular">{money(s.approved.ht)}</p><p className="text-xs text-black/60">{s.approved.count} dépense(s) · en attente : {s.pending.count} ({money(s.pending.ht)})</p></div>
          <div className="panel p-4"><p className="field-label">Recettes (HT)</p><p className="text-xl font-semibold tabular">{money(k.revenue)}</p><p className="text-xs text-black/60">Selon les indicateurs du PMS</p></div>
          <div className="panel p-4"><p className="field-label">GOP</p><p className="text-xl font-semibold tabular">{money(k.gop)}</p><p className="text-xs text-black/60">Marge : {formatPercent(k.gopMargin)}</p></div>
          <div className="panel p-4"><p className="field-label">GOPPAR</p><p className="text-xl font-semibold tabular">{money(k.goppar)}</p><p className="text-xs text-black/60">GOP par chambre disponible</p></div>
          <div className="panel p-4"><p className="field-label">CPOR</p><p className="text-xl font-semibold tabular">{money(k.cpor)}</p><p className="text-xs text-black/60">Dépenses par chambre occupée</p></div>
          <div className="panel p-4"><p className="field-label">Dépenses / recettes</p><p className="text-xl font-semibold tabular">{formatPercent(k.expenseRatio)}</p><p className="text-xs text-black/60">{money(k.expensePerAvailableRoom)} par chambre disponible</p></div>
        </section>
      )}

      <form onSubmit={handleAdd} className="panel mb-6 grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <h2 className="sm:col-span-2 lg:col-span-4 font-display text-lg">Ajouter une dépense</h2>
        <div><label htmlFor="exp-date" className="field-label">Date</label><input id="exp-date" type="date" required max={todayLocal()} value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} className="field" /></div>
        <div className="lg:col-span-2"><label htmlFor="exp-cat" className="field-label">Catégorie</label>
          <select id="exp-cat" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="field">
            {EXPENSE_CATEGORIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
          </select></div>
        <div><label htmlFor="exp-method" className="field-label">Mode de paiement</label>
          <select id="exp-method" value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value })} className="field">
            {PAYMENT_METHODS.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
          </select></div>
        <div className="lg:col-span-2"><label htmlFor="exp-desc" className="field-label">Description</label><input id="exp-desc" maxLength={500} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="field" /></div>
        <div><label htmlFor="exp-supplier" className="field-label">Fournisseur</label><input id="exp-supplier" maxLength={120} value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} className="field" /></div>
        <div><label htmlFor="exp-doc" className="field-label">N° de pièce</label><input id="exp-doc" maxLength={60} value={form.document_number} onChange={(e) => setForm({ ...form, document_number: e.target.value })} className="field" /></div>
        <div><label htmlFor="exp-ttc" className="field-label">Montant TTC</label><input id="exp-ttc" type="number" required min="1" step="any" inputMode="decimal" value={form.amount_ttc} onChange={(e) => setForm({ ...form, amount_ttc: e.target.value })} className="field tabular" /></div>
        <div><label htmlFor="exp-vat" className="field-label">TVA déductible</label><input id="exp-vat" type="number" min="0" step="any" inputMode="decimal" value={form.vat_deductible} onChange={(e) => setForm({ ...form, vat_deductible: e.target.value })} className="field tabular" /></div>
        <div className="flex items-end"><button type="submit" disabled={saving} className="btn-primary">{saving ? 'Enregistrement…' : 'Enregistrer'}</button></div>
        {formError && <p role="alert" className="sm:col-span-2 lg:col-span-4 text-sm text-red-700">{formError}</p>}
      </form>

      <div className="panel mb-6 flex flex-col gap-3 p-5">
        <h2 className="font-display text-lg">Importer le journal des dépenses</h2>
        <p className="text-sm text-black/70">Chargez le classeur « Anjary_depenses_et_marge.xlsx » rempli (feuille « Journal des dépenses »), un CSV avec les mêmes colonnes, ou l'export Odoo des bons de commande fournisseur (catégorie déduite du fournisseur). Recharger le même fichier ne crée pas de doublon.</p>
        <div className="flex flex-wrap items-center gap-3">
          <input type="file" accept=".xlsx,.xls,.csv,.txt" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="field cursor-pointer file:mr-4 file:cursor-pointer file:rounded-sm file:border-0 file:bg-steel-tint file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-steel-dim sm:w-auto" />
          <button type="button" onClick={handleImport} disabled={!file || importing} className="btn-secondary">{importing ? 'Import…' : 'Importer'}</button>
        </div>
        {importResult && (
          <div className="text-sm">
            <p><strong>{importResult.inserted}</strong> dépense(s) ajoutée(s) · {importResult.alreadyPresent} déjà présente(s) · {importResult.duplicatesInFile} doublon(s) dans le fichier · {importResult.invalidCount} ligne(s) refusée(s)</p>
            {importResult.skippedByStatus && Object.keys(importResult.skippedByStatus).length > 0 && (
              <p className="mt-1 text-black/70">Ignorées selon leur statut : {Object.entries(importResult.skippedByStatus).map(([s, n]) => `${s} (${n})`).join(', ')}</p>
            )}
            {(importResult.needsReviewCount ?? 0) > 0 && (
              <p className="mt-1 text-amber-800">{importResult.needsReviewCount} dépense(s) au montant douteux (inférieur à 1 000, devise ?) sont en attente : vérifiez-les puis approuvez-les.</p>
            )}
            {importResult.invalid.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-red-800">
                {importResult.invalid.slice(0, 10).map((r) => <li key={r.row}>Ligne {r.row} : {r.errors.join(' ; ')}</li>)}
                {importResult.invalidCount > 10 && <li>… et {importResult.invalidCount - 10} autre(s)</li>}
              </ul>
            )}
          </div>
        )}
      </div>

      {loading && <p className="mb-4 text-sm text-black/60">Chargement…</p>}

      {s && s.byCategory.length > 0 && (
        <div className="panel mb-6 overflow-x-auto">
          <h2 className="p-5 pb-0 font-display text-lg">Par catégorie (approuvées, HT)</h2>
          <table className="data-table mt-3">
            <thead><tr><th>Catégorie</th><th className="num">Montant HT</th><th className="num">Part</th></tr></thead>
            <tbody>{s.byCategory.map((c) => (
              <tr key={c.category}><td>{CATEGORY_LABELS[c.category] ?? c.category}</td><td className="num tabular">{money(c.ht)}</td><td className="num tabular">{formatPercent(c.share)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {s && s.byDay.length > 0 && (
        <div className="panel mb-6 overflow-x-auto">
          <h2 className="p-5 pb-0 font-display text-lg">Par jour (approuvées)</h2>
          <table className="data-table mt-3">
            <thead><tr><th>Jour</th><th className="num">HT</th><th className="num">TTC</th></tr></thead>
            <tbody>{[...s.byDay].reverse().map((d) => (
              <tr key={d.date}><td>{formatDate(d.date)}</td><td className="num tabular">{money(d.ht)}</td><td className="num tabular">{money(d.ttc)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}

      <div className="panel overflow-x-auto">
        <h2 className="p-5 pb-0 font-display text-lg">Journal du mois</h2>
        <table className="data-table mt-3">
          <thead><tr><th>Date</th><th>Catégorie</th><th>Détail</th><th>Paiement</th><th className="num">TTC</th><th className="num">HT</th><th>Statut</th><th></th></tr></thead>
          <tbody>
            {data?.expenses.length === 0 && <tr><td colSpan={8} className="text-center text-black/60">Aucune dépense sur cette période.</td></tr>}
            {data?.expenses.map((x) => (
              <tr key={x.id}>
                <td className="whitespace-nowrap">{formatDate(x.expense_date)}</td>
                <td>{CATEGORY_LABELS[x.category] ?? x.category}</td>
                <td>{[x.description, x.supplier, x.document_number].filter(Boolean).join(' · ') || '—'}{x.status === 'rejected' && x.rejection_reason ? <span className="block text-xs text-red-700">Rejet : {x.rejection_reason}</span> : null}</td>
                <td>{METHOD_LABELS[x.payment_method] ?? x.payment_method}</td>
                <td className="num tabular">{money(x.amount_ttc)}</td>
                <td className="num tabular">{money(x.amount_ht)}</td>
                <td><span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[x.status]}`}>{STATUS_LABELS[x.status]}</span></td>
                <td className="whitespace-nowrap">
                  {x.status === 'pending' && data.canApprove && (
                    <>
                      <button type="button" onClick={() => handleDecision(x.id, 'approve')} className="row-action mr-2">Approuver</button>
                      <button type="button" onClick={() => handleDecision(x.id, 'reject')} className="row-action mr-2">Rejeter</button>
                    </>
                  )}
                  {x.status === 'pending' && (x.created_by === data.currentStaffUserId || data.canApprove) && (
                    <button type="button" onClick={() => handleDelete(x.id)} className="row-action">Supprimer</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
