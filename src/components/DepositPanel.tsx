'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatCurrency, formatDate } from '@/lib/formatters';
import { DEPOSIT_METHODS, DEPOSIT_STATUSES } from '@/lib/deposits';

interface Deposit {
  id: string;
  amount: number;
  currency_code: string;
  method: string;
  status: string;
  transaction_reference: string | null;
  received_at: string;
  resolved_at: string | null;
  resolution_note: string | null;
}
interface DepositData {
  reservation: { id: string; confirmation_number: string; status: string; total_amount: number; currency_code: string };
  deposits: Deposit[];
  canRecord: boolean;
  canResolve: boolean;
}

const STATUS_LABELS = Object.fromEntries(DEPOSIT_STATUSES.map((s) => [s.code, s.label]));
const METHOD_LABELS = Object.fromEntries(DEPOSIT_METHODS.map((m) => [m.code, m.label]));

export function DepositPanel({ reservationId, onClose }: { reservationId: string; onClose: () => void }) {
  const [data, setData] = useState<DepositData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const load = useCallback(async () => {
    const res = await fetch(`/api/reservations/${reservationId}/deposits`);
    const json = await res.json();
    setLoading(false);
    if (!res.ok) return setError(json.error ?? 'Échec du chargement');
    setData(json);
  }, [reservationId]);

  useEffect(() => { void load(); }, [load]);

  async function handleRecord() {
    setSaving(true);
    setError(null);
    // La clé d'idempotence évite un acompte en double si le bouton est pressé deux fois ou si la requête est rejouée.
    const res = await fetch(`/api/reservations/${reservationId}/deposits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, method, reference, idempotencyKey }),
    });
    const json = await res.json();
    setSaving(false);
    if (!res.ok) return setError(json.error);
    setAmount('');
    setReference('');
    setIdempotencyKey(crypto.randomUUID());
    void load();
  }

  async function handleResolve(id: string, action: 'refund' | 'forfeit') {
    const verb = action === 'refund' ? 'rembourser au client' : 'conserver (pénalité)';
    if (!window.confirm(`Confirmer : ${verb} cet acompte ? Cette action est définitive.`)) return;
    setBusyId(id);
    setError(null);
    const res = await fetch(`/api/deposits/${id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    const json = await res.json();
    setBusyId(null);
    if (!res.ok) return setError(json.error);
    void load();
  }

  const r = data?.reservation;
  const held = (data?.deposits ?? []).filter((d) => d.status === 'held').reduce((s, d) => s + Number(d.amount), 0);
  const open = r?.status === 'tentative' || r?.status === 'confirmed';
  const closedOut = r?.status === 'cancelled' || r?.status === 'no_show';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-deep/50 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Acomptes" className="max-h-[88vh] w-full max-w-xl overflow-y-auto rounded-md border border-ink-700 bg-ink-900 p-6 shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-display text-2xl tracking-tight text-parchment">Acomptes</h2>
          <button onClick={onClose} className="btn-secondary btn-sm">Fermer</button>
        </div>

        {loading ? <p className="text-ink-400">Chargement…</p> : !data || !r ? (
          error ? <p role="alert" className="rounded-sm bg-wine-tint px-3 py-2 text-sm text-wine">{error}</p> : null
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between border-b border-ink-700 pb-3 text-sm">
              <span className="tabular text-ink-400">{r.confirmation_number}</span>
              <span className="text-ink-400">Séjour : <span className="tabular text-parchment">{formatCurrency(Number(r.total_amount), r.currency_code)}</span></span>
            </div>

            {data.deposits.length === 0 ? <p className="mb-4 text-sm text-ink-400">Aucun acompte sur cette réservation.</p> : (
              <ul className="mb-4 divide-y divide-ink-700/70 text-sm">
                {data.deposits.map((d) => (
                  <li key={d.id} className="py-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-ink-400">{formatDate(d.received_at)} · {METHOD_LABELS[d.method] ?? d.method}{d.transaction_reference ? ` · ${d.transaction_reference}` : ''}</span>
                      <span className="tabular text-parchment">{formatCurrency(Number(d.amount), d.currency_code)}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-3">
                      <span className="text-xs text-ink-400">{STATUS_LABELS[d.status] ?? d.status}{d.resolution_note ? ` — ${d.resolution_note}` : ''}</span>
                      {d.status === 'held' && closedOut && data.canResolve && (
                        <span className="flex gap-1">
                          <button disabled={busyId === d.id} onClick={() => handleResolve(d.id, 'refund')} className="row-action text-steel hover:bg-steel-tint">Rembourser</button>
                          <button disabled={busyId === d.id} onClick={() => handleResolve(d.id, 'forfeit')} className="row-action text-wine hover:bg-wine-tint">Conserver</button>
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="mb-4 flex items-center justify-between rounded bg-ink-800 px-4 py-3">
              <span className="font-medium text-parchment">Acomptes en attente</span>
              <span className="tabular font-display text-xl tracking-tight text-parchment">{formatCurrency(held, r.currency_code)}</span>
            </div>
            {closedOut && held > 0 && !data.canResolve && <p className="mb-4 text-sm text-ink-400">Réservation annulée : le remboursement ou la conservation de l&apos;acompte est réservé à la direction.</p>}

            {error && <p role="alert" className="mb-4 rounded-sm bg-wine-tint px-3 py-2 text-sm text-wine">{error}</p>}

            {open && data.canRecord && (
              <div className="rounded border border-ink-700 p-4">
                <div className="mb-3 text-sm font-semibold text-parchment">Encaisser un acompte</div>
                <div className="flex flex-wrap gap-2">
                  <select aria-label="Mode de paiement" value={method} onChange={(e) => setMethod(e.target.value)} className="field w-auto">
                    {DEPOSIT_METHODS.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
                  </select>
                  <input type="number" min="1" step="any" inputMode="decimal" aria-label="Montant" placeholder="Montant" value={amount} onChange={(e) => setAmount(e.target.value)} className="field min-w-[8rem] flex-1 tabular" />
                  <input aria-label="Référence" placeholder="Référence (facultatif)" maxLength={100} value={reference} onChange={(e) => setReference(e.target.value)} className="field min-w-[8rem] flex-1" />
                  <button onClick={handleRecord} disabled={saving || !amount} className="btn-primary btn-sm">{saving ? 'Enregistrement…' : 'Encaisser'}</button>
                </div>
                <p className="mt-2 text-xs text-ink-400">L&apos;acompte est une avance : il n&apos;entre pas dans le CA et sera déduit du solde au check-in.</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
