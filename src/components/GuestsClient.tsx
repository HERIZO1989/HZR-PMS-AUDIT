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

  useEffect(() => {
    fetch(`/api/guests?tenantId=${tenantId}`)
      .then((r) => r.json())
      .then((d) => setGuests(d.guests ?? []))
      .finally(() => setLoading(false));
  }, [tenantId]);

  if (loading) return <div className="text-ink-400">Chargement…</div>;

  const visible = showVipOnly ? guests.filter((g) => g.vip_tier !== 'none') : guests;

  return (
    <div>
      <header className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="font-display text-3xl text-parchment">Clients</h1>
          <p className="mt-1 text-sm text-ink-400">{visible.length} profils</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-400">
          <input type="checkbox" checked={showVipOnly} onChange={(e) => setShowVipOnly(e.target.checked)} />
          VIP uniquement
        </label>
      </header>

      <ul className="divide-y divide-ink-700 border-y border-ink-700">
        {visible.map((g) => (
          <li key={g.id} className="flex items-center justify-between py-4">
            <div>
              <div className="flex items-center gap-3">
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
