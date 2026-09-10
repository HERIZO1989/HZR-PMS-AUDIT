import Stripe from 'stripe';

let cached: Stripe | null = null;

export function getStripe(): Stripe {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY manquant dans les variables d\'environnement');
  cached = new Stripe(key, { apiVersion: '2024-06-20' });
  return cached;
}
