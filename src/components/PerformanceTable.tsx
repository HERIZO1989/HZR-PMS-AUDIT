'use client';

import { useEffect, useState } from 'react';
import { formatCurrency, formatPercent } from '@/lib/formatters';
import type { Performance, PerfRow } from '@/lib/performance';

interface PerformanceResponse extends Performance { asOf: string; year: string; hasPersonnelExpenses: boolean }

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/** Performance mensuelle (HT) : RevPAR des séjours, TRevPAR et GOP à partir du CA facturé et des dépenses. */
export function PerformanceTable({ hotelId, currencyCode, asOf }: { hotelId: string; currencyCode: string; asOf: string }) {
  const [data, setData] = useState<PerformanceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const money = (n: number) => formatCurrency(n, currencyCode);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/performance?hotelId=${hotelId}&asOf=${asOf}`);
      const json = await res.json();
      if (cancelled) return;
      if (!res.ok) return setError(json.error ?? 'Échec du chargement de la performance');
      setError(null);
      setData(json);
    })();
    return () => { cancelled = true; };
  }, [hotelId, asOf]);

  if (error) return <p role="alert" className="mb-6 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>;
  if (!data || data.months.length === 0) return null;

  const label = (r: PerfRow) => (r.month === 'total' ? `Cumul ${data.year}` : `${MONTHS[Number(r.month.slice(5, 7)) - 1]}${r.partial ? ' *' : ''}`);
  const rows = [...data.months, data.total];

  return (
    <section aria-label="Performance mensuelle" className="panel mb-6 p-5">
      <h2 className="mb-1 font-display text-lg">Performance {data.year} (HT)</h2>
      <p className="mb-3 text-xs text-black/60">RevPAR = hébergement des séjours ÷ chambres disponibles. TRevPAR et GOP = CA facturé HT (factures comptabilisées) ÷ chambres disponibles, moins les dépenses.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-right text-sm tabular">
          <thead>
            <tr className="border-b border-black/10 text-xs uppercase tracking-wide text-black/60">
              <th className="py-2 pr-3 text-left">Mois</th><th className="pr-3">Occup.</th><th className="pr-3">ADR</th><th className="pr-3">RevPAR</th><th className="pr-3">TRevPAR</th>
              <th className="pr-3">CA facturé</th><th className="pr-3">Dépenses</th><th className="pr-3">GOP</th><th className="pr-3">Marge</th><th>GOPPAR</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.month} className={`border-b border-black/5 ${r.month === 'total' ? 'bg-black/5 font-semibold' : ''}`}>
                <td className="py-2 pr-3 text-left whitespace-nowrap">{label(r)}</td>
                <td className="pr-3">{formatPercent(r.occupancy)}</td>
                <td className="pr-3">{money(r.adr)}</td>
                <td className="pr-3">{money(r.revpar)}</td>
                <td className="pr-3">{money(r.trevpar)}</td>
                <td className="pr-3">{money(r.billedRevenue)}</td>
                <td className="pr-3">{money(r.expenses)}</td>
                <td className={`pr-3 ${r.gop < 0 ? 'text-red-700' : ''}`}>{money(r.gop)}</td>
                <td className="pr-3">{formatPercent(r.gopMargin)}</td>
                <td>{money(r.goppar)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="mt-3 grid gap-1 text-xs text-black/60">
        {data.months.some((m) => m.partial) && <li>* Mois incomplet : calculé sur les jours disponibles.</li>}
        <li>Les factures sont enregistrées à leur date de facturation : sur un mois isolé, le CA facturé peut être décalé par rapport aux séjours. Le cumul est plus fiable.</li>
      </ul>
      {!data.hasPersonnelExpenses && (
        <p role="alert" className="mt-3 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Aucune dépense « Personnel » (salaires, charges sociales) n&apos;est saisie : les dépenses viennent surtout des bons de commande fournisseurs, donc le GOP et sa marge sont surévalués. Saisissez les charges de personnel dans Dépenses pour un GOP complet.
        </p>
      )}
    </section>
  );
}
