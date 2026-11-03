'use client';

import { useEffect, useMemo, useState } from 'react';

interface RoomOption { id: string; roomNumber: string; roomTypeId: string | null; typeName: string }

/** Choix d'une chambre propre pour un check-in manuel (reservation sans type de chambre, ou plus de chambre libre du type reserve). */
export function RoomPickerDialog({ reservationId, reason, onClose }: { reservationId: string; reason: string; onClose: (checkedIn: boolean) => void }) {
  const [rooms, setRooms] = useState<RoomOption[] | null>(null);
  const [selected, setSelected] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/rooms/check-in-options').then(async (r) => {
      const json = await r.json();
      if (!r.ok) return setError(json.error ?? 'Chargement impossible');
      setRooms(json.rooms);
    }).catch(() => setError('Chargement impossible'));
  }, []);

  const groups = useMemo(() => {
    const m = new Map<string, RoomOption[]>();
    for (const r of rooms ?? []) m.set(r.typeName, [...(m.get(r.typeName) ?? []), r]);
    return [...m.entries()];
  }, [rooms]);

  async function submit() {
    if (!selected) return;
    setBusy(true); setError(null);
    const res = await fetch(`/api/reservations/${reservationId}/check-in`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomId: selected }) });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) return setError(json.error ?? 'Check-in impossible');
    onClose(true);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-deep/50 p-4" onClick={() => onClose(false)}>
      <div role="dialog" aria-modal="true" aria-label="Choisir une chambre" className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-md border border-ink-700 bg-ink-900 p-6 shadow-pop" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-1 font-display text-2xl tracking-tight text-parchment">Choisir une chambre</h2>
        <p className="mb-4 text-sm text-ink-400">{reason}</p>
        {!rooms && !error && <p className="text-ink-400">Chargement des chambres propres…</p>}
        {rooms && rooms.length === 0 && <p className="text-sm text-wine">Aucune chambre propre n&apos;est disponible.</p>}
        {groups.map(([type, list]) => (
          <fieldset key={type} className="mb-3">
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-400">{type} ({list.length})</legend>
            <div className="flex flex-wrap gap-2">
              {list.map((r) => (
                <label key={r.id} className={`cursor-pointer rounded border px-3 py-1.5 text-sm tabular ${selected === r.id ? 'border-brass bg-brass/20 text-parchment' : 'border-ink-700 text-ink-400 hover:text-parchment'}`}>
                  <input type="radio" name="room" value={r.id} checked={selected === r.id} onChange={() => setSelected(r.id)} className="sr-only" />
                  {r.roomNumber}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        {error && <p role="alert" className="mb-3 rounded-sm bg-wine-tint px-3 py-2 text-sm text-wine">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => onClose(false)} className="btn-secondary btn-sm">Retour</button>
          <button onClick={submit} disabled={!selected || busy} className="btn-primary btn-sm">{busy ? 'Check-in…' : 'Enregistrer l’arrivée'}</button>
        </div>
      </div>
    </div>
  );
}
