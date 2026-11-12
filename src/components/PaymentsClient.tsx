'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatCurrency, formatDate } from '@/lib/formatters';
import { FolioPanel } from '@/components/FolioPanel';
import { DepositPanel } from '@/components/DepositPanel';
import { PAY_STATUS_LABEL, type CashSummary, type OverviewSummary, type PayStatus, type StayGroup, type StayPayment } from '@/lib/paymentsOverview';

interface Overview { date: string; today: string; generatedAt: string; rows: StayPayment[]; summary: OverviewSummary; cash: CashSummary; paymentsRecordedEver: number }

const REFRESH_MS = 30_000;
const GROUPS: { code: StayGroup | 'all'; label: string }[] = [
  { code: 'all', label: 'Tous' }, { code: 'arrival', label: 'Arrivées' }, { code: 'inhouse', label: 'En séjour' }, { code: 'departure', label: 'Départs' },
];
const STATUS_STYLE: Record<PayStatus, string> = {
  paid: 'bg-emerald-100 text-emerald-800', partial: 'bg-amber-100 text-amber-800', unpaid: 'bg-red-100 text-red-800', to_bill: 'bg-gray-100 text-gray-700',
};
const METHOD_LABEL: Record<string, string> = { cash: 'Espèces', card: 'Carte', bank_transfer: 'Virement', online: 'Mobile money / en ligne', voucher: 'Bon', other: 'Autre' };
const GROUP_LABEL: Record<StayGroup, string> = { arrival: 'Arrivée', inhouse: 'En séjour', departure: 'Départ' };
const todayLocal = () => new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);

/** Onglet « Paiements du jour » : qui a paye, qui reste a payer, qui a verse un acompte, caisse du jour. Rafraichi toutes les 30 secondes pour le jour courant. */
export function PaymentsClient({ hotelId, currencyCode }: { hotelId: string; currencyCode: string }) {
  const [date, setDate] = useState(todayLocal());
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState<StayGroup | 'all'>('all');
  const [status, setStatus] = useState<PayStatus | 'all'>('all');
  const [q, setQ] = useState('');
  const [folioFor, setFolioFor] = useState<string | null>(null);
  const [depositFor, setDepositFor] = useState<string | null>(null);
  const money = (n: number) => formatCurrency(n, currencyCode);

  const load = useCallback(async () => {
    const res = await fetch(`/api/payments/overview?hotelId=${hotelId}&date=${date}`);
    const json = await res.json();
    if (!res.ok) return setError(json.error ?? 'Échec du chargement');
    setError(null); setData(json);
  }, [hotelId, date]);

  useEffect(() => {
    void load();
    if (date !== todayLocal()) return;
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, REFRESH_MS);
    return () => clearInterval(t);
  }, [load, date]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.rows ?? []).filter((r) => (group === 'all' || r.group === group) && (status === 'all' || r.payStatus === status)
      && (!needle || r.guest.toLowerCase().includes(needle) || r.confirmationNumber.toLowerCase().includes(needle) || (r.room ?? '').includes(needle)));
  }, [data, group, status, q]);

  const s = data?.summary;
  const nothingToday = data && data.cash.total === 0;

  return (
    <div className="max-w-6xl">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Paiements du jour</h1>
          <p className="page-subtitle">Payé, partiel, non payé et acomptes · actualisé {data ? new Date(data.generatedAt).toLocaleTimeString('fr-FR') : '…'}{date === todayLocal() ? ' (toutes les 30 s)' : ''}</p>
        </div>
        <div className="flex items-end gap-3">
          <div><label htmlFor="pay-date" className="field-label">Jour</label><input id="pay-date" type="date" value={date} max={todayLocal()} onChange={(e) => e.target.value && setDate(e.target.value)} className="field" /></div>
          <button onClick={() => void load()} className="btn-secondary btn-sm">Actualiser</button>
        </div>
      </header>

      {error && <p role="alert" className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {nothingToday && (
        <p role="status" className="mb-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Aucun encaissement n&apos;est enregistré dans le PMS le {formatDate(date)} ({data.paymentsRecordedEver} paiement(s) enregistré(s) au total). Cet onglet ne montre que ce qui est saisi : pour qu&apos;il reflète la caisse en temps réel, enregistrez chaque paiement avec <b>Paiement</b> (bouton <b>Folio</b>) et chaque acompte avec <b>Acompte</b>. Les règlements faits dans Odoo n&apos;y apparaissent pas.
        </p>
      )}

      {data && s && (
        <>
          <section aria-label="Synthèse" className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="panel p-4"><p className="field-label">Caisse du jour</p><p className="text-xl font-semibold tabular">{money(data.cash.total)}</p><p className="text-xs text-black/60">dont acomptes {money(data.cash.deposits.amount)}</p></div>
            <div className="panel p-4"><p className="field-label">Payés</p><p className="text-xl font-semibold tabular text-emerald-700">{s.byStatus.paid.count}</p><p className="text-xs text-black/60">sur {s.count} séjours</p></div>
            <div className="panel p-4"><p className="field-label">Partiels</p><p className="text-xl font-semibold tabular text-amber-700">{s.byStatus.partial.count}</p><p className="text-xs text-black/60">reste {money(s.byStatus.partial.balance)}</p></div>
            <div className="panel p-4"><p className="field-label">Non payés</p><p className="text-xl font-semibold tabular text-red-700">{s.byStatus.unpaid.count}</p><p className="text-xs text-black/60">reste {money(s.byStatus.unpaid.balance)}</p></div>
            <div className="panel p-4"><p className="field-label">Reste à encaisser</p><p className="text-xl font-semibold tabular">{money(s.balance)}</p><p className="text-xs text-black/60">acomptes versés {money(s.deposits)}</p></div>
          </section>

          {data.cash.byMethod.length > 0 && (
            <p className="mb-4 text-sm text-black/70">Encaissé le {formatDate(date)} : {data.cash.byMethod.map((m) => `${METHOD_LABEL[m.method] ?? m.method} ${money(m.amount)} (${m.count})`).join(' · ')}</p>
          )}

          <section aria-label="Séjours" className="panel p-5">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div className="flex flex-wrap gap-2" role="tablist" aria-label="Groupe">
                {GROUPS.map((g) => <button key={g.code} role="tab" aria-selected={group === g.code} onClick={() => setGroup(g.code)} className={`rounded px-3 py-1.5 text-sm ${group === g.code ? 'bg-brass text-ink-900' : 'border border-black/15 text-black/70'}`}>{g.label}</button>)}
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div><label htmlFor="pay-q" className="field-label">Client, n° ou chambre</label><input id="pay-q" value={q} maxLength={60} onChange={(e) => setQ(e.target.value)} className="field" /></div>
                <div><label htmlFor="pay-status" className="field-label">Statut</label>
                  <select id="pay-status" value={status} onChange={(e) => setStatus(e.target.value as PayStatus | 'all')} className="field">
                    <option value="all">Tous</option>
                    {(Object.keys(PAY_STATUS_LABEL) as PayStatus[]).map((k) => <option key={k} value={k}>{PAY_STATUS_LABEL[k]}</option>)}
                  </select></div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead><tr className="border-b border-black/10 text-xs uppercase tracking-wide text-black/60">
                  <th className="py-2 pr-3">Client</th><th className="pr-3">Ch.</th><th className="pr-3">Séjour</th><th className="pr-3 text-right">À payer</th><th className="pr-3 text-right">Encaissé</th><th className="pr-3 text-right">Acompte</th><th className="pr-3 text-right">Solde</th><th className="pr-3">Statut</th><th />
                </tr></thead>
                <tbody>
                  {rows.slice(0, 300).map((r) => (
                    <tr key={r.reservationId} className="border-b border-black/5">
                      <td className="py-2 pr-3">{r.guest}<span className="block text-xs text-black/50 tabular">{r.confirmationNumber} · {GROUP_LABEL[r.group]}</span></td>
                      <td className="pr-3 tabular">{r.room ?? '—'}</td>
                      <td className="pr-3 whitespace-nowrap text-xs">{formatDate(r.arrivalDate)} → {formatDate(r.departureDate)}</td>
                      <td className="pr-3 text-right tabular">{money(r.due)}</td>
                      <td className="pr-3 text-right tabular">{money(r.received)}</td>
                      <td className="pr-3 text-right tabular">{r.deposit > 0 ? money(r.deposit) : '—'}</td>
                      <td className={`pr-3 text-right tabular ${r.balance > 0 ? 'text-red-700' : ''}`}>{money(Math.max(0, r.balance))}</td>
                      <td className="pr-3"><span className={`rounded px-2 py-0.5 text-xs ${STATUS_STYLE[r.payStatus]}`}>{PAY_STATUS_LABEL[r.payStatus]}</span></td>
                      <td className="whitespace-nowrap text-right">
                        {r.hasFolio ? <button onClick={() => setFolioFor(r.reservationId)} className="row-action">Paiement</button>
                          : (r.status === 'confirmed' || r.status === 'tentative') && <button onClick={() => setDepositFor(r.reservationId)} className="row-action">Acompte</button>}
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && <tr><td colSpan={9} className="py-6 text-center text-black/60">Aucun séjour pour ce filtre.</td></tr>}
                </tbody>
              </table>
            </div>
            {rows.length > 300 && <p className="mt-3 text-xs text-black/60">300 séjours affichés sur {rows.length} : affinez par groupe, statut ou recherche.</p>}
            <p className="mt-3 text-xs text-black/60">« À payer » : total facturé sur le folio, ou montant du séjour tant que le client n&apos;est pas enregistré. « À facturer » : la nuitée n&apos;est pas encore posée (facturation de nuit vers 03 h). Un solde négatif (trop-perçu) n&apos;est pas compté dans le reste à encaisser.</p>
          </section>
        </>
      )}

      {folioFor && <FolioPanel reservationId={folioFor} onClose={() => { setFolioFor(null); void load(); }} />}
      {depositFor && <DepositPanel reservationId={depositFor} onClose={() => { setDepositFor(null); void load(); }} />}
    </div>
  );
}
