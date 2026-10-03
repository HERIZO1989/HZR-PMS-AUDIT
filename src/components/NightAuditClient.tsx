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
  const [posting, setPosting] = useState(false);
  const [businessDate, setBusinessDate] = useState(() => new Date().toLocaleDateString('en-CA'));
  const [postMessage, setPostMessage] = useState<string | null>(null);

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

  async function postRoomCharges() {
    setPosting(true);
    setPostMessage(null);
    try {
      const res = await fetch('/api/night-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hotelId, action: 'post_room_charges', businessDate }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPostMessage(data.error ?? 'Échec du posting des nuitées');
      } else {
        const r = data.result;
        setPostMessage(
          `${r.posted} nuitée(s) postée(s), ${r.skipped} déjà postée(s) — total TTC ${Number(r.total_posted).toLocaleString('fr-FR')} ${r.currency_code}`
        );
      }
    } catch {
      setPostMessage('Erreur réseau pendant le posting des nuitées');
    } finally {
      setPosting(false);
      load();
    }
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

      <section className="mb-8 border border-ink-600 p-4">
        <h2 className="text-sm text-parchment">Poster les nuitées</h2>
        <p className="mt-1 text-xs text-ink-400">
          Ajoute la nuitée du jour d&apos;exploitation sur le folio de chaque client en séjour (tarif du calendrier).
          Relancer la même date ne crée aucun doublon.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            type="date"
            value={businessDate}
            onChange={(e) => setBusinessDate(e.target.value)}
            className="border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-parchment focus:border-brass focus:outline-none"
          />
          <button
            onClick={postRoomCharges}
            disabled={posting || !businessDate}
            className="border border-brass-dim px-4 py-2 text-sm text-brass-light hover:border-brass hover:text-brass disabled:opacity-50"
          >
            {posting ? 'Posting en cours…' : 'Poster les nuitées'}
          </button>
        </div>
        {postMessage && <p className="mt-3 text-sm text-parchment">{postMessage}</p>}
      </section>

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
