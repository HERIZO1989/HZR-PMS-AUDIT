import { describe, expect, it } from 'vitest';
import { classifyStay, groupOf, summarizeCash, summarizeStays, type StayInput } from '../src/lib/paymentsOverview';

const DATE = '2026-11-10';
const stay = (over: Partial<StayInput> = {}): StayInput => ({
  reservationId: 'r1', confirmationNumber: 'B1', guest: 'A', room: '101', status: 'checked_in', arrivalDate: '2026-11-08', departureDate: '2026-11-12',
  totalAmount: 400000, hasFolio: true, charges: 240000, paid: 0, depositsHeld: 0, depositsApplied: 0, ...over,
});

describe('statut de paiement d’un séjour', () => {
  it('avec folio : payé, partiel ou non payé selon le solde', () => {
    expect(classifyStay(stay({ paid: 240000 }), DATE)).toMatchObject({ payStatus: 'paid', balance: 0 });
    expect(classifyStay(stay({ paid: 100000 }), DATE)).toMatchObject({ payStatus: 'partial', balance: 140000, received: 100000 });
    expect(classifyStay(stay({ paid: 0 }), DATE)).toMatchObject({ payStatus: 'unpaid', balance: 240000 });
  });
  it('un reste inférieur à 1 Ar est un solde, un trop-perçu n’est pas un reste à payer', () => {
    expect(classifyStay(stay({ charges: 100000.4, paid: 100000 }), DATE).payStatus).toBe('paid');
    const over = classifyStay(stay({ paid: 300000 }), DATE);
    expect(over.payStatus).toBe('paid');
    expect(over.balance).toBe(-60000);
  });
  it('folio ouvert mais rien de facturé : à facturer (la nuitée n’est pas encore posée)', () => {
    expect(classifyStay(stay({ charges: 0, paid: 50000 }), DATE).payStatus).toBe('to_bill');
  });
  it('avant le check-in : le montant du séjour est comparé aux acomptes reçus', () => {
    const a = { hasFolio: false, charges: 0, paid: 0, status: 'confirmed', arrivalDate: DATE, room: null };
    expect(classifyStay(stay({ ...a, totalAmount: 400000, depositsHeld: 100000 }), DATE)).toMatchObject({ payStatus: 'partial', due: 400000, received: 100000, balance: 300000, deposit: 100000, group: 'arrival' });
    expect(classifyStay(stay({ ...a, totalAmount: 400000, depositsHeld: 400000 }), DATE).payStatus).toBe('paid');
    expect(classifyStay(stay({ ...a, totalAmount: 400000 }), DATE).payStatus).toBe('unpaid');
  });
  it('l’acompte reporté au check-in est déjà dans les paiements du folio : il compte une seule fois', () => {
    const r = classifyStay(stay({ paid: 100000, depositsApplied: 100000 }), DATE);
    expect(r).toMatchObject({ received: 100000, deposit: 100000, balance: 140000, payStatus: 'partial' });
  });
  it('arrivée, départ ou séjour en cours selon la date', () => {
    expect(groupOf({ arrivalDate: DATE, departureDate: '2026-11-12' }, DATE)).toBe('arrival');
    expect(groupOf({ arrivalDate: '2026-11-08', departureDate: DATE }, DATE)).toBe('departure');
    expect(groupOf({ arrivalDate: '2026-11-08', departureDate: '2026-11-12' }, DATE)).toBe('inhouse');
  });
});

describe('synthèse et caisse du jour', () => {
  it('compte par statut et totalise le reste à encaisser sans les trop-perçus', () => {
    const rows = [classifyStay(stay({ paid: 240000 }), DATE), classifyStay(stay({ paid: 100000, depositsApplied: 100000 }), DATE), classifyStay(stay({ paid: 0 }), DATE), classifyStay(stay({ paid: 300000 }), DATE), classifyStay(stay({ charges: 0 }), DATE)];
    const s = summarizeStays(rows);
    expect(s.count).toBe(5);
    expect(Object.fromEntries(Object.entries(s.byStatus).map(([k, v]) => [k, v.count]))).toEqual({ paid: 2, partial: 1, unpaid: 1, to_bill: 1 });
    expect(s.balance).toBe(140000 + 240000);
    expect(s.deposits).toBe(100000);
  });
  it('la caisse compte les paiements du jour et les acomptes reçus ce jour, jamais l’acompte reporté au check-in', () => {
    const local = (iso: string) => new Date(new Date(iso).getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10);
    const c = summarizeCash(
      [
        { method: 'cash', amount: 100000, reference: null, at: '2026-11-10T05:00:00Z' },
        { method: 'card', amount: 50000, reference: null, at: '2026-11-10T20:30:00Z' },          // 23:30 locale : encore le 10
        { method: 'cash', amount: 70000, reference: 'ACOMPTE B1', at: '2026-11-10T06:00:00Z' },    // report d'acompte : ignoré
        { method: 'cash', amount: 999, reference: null, at: '2026-11-09T05:00:00Z' },               // hier
        { method: 'cash', amount: 888, reference: null, at: '2026-11-10T21:30:00Z' },               // 00:30 locale le 11 : demain
      ],
      [{ method: 'cash', amount: 30000, at: '2026-11-10T08:00:00Z' }, { method: 'online', amount: 5, at: '2026-11-08T08:00:00Z' }], DATE, local);
    expect(c.payments).toEqual({ count: 2, amount: 150000 });
    expect(c.deposits).toEqual({ count: 1, amount: 30000 });
    expect(c.total).toBe(180000);
    expect(c.byMethod).toEqual([{ method: 'cash', count: 2, amount: 130000 }, { method: 'card', count: 1, amount: 50000 }]);
  });
});
