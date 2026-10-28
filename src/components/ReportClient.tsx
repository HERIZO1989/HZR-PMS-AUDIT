'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatCurrency, formatDate, formatPercent } from '@/lib/formatters';
import type { Delta, MonthlyReport } from '@/lib/monthlyReport';
import type { PerfRow } from '@/lib/performance';

interface ReportResponse { hotelName: string; currencyCode: string; generatedAt: string; report: MonthlyReport }

const todayLocal = () => new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
/** Mois precedent (rapport habituel de fin de mois). */
function previousMonthOf(date: string): string {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

function DeltaBadge({ d }: { d?: Delta }) {
  if (!d) return <span className="text-black/40">—</span>;
  const up = d.value >= 0;
  return <span className={up ? 'text-emerald-700' : 'text-red-700'}>{up ? '+' : '−'}{Math.abs(d.value).toFixed(1).replace('.', ',')} {d.unit === 'pts' ? 'pts' : '%'}</span>;
}

export function ReportClient({ hotelId }: { hotelId: string }) {
  const [month, setMonth] = useState(previousMonthOf(todayLocal()));
  const [data, setData] = useState<ReportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/report?hotelId=${hotelId}&month=${month}`);
    const json = await res.json();
    setLoading(false);
    if (!res.ok) { setData(null); return setError(json.error ?? 'Échec du chargement'); }
    setError(null);
    setData(json);
  }, [hotelId, month]);

  useEffect(() => { void load(); }, [load]);

  const money = (n: number) => formatCurrency(n, data?.currencyCode ?? 'EUR');
  const r = data?.report;
  const cur = r?.kpi.month ?? null;
  const rows: { label: string; pick: (p: PerfRow) => string; delta?: keyof MonthlyReport['deltas'] }[] = [
    { label: 'Occupation', pick: (p) => formatPercent(p.occupancy), delta: 'occupancy' },
    { label: 'ADR (prix moyen par chambre vendue)', pick: (p) => money(p.adr), delta: 'adr' },
    { label: 'RevPAR (hébergement par chambre disponible)', pick: (p) => money(p.revpar), delta: 'revpar' },
    { label: 'TRevPAR (CA total par chambre disponible)', pick: (p) => money(p.trevpar), delta: 'trevpar' },
    { label: 'CA facturé HT', pick: (p) => money(p.billedRevenue), delta: 'billedRevenue' },
    { label: 'Revenu hébergement HT', pick: (p) => money(p.roomRevenue) },
    { label: 'Dépenses HT', pick: (p) => money(p.expenses) },
    { label: 'GOP (résultat brut d\'exploitation)', pick: (p) => money(p.gop), delta: 'gop' },
    { label: 'Marge GOP', pick: (p) => formatPercent(p.gopMargin) },
    { label: 'GOPPAR', pick: (p) => money(p.goppar), delta: 'goppar' },
  ];

  return (
    <div className="mx-auto max-w-4xl bg-white p-6 text-black print:p-0">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4 print:hidden">
        <div>
          <h1 className="page-title">Rapport mensuel</h1>
          <p className="page-subtitle">Performance, dépenses et créances : à imprimer en PDF ou à télécharger en Excel</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div><label htmlFor="rep-month" className="field-label">Mois</label><input id="rep-month" type="month" value={month} max={todayLocal().slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} className="field" /></div>
          <a href={`/api/report?hotelId=${hotelId}&month=${month}&format=xlsx`} className="btn-secondary btn-sm">Télécharger Excel</a>
          <button onClick={() => window.print()} disabled={!r} className="btn-primary btn-sm">Imprimer / PDF</button>
        </div>
      </div>

      {error && <p role="alert" className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800 print:hidden">{error}</p>}
      {loading && !r && <p className="text-black/60">Génération du rapport…</p>}

      {data && r && (
        <article>
          <header className="mb-6 border-b border-black/20 pb-4">
            <p className="text-sm uppercase tracking-widest text-black/60">Rapport mensuel de performance</p>
            <h2 className="font-display text-3xl">{data.hotelName}</h2>
            <p className="text-lg">{r.label}</p>
            <p className="mt-1 text-xs text-black/60">Montants hors taxe · situation au {formatDate(r.asOf)} · édité le {formatDate(data.generatedAt.slice(0, 10))}</p>
          </header>

          {r.attention.length > 0 && (
            <section aria-label="Points d'attention" className="mb-6 rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 print:border-black/30 print:bg-white print:text-black">
              <h3 className="mb-1 font-semibold">Points d&apos;attention</h3>
              <ul className="list-disc pl-5">{r.attention.map((a) => <li key={a}>{a}</li>)}</ul>
            </section>
          )}

          <section aria-label="Indicateurs" className="mb-6">
            <h3 className="mb-2 font-display text-xl">Indicateurs clés</h3>
            {!cur ? <p className="text-black/60">Aucune donnée pour ce mois.</p> : (
              <table className="w-full text-sm tabular">
                <thead><tr className="border-b border-black/20 text-left text-xs uppercase tracking-wide text-black/60">
                  <th className="py-2">Indicateur</th><th className="text-right">{r.label}</th><th className="text-right">Mois précédent</th><th className="text-right">Évolution</th><th className="text-right">Cumul {r.month.slice(0, 4)}</th>
                </tr></thead>
                <tbody>{rows.map((x) => (
                  <tr key={x.label} className="border-b border-black/10">
                    <td className="py-2">{x.label}</td>
                    <td className="text-right font-semibold">{x.pick(cur)}</td>
                    <td className="text-right text-black/70">{r.kpi.previous ? x.pick(r.kpi.previous) : '—'}</td>
                    <td className="text-right">{x.delta ? <DeltaBadge d={r.deltas[x.delta]} /> : <span className="text-black/40">—</span>}</td>
                    <td className="text-right text-black/70">{x.pick(r.kpi.ytd)}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
            <p className="mt-2 text-xs text-black/60">TRevPAR et GOP sont calculés sur le CA des factures comptabilisées, à leur date de facturation : sur un mois isolé, ils peuvent être décalés par rapport aux séjours ; le cumul est plus fiable.</p>
          </section>

          <section aria-label="Dépenses" className="mb-6 break-inside-avoid">
            <h3 className="mb-2 font-display text-xl">Dépenses du mois par catégorie (HT)</h3>
            {r.expensesByCategory.length === 0 ? <p className="text-sm text-black/60">Aucune dépense approuvée sur ce mois.</p> : (
              <table className="w-full text-sm tabular"><tbody>{r.expensesByCategory.map((c) => (
                <tr key={c.category} className="border-b border-black/10"><td className="py-1.5">{c.label}</td><td className="text-right">{money(c.amountHt)}</td><td className="w-16 text-right text-black/60">{formatPercent(c.share)}</td></tr>
              ))}</tbody></table>
            )}
          </section>

          <section aria-label="Créances" className="mb-6 break-inside-avoid">
            <h3 className="mb-2 font-display text-xl">Créances clients (situation actuelle, TTC)</h3>
            <div className="mb-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div><div className="text-xs text-black/60">Total</div><div className="font-semibold tabular">{money(r.receivables.total)}</div></div>
              <div><div className="text-xs text-black/60">Fiables</div><div className="font-semibold tabular">{money(r.receivables.reliable)}</div></div>
              <div><div className="text-xs text-black/60">À rapprocher</div><div className="font-semibold tabular">{money(r.receivables.toReconcile)}</div></div>
              <div><div className="text-xs text-black/60">Plus de 90 jours</div><div className="font-semibold tabular">{money(r.receivables.over90)}</div></div>
            </div>
            <table className="w-full text-sm tabular">
              <thead><tr className="border-b border-black/20 text-left text-xs uppercase tracking-wide text-black/60"><th className="py-1.5">Principaux débiteurs</th><th className="text-right">Factures</th><th className="text-right">Total TTC</th><th className="text-right">+ 90 j</th></tr></thead>
              <tbody>{r.receivables.top.map((c) => (
                <tr key={c.client} className="border-b border-black/10"><td className="py-1.5">{c.client}</td><td className="text-right">{c.count}</td><td className="text-right">{money(c.total)}</td><td className="text-right">{money(c.over90)}</td></tr>
              ))}</tbody>
            </table>
          </section>

          <footer className="border-t border-black/20 pt-3 text-xs text-black/60">
            Dernière facture importée : {r.freshness.lastInvoiceDate ? formatDate(r.freshness.lastInvoiceDate) : '—'} · derniers indicateurs calculés : {r.freshness.lastSnapshotDate ? formatDate(r.freshness.lastSnapshotDate) : '—'} · Nyarotiko Consulting
          </footer>
        </article>
      )}
    </div>
  );
}
