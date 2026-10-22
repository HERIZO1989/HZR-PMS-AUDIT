'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatCurrency, formatDate, formatPercent } from '@/lib/formatters';
import { PAYMENT_STATUSES, type RevenueSummary } from '@/lib/invoices';

interface InvoiceRow {
  id: string;
  invoice_number: string | null;
  partner_name: string;
  invoice_date: string;
  due_date: string | null;
  amount_ttc: number;
  payment_status: string;
  payment_date: string | null;
}

interface InvoicesResponse {
  asOf: string;
  from: string;
  to: string;
  summary: RevenueSummary;
  invoices: InvoiceRow[];
  listLimit: number;
}

interface ImportResult {
  inserted: number;
  updated: number;
  unchanged: number;
  duplicatesInFile: number;
  invalidCount: number;
  invalid: { row: number; errors: string[] }[];
  skippedByStatus: Record<string, number>;
}

const STATUS_LABELS = Object.fromEntries(PAYMENT_STATUSES.map((s) => [s.code, s.label]));
const STATUS_STYLES: Record<string, string> = {
  paid: 'bg-emerald-100 text-emerald-800',
  in_payment: 'bg-sky-100 text-sky-800',
  partial: 'bg-amber-100 text-amber-800',
  unpaid: 'bg-red-100 text-red-800',
  reversed: 'bg-gray-100 text-gray-700',
};
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const todayLocal = () => new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);

export function InvoicesClient({ hotelId, currencyCode, canManage }: { hotelId: string; currencyCode: string; canManage: boolean }) {
  const [asOf, setAsOf] = useState(todayLocal());
  const [paymentStatus, setPaymentStatus] = useState('');
  const [q, setQ] = useState('');
  const [data, setData] = useState<InvoicesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const money = (n: number) => formatCurrency(n, currencyCode);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ hotelId, asOf });
    if (paymentStatus) params.set('paymentStatus', paymentStatus);
    if (q.trim()) params.set('q', q.trim());
    const res = await fetch(`/api/invoices?${params}`);
    const json = await res.json();
    setLoading(false);
    if (!res.ok) return setError(json.error ?? 'Échec du chargement');
    setError(null);
    setData(json);
  }, [hotelId, asOf, paymentStatus, q]);

  useEffect(() => {
    const t = setTimeout(() => void load(), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  async function handleImport(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setImporting(true);
    setError(null);
    const body = new FormData();
    body.append('file', file);
    body.append('hotelId', hotelId);
    const res = await fetch('/api/invoices/import', { method: 'POST', body });
    const json = await res.json();
    setImporting(false);
    if (!res.ok) return setError(json.error ?? "Échec de l'import");
    setImportResult(json);
    setFile(null);
    void load();
  }

  const s = data?.summary;
  const maxMonth = s ? Math.max(1, ...s.monthly.map((m) => m.ttc)) : 1;
  const monthDelta = s && s.previousMonth.ttc > 0 ? s.month.ttc / s.previousMonth.ttc - 1 : null;

  return (
    <div className="max-w-6xl">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Factures &amp; chiffre d&apos;affaires</h1>
          <p className="page-subtitle">CA facturé du jour, du mois et de l&apos;année, encaissements et créances (registre des factures Odoo)</p>
        </div>
        <div>
          <label htmlFor="inv-asof" className="field-label">Situation au</label>
          <input id="inv-asof" type="date" value={asOf} max={todayLocal()} onChange={(e) => e.target.value && setAsOf(e.target.value)} className="field" />
        </div>
      </header>

      {error && <p role="alert" className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      {s && (
        <>
          <section aria-label="Chiffre d'affaires" className="mb-4 grid gap-3 sm:grid-cols-3">
            <div className="panel p-4"><p className="field-label">CA du jour (TTC)</p><p className="text-xl font-semibold tabular">{money(s.day.ttc)}</p><p className="text-xs text-black/60">HT {money(s.day.ht)} · {s.day.count} facture(s)</p></div>
            <div className="panel p-4"><p className="field-label">CA du mois (TTC)</p><p className="text-xl font-semibold tabular">{money(s.month.ttc)}</p><p className="text-xs text-black/60">HT {money(s.month.ht)} · {s.month.count} facture(s){monthDelta !== null && ` · ${monthDelta >= 0 ? '+' : ''}${formatPercent(monthDelta)} vs mois précédent`}</p></div>
            <div className="panel p-4"><p className="field-label">CA de l&apos;année (TTC)</p><p className="text-xl font-semibold tabular">{money(s.year.ttc)}</p><p className="text-xs text-black/60">HT {money(s.year.ht)} · {s.year.count} facture(s)</p></div>
          </section>

          <section aria-label="Encaissements et créances" className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="panel p-4"><p className="field-label">Encaissé du jour</p><p className="text-xl font-semibold tabular">{money(s.cashed.day.ttc)}</p><p className="text-xs text-black/60">{s.cashed.day.count} règlement(s)</p></div>
            <div className="panel p-4"><p className="field-label">Encaissé du mois</p><p className="text-xl font-semibold tabular">{money(s.cashed.month.ttc)}</p><p className="text-xs text-black/60">Année : {money(s.cashed.year.ttc)}</p></div>
            <div className="panel p-4"><p className="field-label">Créances</p><p className="text-xl font-semibold tabular">{money(s.receivables.ttc)}</p><p className="text-xs text-black/60">{s.receivables.count} facture(s) non soldée(s){s.receivables.partialCount > 0 && ` dont ${s.receivables.partialCount} partielle(s) (montant réglé inconnu)`}</p></div>
            <div className="panel p-4"><p className="field-label">Dont échues</p><p className="text-xl font-semibold tabular text-red-700">{money(s.receivables.overdueTtc)}</p><p className="text-xs text-black/60">{s.receivables.overdueCount} facture(s) après échéance</p></div>
          </section>

          <section aria-label="CA par mois" className="panel mb-6 p-5">
            <h2 className="mb-3 font-display text-lg">CA par mois, {s.asOf.slice(0, 4)} (TTC)</h2>
            <ul className="grid gap-1.5">
              {s.monthly.map((m, i) => (
                <li key={m.month} className="grid grid-cols-[3.5rem_1fr_9rem] items-center gap-3 text-sm">
                  <span className="text-black/70">{MONTHS[i]}</span>
                  <span className="h-3 rounded bg-black/5"><span className="block h-3 rounded bg-brass" style={{ width: `${(m.ttc / maxMonth) * 100}%` }} /></span>
                  <span className="text-right tabular">{money(m.ttc)}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {canManage && (
        <form onSubmit={handleImport} className="panel mb-6 flex flex-col gap-3 p-5">
          <h2 className="font-display text-lg">Importer les factures Odoo</h2>
          <p className="text-sm text-black/70">Chargez l&apos;export Odoo « Pièces comptables ». Seules les factures comptabilisées comptent ; les annulées et brouillons sont ignorés. Le numéro de facture n&apos;étant pas unique dans Odoo, une facture est reconnue par numéro, client, date et montant : recharger un export plus récent met à jour les paiements sans créer de doublon.</p>
          <div className="flex flex-wrap items-center gap-3">
            <input type="file" accept=".xlsx,.xls,.csv" aria-label="Fichier des factures" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
            <button type="submit" disabled={!file || importing} className="btn-primary">{importing ? 'Import en cours…' : 'Importer'}</button>
          </div>
          {importResult && (
            <div role="status" className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm">
              <p>{importResult.inserted} nouvelle(s) facture(s) · {importResult.updated} mise(s) à jour (paiement) · {importResult.unchanged} inchangée(s) · {importResult.duplicatesInFile} doublon(s) dans le fichier · {importResult.invalidCount} ligne(s) refusée(s)</p>
              {Object.keys(importResult.skippedByStatus).length > 0 && (
                <p className="mt-1 text-black/70">Ignorées selon leur statut : {Object.entries(importResult.skippedByStatus).map(([st, n]) => `${st} (${n})`).join(', ')}</p>
              )}
              {importResult.invalid.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-red-800">
                  {importResult.invalid.map((x) => <li key={x.row}>Ligne {x.row} : {x.errors.join(' ; ')}</li>)}
                </ul>
              )}
            </div>
          )}
        </form>
      )}

      <section aria-label="Liste des factures" className="panel p-5">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-display text-lg">Factures{data ? ` du ${formatDate(data.from)} au ${formatDate(data.to)}` : ''}</h2>
          <div className="flex flex-wrap items-end gap-3">
            <div><label htmlFor="inv-q" className="field-label">Client ou n°</label><input id="inv-q" value={q} maxLength={60} onChange={(e) => setQ(e.target.value)} className="field" /></div>
            <div><label htmlFor="inv-status" className="field-label">Paiement</label>
              <select id="inv-status" value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)} className="field">
                <option value="">Tous</option>
                {PAYMENT_STATUSES.map((st) => <option key={st.code} value={st.code}>{st.label}</option>)}
              </select></div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b border-black/10 text-xs uppercase tracking-wide text-black/60">
              <th className="py-2 pr-3">N°</th><th className="pr-3">Client</th><th className="pr-3">Date</th><th className="pr-3">Échéance</th><th className="pr-3 text-right">Total TTC</th><th>Paiement</th>
            </tr></thead>
            <tbody>
              {(data?.invoices ?? []).map((inv) => (
                <tr key={inv.id} className="border-b border-black/5">
                  <td className="py-2 pr-3 tabular">{inv.invoice_number ?? '—'}</td>
                  <td className="pr-3">{inv.partner_name}</td>
                  <td className="pr-3 whitespace-nowrap">{formatDate(inv.invoice_date)}</td>
                  <td className="pr-3 whitespace-nowrap">{inv.due_date ? formatDate(inv.due_date) : '—'}</td>
                  <td className="pr-3 text-right tabular">{money(Number(inv.amount_ttc))}</td>
                  <td><span className={`rounded px-2 py-0.5 text-xs ${STATUS_STYLES[inv.payment_status] ?? ''}`}>{STATUS_LABELS[inv.payment_status] ?? inv.payment_status}</span>{inv.payment_date && <span className="ml-2 text-xs text-black/50">{formatDate(inv.payment_date)}</span>}</td>
                </tr>
              ))}
              {data && data.invoices.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-black/60">Aucune facture sur cette période.</td></tr>}
            </tbody>
          </table>
        </div>
        {loading && <p className="mt-3 text-sm text-black/60">Chargement…</p>}
        {data && data.invoices.length >= data.listLimit && <p className="mt-3 text-xs text-black/60">Les {data.listLimit} factures les plus récentes sont affichées : affinez par client ou par statut.</p>}
      </section>
    </div>
  );
}
