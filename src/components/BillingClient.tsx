'use client';

import { useEffect, useState } from 'react';

interface Plan {
  code: string;
  name: string;
  price_monthly_cents: number | null;
  max_hotels: number | null;
  max_rooms: number | null;
  features: string[];
}

interface Subscription {
  plan_code: string;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  trial_end: string | null;
}

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  trialing: { label: 'Essai en cours', className: 'bg-steel-tint text-steel-dim' },
  active: { label: 'Actif', className: 'bg-moss-tint text-moss' },
  past_due: { label: 'Paiement en retard', className: 'bg-ochre-tint text-ochre' },
  canceled: { label: 'Résilié', className: 'bg-wine-tint text-wine' },
  incomplete: { label: 'Incomplet', className: 'bg-ochre-tint text-ochre' },
  unpaid: { label: 'Impayé', className: 'bg-wine-tint text-wine' },
};

function formatPrice(cents: number | null): string {
  if (cents === null) return 'Sur devis';
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(cents / 100) + ' / mois';
}

export function BillingClient({ isAdmin }: { isAdmin: boolean }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [usage, setUsage] = useState({ hotels: 0, rooms: 0 });
  const [loading, setLoading] = useState(true);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    fetch('/api/billing/status')
      .then((r) => r.json())
      .then((d) => {
        setPlans(d.plans ?? []);
        setSubscription(d.subscription ?? null);
        setUsage(d.usage ?? { hotels: 0, rooms: 0 });
      })
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleSubscribe(planCode: string) {
    setBusyPlan(planCode);
    setError(null);
    const res = await fetch('/api/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planCode }),
    });
    const data = await res.json();
    setBusyPlan(null);
    if (!res.ok) return setError(data.error);
    window.location.href = data.url;
  }

  async function handleManage() {
    setError(null);
    const res = await fetch('/api/billing/portal', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) return setError(data.error);
    window.location.href = data.url;
  }

  if (loading) return <div className="text-ink-400">Chargement…</div>;

  const status = subscription ? STATUS_LABELS[subscription.status] : null;
  const currentPlan = plans.find((p) => p.code === subscription?.plan_code);

  return (
    <div className="max-w-4xl">
      <header className="mb-6">
        <h1 className="page-title">Facturation</h1>
        <p className="page-subtitle">Abonnement, usage et plans</p>
      </header>

      {error && <p role="alert" className="mb-6 rounded-sm bg-wine-tint px-4 py-3 text-sm text-wine">{error}</p>}

      {subscription && currentPlan && (
        <section className="panel mb-6 p-5">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="font-display text-2xl tracking-tight text-parchment">{currentPlan.name}</span>
              {status && (
                <span className={`rounded-sm px-2 py-0.5 text-xs font-medium ${status.className}`}>{status.label}</span>
              )}
            </div>
            {isAdmin && (
              <button
                onClick={handleManage}
                className="btn-secondary btn-sm"
              >
                Gérer l'abonnement
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-6 border-t border-ink-700 pt-4 text-sm">
            <div>
              <div className="text-ink-400">Hôtels</div>
              <div className="tabular mt-1 text-lg font-medium text-parchment">
                {usage.hotels} / {currentPlan.max_hotels ?? '∞'}
              </div>
            </div>
            <div>
              <div className="text-ink-400">Chambres</div>
              <div className="tabular mt-1 text-lg font-medium text-parchment">
                {usage.rooms} / {currentPlan.max_rooms ?? '∞'}
              </div>
            </div>
          </div>

          {subscription.current_period_end && (
            <p className="mt-4 text-xs text-ink-400">
              {subscription.cancel_at_period_end ? 'Se termine le ' : 'Prochain renouvellement le '}
              {new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' }).format(new Date(subscription.current_period_end))}
            </p>
          )}
        </section>
      )}

      <section>
        <h2 className="mb-4 text-base font-semibold text-parchment">Plans disponibles</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {plans.map((plan) => (
            <div
              key={plan.code}
              className={`panel flex flex-col p-5 ${plan.code === subscription?.plan_code ? 'border-t-2 border-t-brass' : ''}`}
            >
              <div className="text-base font-semibold text-parchment">{plan.name}</div>
              <div className="tabular mt-1 font-display text-3xl tracking-tight text-parchment">{formatPrice(plan.price_monthly_cents)}</div>
              <ul className="mt-4 flex-1 space-y-1.5 text-sm text-ink-400">
                {plan.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-steel" />
                    {f}
                  </li>
                ))}
              </ul>
              {isAdmin && plan.code !== subscription?.plan_code && (
                <button
                  onClick={() => handleSubscribe(plan.code)}
                  disabled={busyPlan === plan.code}
                  className="btn-secondary mt-6 w-full"
                >
                  {plan.price_monthly_cents === null
                    ? 'Nous contacter'
                    : busyPlan === plan.code
                      ? 'Redirection…'
                      : 'Choisir ce plan'}
                </button>
              )}
              {plan.code === subscription?.plan_code && (
                <div className="mt-6 rounded-sm bg-moss-tint py-2 text-center text-sm font-medium text-moss">Plan actuel</div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
