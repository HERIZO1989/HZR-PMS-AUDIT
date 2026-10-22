import { describe, expect, it } from 'vitest';
import { localDate, summarizeDeposits, validateDeposit, type DepositLite } from '../src/lib/deposits';

describe('validation de la saisie d’un acompte', () => {
  it('accepte un montant (virgule décimale ou espaces) et un mode connu', () => {
    expect(validateDeposit({ amount: '1 250,50', method: 'cash', reference: '  MM-7781 ' })).toEqual({ ok: true, value: { amount: 1250.5, method: 'cash', reference: 'MM-7781' } });
    expect(validateDeposit({ amount: 50000, method: 'online' })).toEqual({ ok: true, value: { amount: 50000, method: 'online', reference: null } });
  });
  it('refuse un montant nul, négatif ou illisible et un mode inconnu', () => {
    for (const amount of [0, -5, 'abc', '', undefined]) expect(validateDeposit({ amount, method: 'cash' }).ok).toBe(false);
    const bad = validateDeposit({ amount: 10, method: 'bitcoin' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors).toEqual(['Mode de paiement invalide']);
  });
});

describe('synthèse des acomptes', () => {
  const dep = (amount: number, status: DepositLite['status'], received_at: string, reservation_status: string | null, resolved_at: string | null = null): DepositLite =>
    ({ amount, status, received_at, resolved_at, reservation_status });
  const rows = [
    dep(100000, 'held', '2026-10-19T08:00:00Z', 'confirmed'),
    dep(50000, 'held', '2026-10-05T10:00:00Z', 'tentative'),
    dep(80000, 'held', '2026-09-20T10:00:00Z', 'cancelled'),
    dep(30000, 'held', '2026-09-21T10:00:00Z', 'no_show'),
    dep(70000, 'held', '2026-10-10T10:00:00Z', 'checked_in'),
    dep(200000, 'applied', '2026-03-01T10:00:00Z', 'checked_out', '2026-03-10T10:00:00Z'),
    dep(60000, 'refunded', '2026-02-01T10:00:00Z', 'cancelled', '2026-02-05T10:00:00Z'),
    dep(40000, 'forfeited', '2026-04-01T10:00:00Z', 'cancelled', '2026-04-02T10:00:00Z'),
    dep(9999, 'held', '2026-10-25T10:00:00Z', 'confirmed'),
    dep(11111, 'refunded', '2025-12-01T10:00:00Z', 'cancelled', '2025-12-05T10:00:00Z'),
  ];
  const s = summarizeDeposits(rows, '2026-10-19');

  it('compte les acomptes reçus du jour, du mois et de l’année (dates futures exclues)', () => {
    expect(s.received.day).toEqual({ count: 1, amount: 100000 });
    expect(s.received.month).toEqual({ count: 3, amount: 220000 });
    expect(s.received.year).toEqual({ count: 8, amount: 630000 });
  });
  it('sépare en attente d’arrivée, à traiter après annulation et à reporter sur un folio', () => {
    expect(s.held).toEqual({ count: 3, amount: 159999 });
    expect(s.toResolve).toEqual({ count: 2, amount: 110000 });
    expect(s.toApply).toEqual({ count: 1, amount: 70000 });
  });
  it('totalise les remboursés et conservés de l’année seulement', () => {
    expect(s.refundedYear).toEqual({ count: 1, amount: 60000 });
    expect(s.forfeitedYear).toEqual({ count: 1, amount: 40000 });
  });
  it('lit la date à l’heure de Madagascar (UTC+3), pas en UTC', () => {
    expect(localDate('2026-10-19T22:30:00Z')).toBe('2026-10-20');
    expect(localDate('2026-10-19T20:59:00Z')).toBe('2026-10-19');
  });
});
