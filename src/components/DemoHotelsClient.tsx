'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatDate } from '@/lib/formatters';
import { DEMO_LIMITS } from '@/lib/demoHotels';

interface DemoHotel {
  tenantId: string;
  tenantCode: string;
  hotelName: string;
  createdAt: string;
  rooms: number;
  reservations: number;
}

interface Created {
  tenantCode: string;
  hotelName: string;
  rooms: number;
  guests: number;
  reservations: number;
  password: string;
  accounts: { email: string; displayName: string; role: string | null }[];
}

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Propriétaire',
  GM: 'Directeur général',
  FRONT_DESK: 'Réception',
  HOUSEKEEPING: 'Housekeeping',
  NIGHT_AUDIT: 'Night audit',
  CONCIERGE: 'Conciergerie',
};

export function DemoHotelsClient() {
  const [demos, setDemos] = useState<DemoHotel[]>([]);
  const [loading, setLoading] = useState(true);
  const [hotelName, setHotelName] = useState('Grand Hôtel Démo');
  const [rooms, setRooms] = useState(String(DEMO_LIMITS.rooms.default));
  const [guests, setGuests] = useState(String(DEMO_LIMITS.guests.default));
  const [reservations, setReservations] = useState(String(DEMO_LIMITS.reservations.default));
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/demo-hotels');
    if (res.ok) setDemos((await res.json()).demos);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    setCreated(null);
    const res = await fetch('/api/demo-hotels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hotelName, rooms: Number(rooms), guests: Number(guests), reservations: Number(reservations) }),
    });
    const body = await res.json();
    setCreating(false);
    if (!res.ok) {
      setError(body.error ?? 'Création impossible');
      return;
    }
    setCreated(body);
    load();
  }

  async function handleDelete(d: DemoHotel) {
    if (!window.confirm(`Supprimer définitivement l'hôtel de démonstration « ${d.hotelName} » et toutes ses données ?`)) return;
    const res = await fetch(`/api/demo-hotels/${d.tenantId}`, { method: 'DELETE' });
    if (!res.ok) setError((await res.json()).error ?? 'Suppression impossible');
    else {
      if (created?.tenantCode === d.tenantCode) setCreated(null);
      load();
    }
  }

  async function copy(label: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="max-w-4xl">
      <header className="mb-6">
        <h1 className="page-title">Hôtels de démonstration</h1>
        <p className="page-subtitle">
          Un hôtel complet en un clic : chambres, clients VIP, réservations, tarifs, housekeeping, folios, conciergerie et Night Audit.
        </p>
      </header>

      <form onSubmit={handleCreate} className="panel mb-6 p-5">
        <div className="grid gap-4 sm:grid-cols-4">
          <div className="sm:col-span-4">
            <label htmlFor="demo-name" className="field-label">Nom de l'hôtel</label>
            <input id="demo-name" value={hotelName} onChange={(e) => setHotelName(e.target.value)} minLength={2} maxLength={80} required className="field" />
          </div>
          {[
            ['demo-rooms', 'Chambres', rooms, setRooms, DEMO_LIMITS.rooms],
            ['demo-guests', 'Clients', guests, setGuests, DEMO_LIMITS.guests],
            ['demo-resa', 'Réservations', reservations, setReservations, DEMO_LIMITS.reservations],
          ].map(([id, label, value, setter, lim]) => (
            <div key={id as string}>
              <label htmlFor={id as string} className="field-label">{label as string}</label>
              <input
                id={id as string}
                type="number"
                inputMode="numeric"
                value={value as string}
                onChange={(e) => (setter as (v: string) => void)(e.target.value)}
                min={(lim as typeof DEMO_LIMITS.rooms).min}
                max={(lim as typeof DEMO_LIMITS.rooms).max}
                required
                className="field tabular"
              />
              <p className="mt-1 text-xs text-ink-500">
                {(lim as typeof DEMO_LIMITS.rooms).min} à {(lim as typeof DEMO_LIMITS.rooms).max}
              </p>
            </div>
          ))}
        </div>
        {error && (
          <p role="alert" className="mt-4 rounded-sm bg-wine-tint px-3 py-2 text-sm text-wine">
            {error}
          </p>
        )}
        <div className="mt-5 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-4">
          <button type="submit" disabled={creating} className="btn-primary whitespace-nowrap">
            {creating ? 'Création en cours…' : "Créer l'hôtel de démonstration"}
          </button>
          <span className="text-xs text-ink-500">Montants en euros ; 25 hôtels de démonstration au maximum.</span>
        </div>
      </form>

      {created && (
        <section className="panel mb-6 border-t-2 border-t-brass p-5" aria-live="polite">
          <h2 className="font-display text-xl tracking-tight text-parchment">{created.hotelName} est prêt</h2>
          <p className="mt-1 text-sm text-ink-400 tabular">
            {created.rooms} chambres · {created.guests} clients · {created.reservations} réservations
          </p>

          <div className="mt-4 grid gap-4 rounded bg-ink-800 p-4 sm:grid-cols-2">
            <div>
              <div className="text-xs font-medium text-ink-400">Code établissement</div>
              <div className="mt-1 flex items-center gap-2">
                <code className="tabular text-base font-medium text-parchment">{created.tenantCode}</code>
                <button type="button" onClick={() => copy('code', created.tenantCode)} className="btn-secondary btn-sm">
                  {copied === 'code' ? 'Copié' : 'Copier'}
                </button>
              </div>
            </div>
            <div>
              <div className="text-xs font-medium text-ink-400">Mot de passe (commun aux 6 comptes)</div>
              <div className="mt-1 flex items-center gap-2">
                <code className="tabular text-base font-medium text-parchment">{created.password}</code>
                <button type="button" onClick={() => copy('mdp', created.password)} className="btn-secondary btn-sm">
                  {copied === 'mdp' ? 'Copié' : 'Copier'}
                </button>
              </div>
            </div>
          </div>
          <p className="mt-3 rounded-sm bg-ochre-tint px-3 py-2 text-sm text-ochre">
            Ce mot de passe n'est affiché qu'une seule fois et n'est pas conservé. Pour vous connecter : déconnectez-vous, saisissez l'e-mail d'un compte,
            ce mot de passe et le code établissement (les e-mails de démonstration sont identiques d'un hôtel à l'autre).
          </p>

          <div className="panel mt-4 overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Compte</th>
                  <th>Fonction</th>
                  <th>Nom</th>
                </tr>
              </thead>
              <tbody>
                {created.accounts.map((a) => (
                  <tr key={a.email}>
                    <td className="tabular">{a.email}</td>
                    <td className="text-ink-400">{ROLE_LABELS[a.role ?? ''] ?? a.role ?? '—'}</td>
                    <td>{a.displayName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="panel">
        <div className="flex items-center justify-between border-b border-ink-700 px-5 py-3.5">
          <h2 className="text-base font-semibold text-parchment">Hôtels de démonstration existants</h2>
          <span className="rounded-sm bg-ink-800 px-2 py-0.5 text-xs font-medium text-ink-400">{demos.length} / 25</span>
        </div>
        {loading ? (
          <p className="px-5 py-6 text-sm text-ink-400">Chargement…</p>
        ) : demos.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-ink-400">Aucun hôtel de démonstration créé depuis cet écran.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table min-w-[560px]">
              <thead>
                <tr>
                  <th>Hôtel</th>
                  <th>Code</th>
                  <th className="text-right">Chambres</th>
                  <th className="text-right">Réservations</th>
                  <th>Créé le</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {demos.map((d) => (
                  <tr key={d.tenantId}>
                    <td className="font-medium text-parchment">{d.hotelName}</td>
                    <td className="tabular text-ink-400">{d.tenantCode}</td>
                    <td className="num">{d.rooms}</td>
                    <td className="num">{d.reservations}</td>
                    <td className="tabular text-ink-400">{formatDate(d.createdAt)}</td>
                    <td className="text-right">
                      <button onClick={() => handleDelete(d)} className="row-action text-wine hover:bg-wine-tint">
                        Supprimer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
