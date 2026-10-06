'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tenantCode, setTenantCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, tenantCode: tenantCode.trim() || undefined }),
    });

    setLoading(false);
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? 'Échec de la connexion');
      return;
    }

    router.push(params.get('next') ?? '/dashboard');
    router.refresh();
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      {/* Panneau de marque : visible des l'ecran large, sobre, un seul filet laiton */}
      <aside className="relative hidden flex-col justify-between bg-navy p-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded border border-brass bg-navy-deep font-display text-lg text-brass-light">
            P
          </span>
          <span className="font-display text-xl tracking-tight">PMS Audit</span>
        </div>

        <div>
          <div className="mb-6 h-0.5 w-12 bg-brass" />
          <h1 className="max-w-md font-display text-4xl leading-tight tracking-tight">
            La gestion de l'hôtel et le contrôle de la nuit, au même endroit.
          </h1>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/70">
            Réservations, folios, housekeeping et Night Audit, avec des indicateurs d'occupation, d'ADR et de RevPAR toujours à jour.
          </p>
        </div>

        <p className="text-xs text-white/50">Nyarotiko Consulting</p>
      </aside>

      <main className="flex items-center justify-center bg-ink-900 px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded border border-brass bg-navy font-display text-lg text-brass-light">
                P
              </span>
              <span className="font-display text-xl tracking-tight text-parchment">PMS Audit</span>
            </div>
          </div>

          <h2 className="font-display text-3xl tracking-tight text-parchment">Connexion</h2>
          <p className="mt-1 text-sm text-ink-400">Accédez à l'espace de votre établissement.</p>

          <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-5">
            <div>
              <label htmlFor="email" className="field-label">Adresse e-mail</label>
              <input
                id="email"
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="field"
              />
            </div>
            <div>
              <label htmlFor="password" className="field-label">Mot de passe</label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="field"
              />
            </div>
            <div>
              <label htmlFor="tenantCode" className="field-label">Code établissement (facultatif)</label>
              <input
                id="tenantCode"
                type="text"
                value={tenantCode}
                onChange={(e) => setTenantCode(e.target.value)}
                placeholder="Ex. ANJARY, si demandé"
                autoCapitalize="characters"
                className="field"
              />
            </div>

            {error && (
              <p role="alert" className="rounded-sm bg-wine-tint px-3 py-2 text-sm text-wine">
                {error}
              </p>
            )}

            <button type="submit" disabled={loading} className="btn-primary mt-1 w-full py-2.5">
              {loading ? 'Connexion…' : 'Se connecter'}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
