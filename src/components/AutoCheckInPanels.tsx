'use client';

import { useEffect, useState } from 'react';
import { summarizeAutoCheckIn, type AutoCheckInRun } from '@/lib/autoCheckIn';
import type { OverdueRow } from '@/lib/overdueArrivals';
import { RoomPickerDialog } from '@/components/RoomPickerDialog';

interface Settings { enabled: boolean; fromHour: number; canChange: boolean }

/** Barre du check-in automatique : bouton immediat, reglage quotidien, resultat detaille. */
export function AutoCheckInBar({ onDone }: { onDone: () => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [running, setRunning] = useState(false);
  const [run, setRun] = useState<AutoCheckInRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overdueOpen, setOverdueOpen] = useState(false);
  const [pickRun, setPickRun] = useState<{ id: string; reason: string } | null>(null);

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
        <button onClick={() => setOverdueOpen(true)} className="btn-secondary">Arrivées en retard</button>
        {settings && (
          <label className="flex items-center gap-2 text-sm text-ink-400" title={settings.canChange ? '' : 'Réservé à l’administrateur'}>
            <input type="checkbox" checked={settings.enabled} disabled={!settings.canChange} onChange={(e) => void toggle(e.target.checked)} />
            Automatique chaque jour à partir de {settings.fromHour} h
          </label>
        )}
      </div>
      {error && <p role="alert" className="mt-2 rounded-sm bg-wine-tint px-3 py-2 text-sm text-wine">{error}</p>}
      {pickRun && <RoomPickerDialog reservationId={pickRun.id} reason={pickRun.reason} onClose={(done) => { setPickRun(null); if (done) { setRun((cur) => (cur ? { ...cur, results: cur.results.filter((x) => x.reservation_id !== pickRun.id) } : cur)); onDone(); } }} />}
      {overdueOpen && <OverdueArrivalsDialog onClose={(changed) => { setOverdueOpen(false); if (changed) onDone(); }} />}

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
                  <span className={`text-right ${r.outcome === 'checked_in' ? 'text-emerald-400' : r.outcome === 'failed' ? 'text-wine' : 'text-ink-400'}`}>
                    {r.outcome === 'checked_in' ? `Chambre ${r.room}` : r.reason}
                    {r.outcome === 'failed' && <button onClick={() => setPickRun({ id: r.reservation_id, reason: r.reason ?? '' })} className="mt-1 block w-full rounded border border-ink-700 px-2 py-0.5 text-xs text-parchment hover:bg-ink-800">Choisir une chambre</button>}
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

const KIND_LABEL: Record<OverdueRow['kind'], string> = { auto: 'Enregistrable', manual: 'À faire à la main', blocked: 'Non automatique' };
const KIND_STYLE: Record<OverdueRow['kind'], string> = { auto: 'text-emerald-400', manual: 'text-amber-400', blocked: 'text-ink-400' };

/** Sejours en cours jamais enregistres : apercu, puis enregistrement en un clic de ceux dont la chambre peut etre choisie automatiquement. */
export function OverdueArrivalsDialog({ onClose }: { onClose: (changed: boolean) => void }) {
  const [rows, setRows] = useState<OverdueRow[] | null>(null);
  const [today, setToday] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<(AutoCheckInRun & { kpi?: { from: string; to: string; days: number } | null }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState<{ id: string; reason: string } | null>(null);
  const [changed, setChanged] = useState(false);

  async function loadRows() {
    try {
      const r = await fetch('/api/reservations/overdue-arrivals');
      const json = await r.json();
      if (!r.ok) return setError(json.error ?? 'Chargement impossible');
      setError(null); setRows(json.rows); setToday(json.today);
    } catch { setError('Chargement impossible'); }
  }
  useEffect(() => { void loadRows(); }, []);

  const auto = (rows ?? []).filter((r) => r.kind === 'auto');
  const dmy = (d: string) => d.split('-').reverse().join('/');

  async function submit() {
    if (!window.confirm(`Enregistrer ${auto.length} séjour(s) en cours, avec attribution automatique des chambres ?`)) return;
    setBusy(true); setError(null);
    const res = await fetch('/api/reservations/overdue-arrivals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) return setError(json.error ?? 'Échec');
    setDone(json);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-deep/50 p-4" onClick={() => onClose(Boolean(done) || changed)}>
      <div role="dialog" aria-modal="true" aria-label="Arrivées en retard" className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-md border border-ink-700 bg-ink-900 p-6 shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-display text-2xl tracking-tight text-parchment">Arrivées en retard</h2>
          <button onClick={() => onClose(Boolean(done) || changed)} className="btn-secondary btn-sm">Fermer</button>
        </div>
        <p className="mb-4 text-sm text-ink-400">Clients dont le séjour est en cours{today ? ` au ${dmy(today)}` : ''} mais jamais enregistrés. Tant qu&apos;ils ne le sont pas, ils ne comptent ni dans l&apos;occupation ni dans le revenu.</p>
        {error && <p role="alert" className="mb-3 rounded-sm bg-wine-tint px-3 py-2 text-sm text-wine">{error}</p>}
        {!rows && !error && <p className="text-ink-400">Chargement…</p>}

        {pick && <RoomPickerDialog reservationId={pick.id} reason={pick.reason} onClose={(ok) => { setPick(null); if (ok) { setChanged(true); void loadRows(); } }} />}
        {done ? (
          <div>
            <p className="mb-2 text-sm text-parchment">{summarizeAutoCheckIn(done)}{done.depositsApplied > 0 ? ` · acomptes déduits : ${done.depositsApplied.toLocaleString('fr-FR')}` : ''}</p>
            {done.kpi && <p className="mb-2 text-sm text-emerald-400">Indicateurs recalculés : {done.kpi.days} jours ({dmy(done.kpi.from)} au {dmy(done.kpi.to)}).</p>}
            {done.depositErrors.length > 0 && <p role="alert" className="mb-2 rounded-sm bg-wine-tint px-3 py-2 text-sm text-wine">Acompte non reporté : {done.depositErrors.join(' ; ')}</p>}
            <ul className="divide-y divide-ink-700/70 text-sm">
              {done.results.map((r) => (
                <li key={r.reservation_id} className="flex justify-between gap-3 py-2"><span className="tabular text-ink-400">{r.confirmation_number}</span><span className={r.outcome === 'checked_in' ? 'text-emerald-400' : 'text-wine'}>{r.outcome === 'checked_in' ? `Chambre ${r.room ?? ''}` : r.reason}</span></li>
              ))}
            </ul>
          </div>
        ) : rows && (
          <>
            {rows.length === 0 ? <p className="text-sm text-emerald-400">Aucun séjour en cours en attente d&apos;enregistrement.</p> : (
              <>
                <ul className="mb-4 divide-y divide-ink-700/70 text-sm">
                  {rows.map((r) => (
                    <li key={r.id} className="py-2">
                      <div className="flex items-start justify-between gap-3">
                        <span><span className="tabular text-parchment">{r.confirmation_number}</span><span className="block text-xs text-ink-400">{dmy(r.arrival_date)} → {dmy(r.departure_date)} · {r.typeName ?? 'sans type'}</span></span>
                        <span className={`text-right ${KIND_STYLE[r.kind]}`}>{KIND_LABEL[r.kind]}{r.reason && <span className="block text-xs text-ink-400">{r.reason}</span>}
                          {r.kind === 'manual' && <button onClick={() => setPick({ id: r.id, reason: r.reason ?? '' })} className="mt-1 rounded border border-ink-700 px-2 py-0.5 text-xs text-parchment hover:bg-ink-800">Choisir une chambre</button>}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="mb-3 text-xs text-ink-400">« À faire à la main » : cliquez sur <b>Choisir une chambre</b> sur la ligne. Un client qui n&apos;est jamais venu : enregistrez-le puis utilisez <b>Annuler le check-in</b> (no-show) dans la liste des réservations.</p>
                <button onClick={submit} disabled={busy || auto.length === 0} className="btn-primary">{busy ? 'Enregistrement…' : `Enregistrer les ${auto.length} séjour(s) enregistrable(s)`}</button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
