import { describe, it, expect, vi, beforeEach } from 'vitest';

const send = vi.fn();
vi.mock('resend', () => ({ Resend: class { emails = { send }; } }));

import { sendCriticalAlertDigest } from '../src/lib/email';

const items = [{ title: 'T', description: 'd', businessDate: '2026-09-30', recommendation: null }];

describe("Envoi du digest d'alertes (un e-mail par destinataire)", () => {
  beforeEach(() => { send.mockReset(); process.env.RESEND_API_KEY = 'test'; });

  it('sert les destinataires autorises meme si un autre est refuse (sandbox)', async () => {
    send.mockImplementation(async ({ to }: { to: string[] }) =>
      to[0] === 'owner@x.mg' ? { data: { id: '1' }, error: null } : { data: null, error: { message: 'only your own email' } });
    const ok = await sendCriticalAlertDigest({ to: ['gm@x.mg', 'owner@x.mg'], hotelName: 'H', items });
    expect(ok).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.every((c) => c[0].to.length === 1)).toBe(true);
  });

  it('retourne false si personne ne peut etre servi', async () => {
    send.mockResolvedValue({ data: null, error: { message: 'refused' } });
    expect(await sendCriticalAlertDigest({ to: ['a@x.mg', 'b@x.mg'], hotelName: 'H', items })).toBe(false);
  });

  it('retourne false si une exception est levee, sans la propager', async () => {
    send.mockRejectedValue(new Error('network'));
    expect(await sendCriticalAlertDigest({ to: ['a@x.mg'], hotelName: 'H', items })).toBe(false);
  });

  it('retourne false sans cle Resend', async () => {
    delete process.env.RESEND_API_KEY;
    expect(await sendCriticalAlertDigest({ to: ['a@x.mg'], hotelName: 'H', items })).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});
