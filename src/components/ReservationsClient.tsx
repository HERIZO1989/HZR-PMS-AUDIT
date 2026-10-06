'use client';

import { useEffect, useState } from 'react';
import { formatCurrency, formatDate } from '@/lib/formatters';
import { StatusBadge, VipBadge } from '@/components/Badges';
import { FolioPanel } from '@/components/FolioPanel';

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

interface RoomType {
  id: string;
  name: string;
  base_rate: number;
}

interface AvailableRoom {
  id: string;
  room_number: string;
  status: string;
}

export function ReservationsClient({ hotelId }: { hotelId: string }) {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openFolioFor, setOpenFolioFor] = useState<string | null>(null);

  // Formulaire de creation (PARTIE I)
  const [showForm, setShowForm] = useState(false);
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [roomTypesCurrency, setRoomTypesCurrency] = useState('EUR');
  const [roomTypeId, setRoomTypeId] = useState('');
  const [arrivalDate, setArrivalDate] = useState('');
  const [departureDate, setDepartureDate] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [guestFirstName, setGuestFirstName] = useState('');
  const [guestLastName, setGuestLastName] = useState('');
  const [availableRooms, setAvailableRooms] = useState<AvailableRoom[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    fetch(`/api/reservations?hotelId=${hotelId}`)
      .then((r) => r.json())
      .then((d) => setReservations(d.reservations ?? []))
      .finally(() => setLoading(false));
  }

  useEffect(load, [hotelId]);

  useEffect(() => {
    if (showForm && roomTypes.length === 0) {
      fetch(`/api/room-types?hotelId=${hotelId}`)
        .then((r) => r.json())
        .then((d) => {
          setRoomTypes(d.roomTypes ?? []);
          setRoomTypesCurrency(d.currencyCode ?? 'EUR');
        });
    }
  }, [showForm, hotelId, roomTypes.length]);

  async function checkAvailability() {
    if (!roomTypeId || !arrivalDate || !departureDate) return;
    setCheckingAvailability(true);
    setSelectedRoomId('');
    const params = new URLSearchParams({ hotelId, roomTypeId, arrival: arrivalDate, departure: departureDate });
    const res = await fetch(`/api/rooms/available?${params}`);
    const data = await res.json();
    setCheckingAvailability(false);
    setAvailableRooms(data.availableRooms ?? []);
  }

  async function handleCreate() {
    setCreating(true);
    setCreateError(null);
    const res = await fetch('/api/reservations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomTypeId,
        arrivalDate,
        departureDate,
        assignedRoomId: selectedRoomId || undefined,
        guestEmail,
        guestFirstName,
        guestLastName,
      }),
    });
    const data = await res.json();
    setCreating(false);
    if (!res.ok) return setCreateError(data.error);
    setShowForm(false);
    setRoomTypeId(''); setArrivalDate(''); setDepartureDate('');
    setGuestEmail(''); setGuestFirstName(''); setGuestLastName('');
    setAvailableRooms([]); setSelectedRoomId('');
    load();
  }

  async function handleAction(id: string, action: 'check-in' | 'check-out' | 'cancel') {
    setBusyId(id);
    setActionError(null);
    const res = await fetch(`/api/reservations/${id}/${action}`, { method: 'POST' });
    const data = await res.json();
    setBusyId(null);
    if (!res.ok) return setActionError(data.error);
    load();
  }

  if (loading) return <div className="text-ink-400">Chargement…</div>;

  return (
    <div>
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="page-title">Réservations</h1>
          <p className="page-subtitle">{reservations.length} dossiers les plus récents</p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="btn-primary"
        >
          {showForm ? 'Fermer' : 'Nouvelle réservation'}
        </button>
      </header>

      {showForm && (
        <div className="panel mb-6 p-5">
          <div className="mb-3 grid grid-cols-3 gap-3">
            <select value={roomTypeId} onChange={(e) => setRoomTypeId(e.target.value)} className="field">
              <option value="">Type de chambre</option>
              {roomTypes.map((rt) => (
                <option key={rt.id} value={rt.id}>{rt.name} — {formatCurrency(rt.base_rate, roomTypesCurrency)}</option>
              ))}
            </select>
            <input type="date" value={arrivalDate} onChange={(e) => setArrivalDate(e.target.value)} className="field" />
            <input type="date" value={departureDate} onChange={(e) => setDepartureDate(e.target.value)} className="field" />
          </div>
          <div className="mb-3 grid grid-cols-3 gap-3">
            <input placeholder="Email client" value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} className="field" />
            <input placeholder="Prénom" value={guestFirstName} onChange={(e) => setGuestFirstName(e.target.value)} className="field" />
            <input placeholder="Nom" value={guestLastName} onChange={(e) => setGuestLastName(e.target.value)} className="field" />
          </div>

          <button
            onClick={checkAvailability}
            disabled={!roomTypeId || !arrivalDate || !departureDate || checkingAvailability}
            className="btn-secondary btn-sm mb-4"
          >
            {checkingAvailability ? 'Vérification…' : 'Vérifier la disponibilité'}
          </button>

          {availableRooms.length > 0 && (
            <div className="mb-3">
              <div className="mb-1 text-xs text-ink-400">{availableRooms.length} chambre(s) disponible(s)</div>
              <div className="flex flex-wrap gap-2">
                {availableRooms.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setSelectedRoomId(r.id)}
                    className={`rounded border px-3 py-1 text-sm tabular transition-colors ${selectedRoomId === r.id ? 'border-steel bg-steel text-white' : 'border-ink-600 bg-ink-900 text-ink-400 hover:border-steel hover:text-steel'}`}
                  >
                    {r.room_number}
                  </button>
                ))}
              </div>
            </div>
          )}

          {createError && <p className="mb-3 text-sm text-wine">{createError}</p>}

          <button
            onClick={handleCreate}
            disabled={creating || !roomTypeId || !arrivalDate || !departureDate || !guestEmail}
            className="btn-primary"
          >
            {creating ? 'Création…' : 'Confirmer la réservation'}
          </button>
        </div>
      )}

      {actionError && <p className="mb-4 text-sm text-wine">{actionError}</p>}

      <div className="panel overflow-x-auto">
        <table className="data-table min-w-[820px]">
        <thead>
          <tr>
            <th>Confirmation</th>
            <th>Client</th>
            <th>Chambre</th>
            <th>Arrivée</th>
            <th>Départ</th>
            <th>Statut</th>
            <th className="text-right">Montant</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {reservations.map((r) => (
            <tr key={r.id}>
              <td className="tabular whitespace-nowrap text-ink-400">{r.confirmation_number}</td>
              <td>
                <div className="text-parchment">
                  {r.guests?.first_name} {r.guests?.last_name}
                </div>
                <VipBadge tier={r.guests?.vip_tier ?? 'none'} />
              </td>
              <td className="text-ink-400">
                <span className="font-medium text-parchment tabular">{r.rooms?.room_number ?? '—'}</span>
                <span className="block text-xs">{r.room_types?.name}</span>
              </td>
              <td className="tabular">{formatDate(r.arrival_date)}</td>
              <td className="tabular">{formatDate(r.departure_date)}</td>
              <td>
                <StatusBadge status={r.status} />
              </td>
              <td className="num font-medium text-parchment">
                {formatCurrency(r.total_amount, r.currency_code)}
              </td>
              <td>
                <div className="flex gap-1">
                  {(r.status === 'tentative' || r.status === 'confirmed') && (
                    <>
                      <button disabled={busyId === r.id} onClick={() => handleAction(r.id, 'check-in')} className="row-action text-steel hover:bg-steel-tint">
                        Check-in
                      </button>
                      <button disabled={busyId === r.id} onClick={() => handleAction(r.id, 'cancel')} className="row-action text-wine hover:bg-wine-tint">
                        Annuler
                      </button>
                    </>
                  )}
                  {r.status === 'checked_in' && (
                    <>
                      <button disabled={busyId === r.id} onClick={() => handleAction(r.id, 'check-out')} className="row-action text-steel hover:bg-steel-tint">
                        Check-out
                      </button>
                      <button onClick={() => setOpenFolioFor(r.id)} className="row-action text-ink-400 hover:bg-ink-800 hover:text-parchment">
                        Folio
                      </button>
                    </>
                  )}
                  {r.status === 'checked_out' && (
                    <button onClick={() => setOpenFolioFor(r.id)} className="row-action text-ink-400 hover:bg-ink-800 hover:text-parchment">
                      Folio
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      {openFolioFor && <FolioPanel reservationId={openFolioFor} onClose={() => { setOpenFolioFor(null); load(); }} />}
    </div>
  );
}
