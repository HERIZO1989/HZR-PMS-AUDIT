'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatCurrency, formatDate } from '@/lib/formatters';
import type { Finding, Severity } from '@/lib/audit';

interface AuditResponse { today: string; findings: Finding[]; counts: Record<Severity, number> }

const SEVERITY_LABEL: Record<Severity, string> = { high: 'Critique', medium: 'À traiter', low: 'À surveiller', ok: 'Conforme' };
const SEVERITY_STYLE: Record<Severity, string> = {
  high: 'bg-red-100 text-red-800', medium: 'bg-amber-100 text-amber-800', low: 'bg-sky-100 text-sky-800', ok: 'bg-emerald-100 text-emerald-800',
};

const csvCell = (v: string | number | null) => `"${String(v ?? '').replace(/"/g, '""')}"`;

/** Export CSV (séparateur point-virgule, UTF-8 avec BOM) : synthèse des contrôles, puis les exemples de chaque contrôle. */
function buildCsv(data: AuditResponse): string {
  const lines: string[] = [['Contrôle', 'Gravité', 'Nombre', 'Montant', 'Constat', 'Action'].map(csvCell).join(';')];
  for (const f of data.findings) lines.push([f.title, SEVERITY_LABEL[f.severity], f.count, f.amount, f.detail, f.action].map(csvCell).join(';'));
  for (const f of data.findings.filter((x) => x.examples.length > 0)) {
    lines.push('', csvCell(f.title), f.columns.map(csvCell).join(';'));
    for (const row of f.examples) lines.push(row.map(csvCell).join(';'));
  }
  return `\uFEFF${lines.join('\r\n')}`;
}

export function AuditClient({ hotelId, currencyCode }: { hotelId: string; currencyCode: string }) {
  const [data, setData] = useState<AuditResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const money = (n: number) => formatCurrency(n, currencyCode);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/audit?hotelId=${hotelId}`);
    const json = await res.json();
    setLoading(false);
    if (!res.ok) return setError(json.error ?? 'Échec du chargement');
    setError(null);
    setData(json);
  }, [hotelId]);

  useEffect(() => { void load(); }, [load]);

  function download() {
    if (!data) return;
    const url = URL.createObjectURL(new Blob([buildCsv(data)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `controles_audit_${data.today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="max-w-5xl">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Contrôles d&apos;audit</h1>
          <p className="page-subtitle">Anomalies détectées dans les factures, séjours, dépenses et acomptes{data ? ` · situation au ${formatDate(data.today)}` : ''}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => void load()} disabled={loading} className="btn-secondary btn-sm">{loading ? 'Analyse…' : 'Relancer'}</button>
          <button onClick={download} disabled={!data} className="btn-primary btn-sm">Exporter en CSV</button>
        </div>
      </header>

      {error && <p role="alert" className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {loading && !data && <p className="text-black/60">Analyse des données en cours…</p>}

      {data && (
        <>
          <section aria-label="Synthèse" className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(['high', 'medium', 'low', 'ok'] as Severity[]).map((s) => (
              <div key={s} className="panel p-4"><p className="field-label">{SEVERITY_LABEL[s]}</p><p className="text-2xl font-semibold tabular">{data.counts[s]}</p></div>
            ))}
          </section>

          <ul className="grid gap-3">
            {data.findings.map((f) => (
              <li key={f.id} className="panel p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h2 className="font-display text-lg">{f.title}</h2>
                  <span className={`rounded px-2 py-0.5 text-xs ${SEVERITY_STYLE[f.severity]}`}>{SEVERITY_LABEL[f.severity]}</span>
                </div>
                <p className="mt-1 text-sm text-black/80">{f.detail}</p>
                {f.severity !== 'ok' && (
                  <p className="mt-1 text-sm text-black/60"><span className="font-medium">À faire :</span> {f.action}</p>
                )}
                {f.severity !== 'ok' && (f.count > 0 || f.amount !== null) && (
                  <p className="mt-2 text-sm tabular">
                    <span className="font-semibold">{f.count.toLocaleString('fr-FR')}</span> concerné(s)
                    {f.amount !== null && <> · <span className="font-semibold">{money(f.amount)}</span></>}
                  </p>
                )}
                {f.examples.length > 0 && f.severity !== 'ok' && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-sm text-black/70">Voir les {f.examples.length} principaux cas</summary>
                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead><tr className="border-b border-black/10 text-xs uppercase tracking-wide text-black/60">{f.columns.map((c) => <th key={c} className="py-1 pr-3">{c}</th>)}</tr></thead>
                        <tbody>{f.examples.map((row, i) => (
                          <tr key={i} className="border-b border-black/5">{row.map((cell, j) => <td key={j} className="py-1 pr-3 tabular">{cell}</td>)}</tr>
                        ))}</tbody>
                      </table>
                    </div>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
