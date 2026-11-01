'use client';

import { useEffect, useState } from 'react';
import { CLIENT_RUN_INTERVAL_MS, clientRunDue, summarizeAutoCheckIn, type AutoCheckInRun } from '@/lib/autoCheckIn';

const STORAGE_KEY = 'autoCheckInLastRun';

/**
 * Declenche le check-in automatique des arrivees du jour quand un utilisateur autorise ouvre l'application,
 * si l'hotel l'a active et que l'heure locale est venue (traitement idempotent, au plus une fois toutes les 30 minutes par navigateur).
 * Rend la fonction fiable meme quand la routine planifiee est retardee.
 */
export function AutoCheckInRunner() {
  const [run, setRun] = useState<AutoCheckInRun | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const last = Number(window.localStorage.getItem(STORAGE_KEY) ?? '');
        if (!clientRunDue(Number.isFinite(last) && last > 0 ? last : null, Date.now())) return;
        const s = await fetch('/api/settings/auto-check-in');
        if (!s.ok || cancelled) return;
        const settings = await s.json();
        if (!settings.dueNow) return;
        window.localStorage.setItem(STORAGE_KEY, String(Date.now()));
        const res = await fetch('/api/reservations/auto-check-in', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ auto: true }) });
        if (!res.ok || cancelled) return;
        const json = await res.json();
        if (!json.notDue && (json.checked_in > 0 || json.failed > 0)) setRun(json);
      } catch { /* silencieux : la routine planifiee et le bouton restent disponibles */ }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!run) return null;
  return (
    <div role="status" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 print:hidden">
      <span>
        Check-in automatique : {summarizeAutoCheckIn(run)}.{' '}
        {run.failed > 0 && <a href="/reservations" className="underline">Voir les réservations à traiter à la main.</a>}
      </span>
      <button onClick={() => setRun(null)} className="btn-secondary btn-sm bg-white">Fermer</button>
    </div>
  );
}

export { CLIENT_RUN_INTERVAL_MS };
