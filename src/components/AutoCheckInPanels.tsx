'use client';

import { useEffect, useState } from 'react';
import { summarizeAutoCheckIn, type AutoCheckInRun } from '@/lib/autoCheckIn';

interface Settings { enabled: boolean; fromHour: number; canChange: boolean }

/** Barre du check-in automatique : bouton immediat, reglage quotidien, resultat detaille. */
export function AutoCheckInBar({ onDone }: { onDone: () => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [running, setRunning] = useState(false);
  const [run, setRun] = useState<AutoCheckInRun | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/settings/auto-check-in').then(async (r) => { if (r.ok) setSettings(await r.json()); }).catch(() => undefined);
  }, []);

  async function runNow() {
    if (!window.confirm('Enregistrer maintenant toutes les arrivées confirmées du jour, avec attribution automatique des chambres ?')) return;
    setRunning(true); setError(null);
    const res = await fetch('/api/reservations/auto-check-in', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const json = await res.json();
    setRunning(false);
    if (!res.ok) return setError(json.error ?? 'Échec du check-in automatique');
    setRun(json);
    onDone();
  }

  async function toggle(enabled: boolean) {
    setError(null);
    const res = await fetch('/api/settings/auto-check-in', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) });
    const json = await res.json();
    if (!res.ok) return setError(json.error ?? 'Réglage impossible');
    setSettings((s) => (s ? { ...s, enabled: json.enabled } : s));
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={runNow} disabled={running} className="btn-secondary">{running ? 'Check-in en cours…' : 'Check-in automatique du jour'}</button>
        {settings && (
          <label className="flex items-center gap-2 text-sm text-ink-400" title={settings.canChange ? '' : 'Réservé à l’administrateur'}>
            <input type="checkbox" checked={settings.enabled} disabled={!settings.canChange} onChange={(e) => void toggle(e.target.checked)} />
            Automatique chaque jour à partir de {settings.fromHour} h
          </label>
        )}
      </div>
      {error && <p role="alert" className="mt-2 rounded-sm bg-wine-tint px-3 py-2 text-sm text-wine">{error}</p>}

      {run && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-deep/50 p-4" onClick={() => setRun(null)}>
          <div role="dialog" aria-modal="true" aria-label="Résultat du check-in automatique" className="max-h-[88vh] w-full max-w-xl overflow-y-auto rounded-md border border-ink-700 bg-ink-900 p-6 shadow-pop" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-2xl tracking-tight text-parchment">Check-in automatique</h2>
              <button onClick={() => setRun(null)} className="btn-secondary btn-sm">Fermer</button>
            </div>
            <p className="mb-3 text-sm text-parchment">{summarizeAutoCheckIn(run)}{run.depositsApplied > 0 ? ` · acomptes déduits : ${run.depositsApplied.toLocaleString('fr-FR')}` : ''}</p>
            {run.depositErrors.length > 0 && <p role="alert" className="mb-3 rounded-sm bg-wine-tint px-3 py-2 text-sm text-wine">Acompte non reporté : {run.depositErrors.join(' ; ')}</p>}
            <ul className="divide-y divide-ink-700/70 text-sm">
              {run.results.map((r) => (
                <li key={r.reservation_id} className="flex items-start justify-between gap-3 py-2">
                  <span className="tabular text-ink-400">{r.confirmation_number}</span>
                  <span className={r.outcome === 'checked_in' ? 'text-emerald-400' : r.outcome === 'failed' ? 'text-wine' : 'text-ink-400'}>
                    {r.outcome === 'checked_in' ? `Chambre ${r.room}` : r.reason}
                  </span>
                </li>
              ))}
              {run.results.length === 0 && <li className="py-2 text-ink-400">Aucune arrivée confirmée aujourd&apos;hui.</li>}
            </ul>
            <p className="mt-3 text-xs text-ink-400">Un client qui ne vient pas : utilisez « Annuler le check-in » sur sa ligne (no-show ou annulation) avant la facturation de nuit, vers 3 h du matin.</p>
          </div>
        </div>
      )}
    </>
  );
}

/** Annulation d'un check-in : no-show, annulation, ou retour en attente. */
export function RevertCheckInDialog({ reservationId, onClose }: { reservationId: string; onClose: (changed: boolean) => void }) {
  const [to, setTo] = useState<'no_show' | 'cancelled' | 'confirmed'>('no_show');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setError(null);
    const res = await fetch(`/api/reservations/${reservationId}/revert-check-in`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to, reason }) });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) return setError(json.error ?? 'Échec');
    onClose(true);
  }

  const options: { code: typeof to; label: string; hint: string }[] = [
    { code: 'no_show', label: 'No-show', hint: 'Le client ne s’est pas présenté.' },
    { code: 'cancelled', label: 'Annulation', hint: 'La réservation est annulée.' },
    { code: 'confirmed', label: 'Remettre en attente', hint: 'Erreur de check-in : à refaire à la main (la routine ne le refera pas).' },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-deep/50 p-4" onClick={() => onClose(false)}>
      <div role="dialog" aria-modal="true" aria-label="Annuler le check-in" className="w-full max-w-md rounded-md border border-ink-700 bg-ink-900 p-6 shadow-pop" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-1 font-display text-2xl tracking-tight text-parchment">Annuler le check-in</h2>
        <p className="mb-4 text-sm text-ink-400">La chambre est libérée et les acomptes reviennent « en attente ». Impossible si une nuitée est déjà facturée.</p>
        <div className="mb-3 grid gap-2">
          {options.map((o) => (
            <label key={o.code} className="flex cursor-pointer items-start gap-2 rounded border border-ink-700 p-3 text-sm">
              <input type="radio" name="revert-to" checked={to === o.code} onChange={() => setTo(o.code)} className="mt-1" />
              <span><span className="font-medium text-parchment">{o.label}</span><span className="block text-xs text-ink-400">{o.hint}</span></span>
            </label>
          ))}
        </div>
        <input aria-label="Motif" placeholder="Motif (facultatif)" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} className="field mb-3 w-full" />
        {error && <p role="alert" className="mb-3 rounded-sm bg-wine-tint px-3 py-2 text-sm text-wine">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={() => onClose(false)} className="btn-secondary btn-sm">Retour</button>
          <button onClick={submit} disabled={busy} className="btn-primary btn-sm">{busy ? 'En cours…' : 'Confirmer'}</button>
        </div>
      </div>
    </div>
  );
}
