'use client';

import { useRouter } from 'next/navigation';

export function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <button
      onClick={handleLogout}
      className="rounded border border-white/20 px-3 py-1.5 text-xs text-white/80 transition-colors hover:border-white/50 hover:text-white"
    >
      Se déconnecter
    </button>
  );
}
