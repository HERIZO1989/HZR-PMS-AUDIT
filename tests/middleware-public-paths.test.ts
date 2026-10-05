import { describe, it, expect, vi } from 'vitest';

// Le middleware n'atteint la session que pour les chemins proteges : ici aucun cookie, donc jamais de session valide.
vi.mock('@/lib/session', () => ({
  SESSION_COOKIE: 'session',
  verifySessionToken: async () => null,
  isSessionRevoked: async () => false,
}));

import { NextRequest } from 'next/server';
import { middleware } from '../src/middleware';

const call = (path: string) => middleware(new NextRequest(new URL(`https://app.test${path}`), { method: 'POST' }));

describe('Middleware : chemins publics et protection par session', () => {
  it("laisse passer /api/cron/audit-alerts sans cookie (la route verifie CRON_SECRET)", async () => {
    const res = await call('/api/cron/audit-alerts');
    expect(res.status).not.toBe(401);
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  it('laisse passer le webhook Stripe et la sante', async () => {
    expect((await call('/api/billing/webhook')).headers.get('x-middleware-next')).toBe('1');
    expect((await call('/api/health')).headers.get('x-middleware-next')).toBe('1');
  });

  it('bloque toujours les routes metier sans session', async () => {
    for (const p of ['/api/reservations', '/api/night-audit/report', '/api/cronjob', '/api/imports']) {
      const res = await call(p);
      expect(res.status, p).toBe(401);
    }
  });
});
