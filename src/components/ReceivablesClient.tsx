'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatCurrency, formatDate } from '@/lib/formatters';
import { BUCKETS, buildReminder, type ClientRow, type OpenInvoice, type ReceivablesSummary } from '@/lib/receivables';

const csvCell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function ReceivablesClient({ hotelId, hotelName, currencyCode }: { hotelId: string; hotelName: string; currencyCode: string }) {
  const [data, setData] = useState<ReceivablesSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [onlyOld, setOnlyOld] = useState(false);
  const [selected, setSelected] = useState<ClientRow | null>(null);
  const [detail, setDetail] = useState<OpenInvoice[] | null>(null);
  const [copied, setCopied] = useState(false);
  const money = (n: number) => formatCurrency(n, currencyCode);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/receivables?hotelId=${hotelId}`);
    const json = await res.json();
    setLoading(false);
    if (!res.ok) return setError(json.error ?? 'Échec du chargement');
    setError(null);
    setData(json);
  }, [hotelId]);

  useEffect(() => { void load(); }, [load]);

  async function openClient(row: ClientRow) {
    setSelected(row);
    setDetail(null);
    setCopied(false);
    const res = await fetch(`/api/receivables?hotelId=${hotelId}&client=${encodeURIComponent(row.client)}`);
    const json = await res.json();
    if (!res.ok) { setError(json.error ?? 'Échec du chargement du client'); return; }
    setDetail(json.invoices);
  }

  async function copyReminder() {
    if (!detail || !selected || !data) return;
    await navigator.clipboard.writeText(buildReminder(selected.client, detail, hotelName, currencyCode, data.today));
    setCopied(true);
  }

  function downloadCsv() {
    if (!data) return;
    const head = ['Client', 'Factures', 'Total TTC', 'Échu', 'Plus de 90 jours', 'Plus ancienne', ...BUCKETS.map((b) => b.label)];
    const lines = [head.map(csvCell).join(';')];
    for (const c of data.clients) lines.push([c.client, c.count, c.total, c.overdue, c.over90, c.oldest, ...BUCKETS.map((b) => c.buckets[b.code])].map(csvCell).join(';'));
    const url = URL.createObjectURL(new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `creances_${data.today}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = normalize(q.trim());
    return data.clients.filter((c) => (!needle || normalize(c.client).includes(needle)) && (!onlyOld || c.over90 > 0)).slice(0, 200);
  }, [data, q, onlyOld]);
  const maxBucket = data ? Math.max(1, ...data.buckets.map((b) => b.amount)) : 1;

  return (
    <div className="max-w-6xl">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Créances clients</h1>
          <p className="page-subtitle">Factures non soldées par ancienneté et par client{data ? ` · situation au ${formatDate(data.today)}` : ''}</p>
        </div>
        <button onClick={downloadCsv} disabled={!data} className="btn-primary btn-sm">Exporter en CSV</button>
      </header>

      {error && <p role="alert" className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {loading && !data && <p className="text-black/60">Chargement…</p>}

      {data && (
        <>
          <section aria-label="Synthèse" className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="panel p-4"><p className="field-label">Total des créances</p><p className="text-xl font-semibold tabular">{money(data.total)}</p><p className="text-xs text-black/60">{data.count.toLocaleString('fr-FR')} factures · {data.clientCount} clients</p></div>
            <div className="panel p-4"><p className="field-label">Échues</p><p className="text-xl font-semibold tabular text-red-700">{money(data.overdue)}</p><p className="text-xs text-black/60">{data.overdueCount.toLocaleString('fr-FR')} factures après échéance</p></div>
            <div className="panel p-4"><p className="field-label">Plus de 90 jours</p><p className="text-xl font-semibold tabular">{money(data.over90)}</p><p className="text-xs text-black/60">{data.total > 0 ? Math.round((data.over90 / data.total) * 100) : 0} % du total</p></div>
            <div className="panel p-4"><p className="field-label">Concentration</p><p className="text-xl font-semibold tabular">{Math.round(data.top20Share * 100)} %</p><p className="text-xs text-black/60">du total sur les 20 premiers clients</p></div>
          </section>

          <section aria-label="Ancienneté" className="panel mb-6 p-5">
            <h2 className="mb-3 font-display text-lg">Ancienneté depuis la date de facture</h2>
            <ul className="grid gap-1.5">
              {data.buckets.map((b) => (
                <li key={b.code} className="grid grid-cols-[6rem_1fr_9rem] items-center gap-3 text-sm">
                  <span className="text-black/70">{b.label}</span>
                  <span className="h-3 rounded bg-black/5"><span className={`block h-3 rounded ${b.code === 'd91_180' || b.code === 'd180p' ? 'bg-red-400' : 'bg-brass'}`} style={{ width: `${(b.amount / maxBucket) * 100}%` }} /></span>
                  <span className="text-right tabular">{money(b.amount)}<span className="ml-1 text-xs text-black/50">({b.count})</span></span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-black/60">« Partiellement réglée » : l&apos;export Odoo ne donne pas le montant déjà réglé, ces factures comptent pour leur montant complet.</p>
          </section>

          <section aria-label="Clients" className="panel p-5">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <h2 className="font-display text-lg">Clients débiteurs</h2>
              <div className="flex flex-wrap items-end gap-3">
                <div><label htmlFor="rec-q" className="field-label">Rechercher</label><input id="rec-q" value={q} maxLength={60} onChange={(e) => setQ(e.target.value)} className="field" /></div>
                <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={onlyOld} onChange={(e) => setOnlyOld(e.target.checked)} />Plus de 90 jours seulement</label>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead><tr className="border-b border-black/10 text-xs uppercase tracking-wide text-black/60">
                  <th className="py-2 pr-3">Client</th><th className="pr-3 text-right">Fact.</th><th className="pr-3 text-right">Total TTC</th><th className="pr-3 text-right">+ 90 j</th><th className="pr-3">Plus ancienne</th><th />
                </tr></thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.client} className="border-b border-black/5">
                      <td className="py-2 pr-3">{c.client}</td>
                      <td className="pr-3 text-right tabular">{c.count}</td>
                      <td className="pr-3 text-right tabular">{money(c.total)}</td>
                      <td className={`pr-3 text-right tabular ${c.over90 > 0 ? 'text-red-700' : 'text-black/40'}`}>{money(c.over90)}</td>
                      <td className="pr-3 whitespace-nowrap">{formatDate(c.oldest)}</td>
                      <td className="text-right"><button onClick={() => openClient(c)} className="row-action">Détail</button></td>
                    </tr>
                  ))}
                  {rows.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-black/60">Aucun client ne correspond.</td></tr>}
                </tbody>
              </table>
            </div>
            {data.clientCount > rows.length && !q && !onlyOld && <p className="mt-3 text-xs text-black/60">Les 200 plus gros débiteurs sur {data.clientCount} sont affichés ; utilisez la recherche pour les autres. L&apos;export CSV contient tous les clients.</p>}
          </section>
        </>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setSelected(null)}>
          <div role="dialog" aria-modal="true" aria-label={`Créances de ${selected.client}`} className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-md bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between gap-3">
              <div><h2 className="font-display text-xl">{selected.client}</h2><p className="text-sm text-black/60">{selected.count} facture(s) · {money(selected.total)}</p></div>
              <button onClick={() => setSelected(null)} className="btn-secondary btn-sm">Fermer</button>
            </div>
            {!detail ? <p className="text-black/60">Chargement…</p> : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead><tr className="border-b border-black/10 text-xs uppercase tracking-wide text-black/60"><th className="py-1 pr-3">N°</th><th className="pr-3">Date</th><th className="pr-3">Échéance</th><th className="text-right">Montant</th></tr></thead>
                    <tbody>{detail.map((i, k) => (
                      <tr key={k} className="border-b border-black/5"><td className="py-1 pr-3 tabular">{i.invoice_number ?? '—'}</td><td className="pr-3 whitespace-nowrap">{formatDate(i.invoice_date)}</td><td className="pr-3 whitespace-nowrap">{i.due_date ? formatDate(i.due_date) : '—'}</td><td className="text-right tabular">{money(Number(i.amount_ttc))}{i.payment_status === 'partial' && <span className="ml-1 text-xs text-amber-700">(partiel)</span>}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button onClick={copyReminder} className="btn-primary btn-sm">Copier le message de relance</button>
                  {copied && <span role="status" className="text-sm text-emerald-700">Message copié : collez-le dans WhatsApp ou un e-mail.</span>}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
