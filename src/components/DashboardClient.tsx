'use client';

import { useEffect, useState } from 'react';
import { formatCurrency, formatPercent } from '@/lib/formatters';
import { severityBorder, SeverityBadge } from '@/components/Badges';
import { KpiTrendChart } from '@/components/KpiTrendChart';

interface KpiResponse {
  averages: { occupancy_rate: number; adr: number; revpar: number };
  series: { business_date: string; occupancy_rate: number; adr: number; revpar: number }[];
}

interface Finding {
  id: string;
  business_date: string;
  category: string;
  severity: string;
  title: string;
  description: string;
  recommendation: string | null;
}

export function DashboardClient({ hotelId }: { hotelId: string }) {
  const [kpis, setKpis] = useState<KpiResponse | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`/api/kpis?hotelId=${hotelId}&days=30`).then((r) => r.json()),
      fetch(`/api/audit-findings?hotelId=${hotelId}`).then((r) => r.json()),
    ])
      .then(([kpiData, findingData]) => {
        setKpis(kpiData);
        setFindings(findingData.findings ?? []);
      })
      .finally(() => setLoading(false));
  }, [hotelId]);

  async function updateFinding(id: string, status: string) {
    setFindings((prev) => prev.filter((f) => f.id !== id));
    await fetch('/api/audit-findings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
  }

  if (loading) return <div className="text-ink-400">Chargement du registre…</div>;

  return (
    <div className="max-w-5xl">
      <header className="mb-10">
        <h1 className="font-display text-3xl text-parchment">Tableau de bord</h1>
        <p className="mt-1 text-sm text-ink-400">30 derniers jours clos — Grand Hotel Riviera Cannes</p>
      </header>

      {/* Registre de performance — pas de cartes identiques, une ligne unifiée separee par des filets */}
      <section className="mb-12 grid grid-cols-1 divide-y divide-ink-700 border-y border-ink-700 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Stat label="Occupation" value={formatPercent(kpis?.averages.occupancy_rate ?? 0)} />
        <Stat label="ADR" value={formatCurrency(kpis?.averages.adr ?? 0)} />
        <Stat label="RevPAR" value={formatCurrency(kpis?.averages.revpar ?? 0)} />
      </section>

      <section className="mb-12 grid grid-cols-1 gap-8 lg:grid-cols-2">
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-lg text-parchment">Occupation</h2>
            <span className="text-xs text-ink-400">30 jours</span>
          </div>
          <KpiTrendChart series={kpis?.series ?? []} metric="occupancy" />
        </div>
        <div>
          <div className="mb-3 flex items-center justify-between gap-4">
            <h2 className="font-display text-lg text-parchment">ADR &amp; RevPAR</h2>
            <span className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1.5 text-moss">
                <span className="inline-block h-0.5 w-3 bg-moss" /> ADR
              </span>
              <span className="flex items-center gap-1.5 text-wine">
                <span className="inline-block h-0.5 w-3 bg-wine" /> RevPAR
              </span>
            </span>
          </div>
          <KpiTrendChart series={kpis?.series ?? []} metric="money" />
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="font-display text-xl text-parchment">Constats de l'audit</h2>
          <span className="text-xs text-ink-400">{findings.length} ouverts</span>
        </div>

        {findings.length === 0 ? (
          <p className="border border-ink-700 px-4 py-6 text-sm text-ink-400">
            Aucun constat ouvert. Le prochain audit reprendra depuis un état propre.
          </p>
        ) : (
          <ul className="divide-y divide-ink-700 border-y border-ink-700">
            {findings.map((f) => (
              <li key={f.id} className={`border-l-2 py-4 pl-4 ${severityBorder(f.severity)}`}>
                <div className="mb-1 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <SeverityBadge severity={f.severity} />
                    <span className="text-xs text-ink-400">{f.business_date}</span>
                  </div>
                  <div className="flex gap-3 text-xs">
                    <button onClick={() => updateFinding(f.id, 'acknowledged')} className="text-brass-light hover:text-brass">
                      Accuser réception
                    </button>
                    <button onClick={() => updateFinding(f.id, 'resolved')} className="text-moss hover:text-parchment">
                      Résoudre
                    </button>
                  </div>
                </div>
                <p className="font-medium text-parchment">{f.title}</p>
                <p className="mt-1 text-sm text-ink-400">{f.description}</p>
                {f.recommendation && (
                  <p className="mt-2 text-sm italic text-brass-light">→ {f.recommendation}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-6 py-5 first:pl-0 last:pr-0">
      <div className="tabular font-display text-4xl text-parchment">{value}</div>
      <div className="mt-1 text-sm text-ink-400">{label}</div>
    </div>
  );
}
