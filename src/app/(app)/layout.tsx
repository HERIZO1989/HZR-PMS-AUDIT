import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/Sidebar';
import { getSession } from '@/lib/session';
import { LogoutButton } from '@/components/LogoutButton';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  return (
    <div className="min-h-screen bg-ink-800">
      <Sidebar />
      <header className="flex items-center justify-end gap-4 border-b border-ink-700 bg-white px-8 py-2 text-sm">
        <span className="text-ink-400">{session.displayName}</span>
        <LogoutButton />
      </header>
      <main className="px-8 py-6">{children}</main>
    </div>
  );
}
