'use client';

import { useEffect, useState } from 'react';
import { formatCurrency, formatDate, formatPercent } from '@/lib/formatters';
import { severityBorder, SeverityBadge } from '@/components/Badges';
import { KpiTrendChart } from '@/components/KpiTrendChart';
import Link from 'next/link';

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

export function DashboardClient({
  hotelId,
  hotelName,
  currencyCode,
}: {
  hotelId: string;
  hotelName: string;
  currencyCode: string;
}) {
  const [kpis, setKpis] = useState<KpiResponse | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);
  const [finance, setFinance] = useState<FinanceStrip | null>(null);

  // Bandeau finance : charge apres le reste, sans bloquer l'ecran ; masque pour les roles sans droit « finance.manage » (reponse 403).
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`/api/invoices?hotelId=${hotelId}&summaryOnly=1`),
      fetch(`/api/receivables?hotelId=${hotelId}`),
    ]).then(async ([inv, rec]) => {
      if (!inv.ok || !rec.ok || cancelled) return;
      const [i, r] = await Promise.all([inv.json(), rec.json()]);
      if (cancelled) return;
      setFinance({
        asOf: i.asOf, requestedAsOf: i.requestedAsOf, day: i.summary.day, month: i.summary.month, cashedDay: i.summary.cashed.day.ttc,
        reliable: r.reliable.amount, reliableCount: r.reliable.count, toReconcile: r.toReconcile.amount, over90: r.over90,
      });
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [hotelId]);

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

  if (loading) return <div className="text-sm text-ink-400">Chargement du tableau de bord…</div>;

  return (
    <div>
      <header className="mb-6">
        <h1 className="page-title">Tableau de bord</h1>
        <p className="page-subtitle">{hotelName} · 30 derniers jours clos</p>
      </header>

      {/* Indicateurs clefs : un seul bandeau, filet laiton en tete — l'unique accent de prestige de l'ecran */}
      <section className="panel mb-6 grid grid-cols-1 divide-y divide-ink-700 border-t-2 border-t-brass sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Stat label="Taux d'occupation" value={formatPercent(kpis?.averages.occupancy_rate ?? 0)} note="Chambres occupées sur chambres disponibles" />
        <Stat label="ADR" value={formatCurrency(kpis?.averages.adr ?? 0, currencyCode)} note="Prix moyen par chambre occupée" />
        <Stat label="RevPAR" value={formatCurrency(kpis?.averages.revpar ?? 0, currencyCode)} note="Revenu par chambre disponible" />
      </section>

      {finance && (
        <section aria-label="Finance" className="panel mb-6">
          <div className="flex items-center justify-between border-b border-ink-700 px-6 py-3 text-sm">
            <span className="font-medium text-parchment">Finance au {formatDate(finance.asOf)}{finance.asOf < finance.requestedAsOf && <span className="ml-2 font-normal text-amber-400">dernière facture importée (aujourd&apos;hui : {formatDate(finance.requestedAsOf)})</span>}</span>
            <span className="flex gap-4 text-ink-400"><Link href="/invoices" className="hover:text-parchment">Factures &amp; CA</Link><Link href="/receivables" className="hover:text-parchment">Créances</Link></span>
          </div>
          <div className="grid grid-cols-1 divide-y divide-ink-700 sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
            <FinanceStat label={`${finance.asOf < finance.requestedAsOf ? `CA du ${formatDate(finance.asOf)}` : 'CA du jour'} (TTC)`} value={formatCurrency(finance.day.ttc, currencyCode)} note={`HT ${formatCurrency(finance.day.ht, currencyCode)} · ${finance.day.count} facture(s)`} />
            <FinanceStat label="CA du mois (TTC)" value={formatCurrency(finance.month.ttc, currencyCode)} note={`HT ${formatCurrency(finance.month.ht, currencyCode)} · ${finance.month.count} facture(s)`} />
            <FinanceStat label={finance.asOf < finance.requestedAsOf ? `Encaissé le ${formatDate(finance.asOf)}` : 'Encaissé du jour'} value={formatCurrency(finance.cashedDay, currencyCode)} note="Factures payées ou en paiement ce jour" />
            <FinanceStat label="Créances fiables" value={formatCurrency(finance.reliable, currencyCode)} note={`+ ${formatCurrency(finance.toReconcile, currencyCode)} à rapprocher · ${formatCurrency(finance.over90, currencyCode)} à plus de 90 j`} />
          </div>
        </section>
      )}

      <section className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="panel p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-parchment">Occupation</h2>
            <span className="text-xs text-ink-400">30 jours</span>
          </div>
          <KpiTrendChart series={kpis?.series ?? []} metric="occupancy" currencyCode={currencyCode} />
        </div>
        <div className="panel p-5">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="text-base font-semibold text-parchment">ADR et RevPAR</h2>
            <span className="flex items-center gap-4 text-xs text-ink-400">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-4 rounded-full bg-moss" /> ADR
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-4 rounded-full bg-wine" /> RevPAR
              </span>
            </span>
          </div>
          <KpiTrendChart series={kpis?.series ?? []} metric="money" currencyCode={currencyCode} />
        </div>
      </section>

      <section className="panel">
        <div className="flex items-center justify-between border-b border-ink-700 px-5 py-3.5">
          <h2 className="text-base font-semibold text-parchment">Constats de l'audit</h2>
          <span className="rounded-sm bg-ink-800 px-2 py-0.5 text-xs font-medium text-ink-400">{findings.length} ouverts</span>
        </div>

        {findings.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-ink-400">
            Aucun constat ouvert. Le prochain audit repartira d'un état propre.
          </p>
        ) : (
          <ul className="divide-y divide-ink-700">
            {findings.map((f) => (
              <li key={f.id} className={`border-l-[3px] px-5 py-4 ${severityBorder(f.severity)}`}>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <SeverityBadge severity={f.severity} />
                    <span className="tabular text-xs text-ink-400">{formatDate(f.business_date)}</span>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => updateFinding(f.id, 'acknowledged')} className="btn-secondary btn-sm">
                      Accuser réception
                    </button>
                    <button onClick={() => updateFinding(f.id, 'resolved')} className="btn-secondary btn-sm hover:border-moss hover:text-moss">
                      Marquer résolu
                    </button>
                  </div>
                </div>
                <p className="font-medium text-parchment">{f.title}</p>
                <p className="mt-1 max-w-3xl text-sm text-ink-400">{f.description}</p>
                {f.recommendation && (
                  <p className="mt-3 max-w-3xl rounded-sm bg-steel-tint px-3 py-2 text-sm text-steel-dim">
                    <span className="font-medium">À faire : </span>
                    {f.recommendation}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

interface FinanceStrip {
  asOf: string;
  requestedAsOf: string;
  day: { ttc: number; ht: number; count: number };
  month: { ttc: number; ht: number; count: number };
  cashedDay: number;
  reliable: number;
  reliableCount: number;
  toReconcile: number;
  over90: number;
}

function FinanceStat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="px-6 py-4">
      <div className="text-sm font-medium text-ink-400">{label}</div>
      <div className="tabular mt-1 font-display text-2xl leading-tight tracking-tight text-parchment">{value}</div>
      <div className="mt-1 text-xs text-ink-500">{note}</div>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="px-6 py-5">
      <div className="text-sm font-medium text-ink-400">{label}</div>
      <div className="tabular mt-2 font-display text-[2.5rem] leading-none tracking-tight text-parchment">{value}</div>
      <div className="mt-2 text-xs text-ink-500">{note}</div>
    </div>
  );
}
