'use client';

import { useEffect, useState } from 'react';
import { formatCurrency, formatDate } from '@/lib/formatters';

interface FolioLine {
  id: string;
  line_type: string;
  description: string;
  quantity: number;
  amount: number;
  posted_at: string;
}
interface Payment {
  id: string;
  method: string;
  amount: number;
  status: string;
  processed_at: string;
}
interface Folio {
  id: string;
  folio_number: string;
  status: string;
  balance: number;
  currency_code: string;
}

const LINE_TYPE_LABELS: Record<string, string> = {
  room_charge: 'Chambre',
  tax: 'Taxe',
  service: 'Service',
  discount: 'Remise',
  adjustment: 'Ajustement',
};

export function FolioPanel({ reservationId, onClose }: { reservationId: string; onClose: () => void }) {
  const [folio, setFolio] = useState<Folio | null>(null);
  const [lines, setLines] = useState<FolioLine[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [lineDescription, setLineDescription] = useState('');
  const [lineAmount, setLineAmount] = useState('');
  const [lineType, setLineType] = useState('service');
  const [addingLine, setAddingLine] = useState(false);

  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('card');
  const [payingNow, setPayingNow] = useState(false);
  // Cle d'idempotence stable pour cette tentative de paiement : generee une fois,
  // reutilisee si l'utilisateur reclique suite a une erreur reseau (evite le double paiement).
  const [paymentIdempotencyKey, setPaymentIdempotencyKey] = useState(() => crypto.randomUUID());

  function load() {
    setLoading(true);
    fetch(`/api/folios?reservationId=${reservationId}`)
      .then((r) => r.json())
      .then((d) => {
        setFolio(d.folio);
        setLines(d.lines ?? []);
        setPayments(d.payments ?? []);
      })
      .finally(() => setLoading(false));
  }

  useEffect(load, [reservationId]);

  async function handleAddLine() {
    if (!folio || !lineDescription || !lineAmount) return;
    setAddingLine(true);
    setError(null);
    const res = await fetch(`/api/folios/${folio.id}/lines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lineType, description: lineDescription, amount: Number(lineAmount) }),
    });
    const data = await res.json();
    setAddingLine(false);
    if (!res.ok) return setError(data.error);
    setLineDescription('');
    setLineAmount('');
    load();
  }

  async function handlePayment() {
    if (!folio || !paymentAmount) return;
    setPayingNow(true);
    setError(null);
    const res = await fetch(`/api/folios/${folio.id}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: Number(paymentAmount), method: paymentMethod, idempotencyKey: paymentIdempotencyKey }),
    });
    const data = await res.json();
    setPayingNow(false);
    if (!res.ok) return setError(data.error);
    setPaymentAmount('');
    setPaymentIdempotencyKey(crypto.randomUUID()); // nouvelle cle pour le prochain paiement distinct
    load();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto border border-ink-700 bg-white p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg text-parchment">Folio</h2>
          <button onClick={onClose} className="text-ink-400 hover:text-parchment">
            Fermer
          </button>
        </div>

        {loading ? (
          <p className="text-ink-400">Chargement…</p>
        ) : !folio ? (
          <p className="text-ink-400">Aucun folio — le client doit d'abord être check-in.</p>
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between border-b border-ink-700 pb-3">
              <span className="text-sm text-ink-400">{folio.folio_number}</span>
              <span className={`text-sm ${folio.status === 'closed' ? 'text-moss' : 'text-ochre'}`}>
                {folio.status === 'closed' ? 'Soldé' : 'Ouvert'}
              </span>
            </div>

            <table className="mb-4 w-full text-sm">
              <tbody className="divide-y divide-ink-700">
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td className="py-1.5 text-ink-400">{formatDate(l.posted_at)}</td>
                    <td className="py-1.5">{l.description}</td>
                    <td className="py-1.5 text-right tabular">{formatCurrency(l.amount * l.quantity, folio.currency_code)}</td>
                  </tr>
                ))}
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="py-1.5 text-ink-400">{formatDate(p.processed_at)}</td>
                    <td className="py-1.5 text-moss">Paiement ({p.method})</td>
                    <td className="py-1.5 text-right tabular text-moss">-{formatCurrency(p.amount, folio.currency_code)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mb-6 flex items-center justify-between border-t border-ink-700 pt-3">
              <span className="font-medium text-parchment">Solde</span>
              <span className="tabular text-lg font-medium text-parchment">{formatCurrency(folio.balance, folio.currency_code)}</span>
            </div>

            {error && <p className="mb-4 text-sm text-wine">{error}</p>}

            {folio.status === 'open' && (
              <div className="flex flex-col gap-4">
                <div className="border border-ink-700 p-3">
                  <div className="mb-2 text-xs text-ink-400">Ajouter une prestation</div>
                  <div className="flex gap-2">
                    <select value={lineType} onChange={(e) => setLineType(e.target.value)} className="border border-ink-600 bg-white px-2 py-1 text-sm">
                      <option value="service">Service</option>
                      <option value="room_charge">Chambre</option>
                      <option value="tax">Taxe</option>
                      <option value="adjustment">Ajustement</option>
                    </select>
                    <input
                      placeholder="Description"
                      value={lineDescription}
                      onChange={(e) => setLineDescription(e.target.value)}
                      className="flex-1 border border-ink-600 bg-white px-2 py-1 text-sm"
                    />
                    <input
                      type="number"
                      placeholder="Montant"
                      value={lineAmount}
                      onChange={(e) => setLineAmount(e.target.value)}
                      className="w-24 border border-ink-600 bg-white px-2 py-1 text-sm"
                    />
                    <button
                      onClick={handleAddLine}
                      disabled={addingLine}
                      className="border border-brass-dim px-3 text-sm text-brass hover:bg-brass hover:text-white disabled:opacity-50"
                    >
                      +
                    </button>
                  </div>
                </div>

                <div className="border border-ink-700 p-3">
                  <div className="mb-2 text-xs text-ink-400">Enregistrer un paiement</div>
                  <div className="flex gap-2">
                    <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="border border-ink-600 bg-white px-2 py-1 text-sm">
                      <option value="card">Carte</option>
                      <option value="cash">Espèces</option>
                      <option value="bank_transfer">Virement</option>
                    </select>
                    <input
                      type="number"
                      placeholder="Montant"
                      value={paymentAmount}
                      onChange={(e) => setPaymentAmount(e.target.value)}
                      className="flex-1 border border-ink-600 bg-white px-2 py-1 text-sm"
                    />
                    <button
                      onClick={handlePayment}
                      disabled={payingNow}
                      className="border border-brass-dim px-3 text-sm text-brass hover:bg-brass hover:text-white disabled:opacity-50"
                    >
                      Encaisser
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
