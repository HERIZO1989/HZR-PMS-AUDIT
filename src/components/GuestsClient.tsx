'use client';

import { useEffect, useState } from 'react';
import { VIP_LABELS } from '@/lib/formatters';

interface Guest {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  vip_tier: string;
  loyalty_number: string | null;
  is_blacklisted: boolean;
  nationality: string | null;
}

export function GuestsClient({ tenantId }: { tenantId: string }) {
  const [guests, setGuests] = useState<Guest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showVipOnly, setShowVipOnly] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    fetch(`/api/guests?tenantId=${tenantId}`)
      .then((r) => r.json())
      .then((d) => setGuests(d.guests ?? []))
      .finally(() => setLoading(false));
  }

  useEffect(load, [tenantId]);

  async function handleCreate() {
    setCreating(true);
    setCreateError(null);
    const res = await fetch('/api/guests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName, lastName, email: email || undefined, phone: phone || undefined }),
    });
    const data = await res.json();
    setCreating(false);
    if (!res.ok) return setCreateError(data.error);
    setShowForm(false);
    setFirstName(''); setLastName(''); setEmail(''); setPhone('');
    load();
  }

  if (loading) return <div className="text-ink-400">Chargement…</div>;

  const visible = showVipOnly ? guests.filter((g) => g.vip_tier !== 'none') : guests;

  return (
    <div>
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl text-parchment">Clients</h1>
          <p className="mt-1 text-sm text-ink-400">{visible.length} profils</p>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-ink-400">
            <input type="checkbox" checked={showVipOnly} onChange={(e) => setShowVipOnly(e.target.checked)} />
            VIP uniquement
          </label>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="border border-brass-dim px-4 py-2 text-sm text-brass hover:bg-brass hover:text-white"
          >
            {showForm ? 'Fermer' : 'Nouveau client'}
          </button>
        </div>
      </header>

      {showForm && (
        <div className="mb-8 border border-ink-700 p-5">
          <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <input placeholder="Prénom" value={firstName} onChange={(e) => setFirstName(e.target.value)} className="border border-ink-600 bg-white px-2 py-1.5 text-sm" />
            <input placeholder="Nom" value={lastName} onChange={(e) => setLastName(e.target.value)} className="border border-ink-600 bg-white px-2 py-1.5 text-sm" />
            <input placeholder="Email (optionnel)" value={email} onChange={(e) => setEmail(e.target.value)} className="border border-ink-600 bg-white px-2 py-1.5 text-sm" />
            <input placeholder="Téléphone (optionnel)" value={phone} onChange={(e) => setPhone(e.target.value)} className="border border-ink-600 bg-white px-2 py-1.5 text-sm" />
          </div>
          {createError && <p className="mb-3 text-sm text-wine">{createError}</p>}
          <button
            onClick={handleCreate}
            disabled={creating || !firstName || !lastName}
            className="border border-brass-dim px-4 py-1.5 text-sm text-brass hover:bg-brass hover:text-white disabled:opacity-50"
          >
            {creating ? 'Création…' : 'Créer le client'}
          </button>
        </div>
      )}

      <ul className="divide-y divide-ink-700 border-y border-ink-700">
        {visible.map((g) => (
          <li key={g.id} className="flex flex-col gap-1 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-parchment">
                  {g.first_name} {g.last_name}
                </span>
                {g.vip_tier !== 'none' && (
                  <span className="border border-brass-dim px-2 py-0.5 text-xs text-brass-light">
                    {VIP_LABELS[g.vip_tier]}
                  </span>
                )}
                {g.is_blacklisted && (
                  <span className="border border-wine px-2 py-0.5 text-xs text-wine">Liste noire</span>
                )}
              </div>
              <div className="mt-1 text-sm text-ink-400">
                {g.email ?? '—'} · {g.phone ?? '—'} {g.nationality ? `· ${g.nationality}` : ''}
              </div>
            </div>
            {g.loyalty_number && <span className="tabular text-xs text-ink-400">{g.loyalty_number}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
