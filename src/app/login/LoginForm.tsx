'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('gm@demo.local');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
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
    <div className="flex min-h-screen items-center justify-center bg-ink-900 px-6">
      <div className="w-full max-w-sm">
        <div className="mb-12 text-center">
          <div className="font-display text-4xl italic text-parchment">PMS Audit</div>
          <div className="mt-2 text-[11px] tracking-wide text-ink-400">Gestion hôtelière</div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5 border-t-2 border-brass bg-ink-800/60 p-7">
          <div>
            <label className="mb-1.5 block text-xs text-ink-400">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-ink-600 bg-ink-900 px-3 py-2.5 text-sm text-parchment transition-colors focus:border-brass focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs text-ink-400">Mot de passe</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-ink-600 bg-ink-900 px-3 py-2.5 text-sm text-parchment transition-colors focus:border-brass focus:outline-none"
            />
          </div>

          {error && <p className="text-sm text-wine">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="mt-1 border border-brass bg-brass py-2.5 text-sm font-medium text-white transition-colors hover:bg-brass-dim disabled:opacity-50"
          >
            {loading ? 'Connexion…' : 'Se connecter'}
          </button>
        </form>

        <p className="mt-5 text-center text-xs text-ink-400">
          Compte de démo : gm@demo.local — mot de passe Demo1234!
        </p>
      </div>
    </div>
  );
}
