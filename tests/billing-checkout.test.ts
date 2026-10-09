import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const stripe = { customers: { create: vi.fn() }, checkout: { sessions: { create: vi.fn() } } };
const rows: Record<string, any> = {
  billing_plans: { code: 'pro', name: 'Pro', stripe_price_id: 'price_123' },
  tenants: { name: 'Hôtel Test' },
  subscriptions: { stripe_customer_id: 'cus_1' },
};
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripe }));
vi.mock('@/lib/session', () => ({
  getSessionFromRequest: async () => ({ tenantId: 't1', email: 'a@b.mg', permissions: ['admin.full'] }),
  hasPermission: () => true,
}));
vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({
    from: (t: string) => {
      const q: any = { select: () => q, eq: () => q, single: async () => ({ data: rows[t] }), maybeSingle: async () => ({ data: rows[t] }) };
      return q;
    },
  }),
}));

import { POST } from '../src/app/api/billing/checkout/route';
const call = () => POST(new NextRequest('https://app.test/api/billing/checkout', { method: 'POST', body: JSON.stringify({ planCode: 'pro' }) }));

describe('Paiement Stripe : gestion des erreurs', () => {
  beforeEach(() => { stripe.checkout.sessions.create.mockReset(); stripe.customers.create.mockReset(); vi.spyOn(console, 'error').mockImplementation(() => {}); });

  it("retourne l'URL de paiement quand tout va bien", async () => {
    stripe.checkout.sessions.create.mockResolvedValue({ url: 'https://checkout.stripe.com/x' });
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).url).toBe('https://checkout.stripe.com/x');
  });

  it('explique le code fiscal manquant au lieu de planter', async () => {
    stripe.checkout.sessions.create.mockRejectedValue(new Error("Invalid line_items[0]: the product tax code is missing."));
    const res = await call();
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/code fiscal/);
  });

  it('retourne un message générique pour toute autre erreur Stripe, sans exposer le détail', async () => {
    stripe.checkout.sessions.create.mockRejectedValue(new Error('rate_limit secret_detail'));
    const res = await call();
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/n'a pas pu être initialisé/);
    expect(JSON.stringify(body)).not.toContain('secret_detail');
  });

  it("journalise l'erreur côté serveur", async () => {
    stripe.checkout.sessions.create.mockRejectedValue(new Error('boom'));
    await call();
    expect(console.error).toHaveBeenCalled();
  });
});

import { POST as PORTAL } from '../src/app/api/billing/portal/route';
describe('Portail de facturation : gestion des erreurs', () => {
  it('retourne un message clair au lieu de planter', async () => {
    (stripe as any).billingPortal = { sessions: { create: vi.fn().mockRejectedValue(new Error('detail interne')) } };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await PORTAL(new NextRequest('https://app.test/api/billing/portal', { method: 'POST' }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/portail de facturation/);
    expect(JSON.stringify(body)).not.toContain('detail interne');
  });
});
