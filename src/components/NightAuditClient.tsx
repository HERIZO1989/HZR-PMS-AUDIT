'use client';

import { useEffect, useState } from 'react';

interface Check {
  id: string;
  check_type: string;
  status: string;
  details: Record<string, unknown>;
}

interface Run {
  id: string;
  business_date: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  staff_users: { display_name: string } | null;
  night_audit_checks: Check[];
}

const CHECK_LABELS: Record<string, string> = {
  no_show_processing: 'Traitement des no-show',
  room_status_reconciliation: 'Réconciliation statuts chambres',
  rate_verification: 'Vérification des tarifs',
  folio_balance: 'Soldes des folios',
  occupancy_calc: 'Calcul de l\u2019occupation',
};

export function NightAuditClient({ hotelId }: { hotelId: string }) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  function load() {
    setLoading(true);
    fetch(`/api/night-audit?hotelId=${hotelId}`)
      .then((r) => r.json())
      .then((d) => setRuns(d.runs ?? []))
      .finally(() => setLoading(false));
  }

  useEffect(load, [hotelId]);

  async function triggerAudit() {
    setRunning(true);
    await fetch('/api/night-audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hotelId }),
    });
    setRunning(false);
    load();
  }

  if (loading) return <div className="text-ink-400">Chargement…</div>;

  return (
    <div>
      <header className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="font-display text-3xl text-parchment">Night Audit</h1>
          <p className="mt-1 text-sm text-ink-400">{runs.length} clôtures enregistrées</p>
        </div>
        <button
          onClick={triggerAudit}
          disabled={running}
          className="border border-brass-dim px-4 py-2 text-sm text-brass-light hover:border-brass hover:text-brass disabled:opacity-50"
        >
          {running ? 'Audit en cours…' : "Lancer l'audit des KPI"}
        </button>
      </header>

      <ul className="flex flex-col gap-6">
        {runs.map((run) => (
          <li key={run.id} className="border border-ink-700">
            <div className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
              <div>
                <span className="font-display text-lg text-parchment">{run.business_date}</span>
                <span className="ml-3 text-xs text-ink-400">
                  {run.status === 'completed' ? 'Clôturé' : run.status}
                  {run.staff_users?.display_name ? ` · ${run.staff_users.display_name}` : ''}
                </span>
              </div>
            </div>
            <ul className="divide-y divide-ink-700">
              {run.night_audit_checks.map((c) => (
                <li key={c.id} className="flex items-center justify-between px-4 py-2 text-sm">
                  <span className="text-ink-400">{CHECK_LABELS[c.check_type] ?? c.check_type}</span>
                  <span
                    className={
                      c.status === 'passed' ? 'text-moss' : c.status === 'warning' ? 'text-ochre' : 'text-wine'
                    }
                  >
                    {c.status === 'passed' ? 'Conforme' : c.status === 'warning' ? 'Avertissement' : 'Échec'}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
