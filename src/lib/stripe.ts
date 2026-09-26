import Stripe from 'stripe';

let cached: Stripe | null = null;

export function getStripe(): Stripe {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY manquant dans les variables d\'environnement');

  // BUG-22 - Empeche de facturer un vrai client par erreur depuis un environnement
  // de demo/test : une cle sk_live_ ne doit etre utilisee qu'en production explicite.
  const isLiveKey = key.startsWith('sk_live_');
  const isProdEnv = process.env.NODE_ENV === 'production' && process.env.STRIPE_ALLOW_LIVE === 'true';
  if (isLiveKey && !isProdEnv) {
    throw new Error(
      'Cle Stripe live (sk_live_) detectee en dehors d\'un environnement de production autorise. ' +
      'Definir STRIPE_ALLOW_LIVE=true explicitement pour confirmer un usage en production reelle.'
    );
  }

  cached = new Stripe(key, { apiVersion: '2024-06-20' });
  return cached;
}
