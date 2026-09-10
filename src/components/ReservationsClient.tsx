'use client';

import { useEffect, useState } from 'react';
import { formatCurrency, formatDate } from '@/lib/formatters';
import { StatusBadge, VipBadge } from '@/components/Badges';

interface Reservation {
  id: string;
  confirmation_number: string;
  status: string;
  channel: string;
  arrival_date: string;
  departure_date: string;
  total_amount: number;
  currency_code: string;
  guests: { first_name: string; last_name: string; vip_tier: string } | null;
  room_types: { name: string } | null;
  rooms: { room_number: string } | null;
}

export function ReservationsClient({ hotelId }: { hotelId: string }) {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/reservations?hotelId=${hotelId}`)
      .then((r) => r.json())
      .then((d) => setReservations(d.reservations ?? []))
      .finally(() => setLoading(false));
  }, [hotelId]);

  if (loading) return <div className="text-ink-400">Chargement…</div>;

  return (
    <div>
      <header className="mb-8">
        <h1 className="font-display text-3xl text-parchment">Réservations</h1>
        <p className="mt-1 text-sm text-ink-400">{reservations.length} dossiers les plus récents</p>
      </header>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-ink-700 text-left text-ink-400">
            <th className="py-2 pr-4 font-normal">Confirmation</th>
            <th className="py-2 pr-4 font-normal">Client</th>
            <th className="py-2 pr-4 font-normal">Chambre</th>
            <th className="py-2 pr-4 font-normal">Arrivée</th>
            <th className="py-2 pr-4 font-normal">Départ</th>
            <th className="py-2 pr-4 font-normal">Statut</th>
            <th className="py-2 pr-4 font-normal text-right">Montant</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-700">
          {reservations.map((r) => (
            <tr key={r.id}>
              <td className="py-3 pr-4 tabular text-ink-400">{r.confirmation_number}</td>
              <td className="py-3 pr-4">
                <div className="text-parchment">
                  {r.guests?.first_name} {r.guests?.last_name}
                </div>
                <VipBadge tier={r.guests?.vip_tier ?? 'none'} />
              </td>
              <td className="py-3 pr-4 text-ink-400">
                {r.rooms?.room_number ?? '—'} · {r.room_types?.name}
              </td>
              <td className="py-3 pr-4 tabular">{formatDate(r.arrival_date)}</td>
              <td className="py-3 pr-4 tabular">{formatDate(r.departure_date)}</td>
              <td className="py-3 pr-4">
                <StatusBadge status={r.status} />
              </td>
              <td className="py-3 pr-4 tabular text-right text-parchment">
                {formatCurrency(r.total_amount, r.currency_code)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
