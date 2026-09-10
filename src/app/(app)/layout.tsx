import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/Sidebar';
import { getSession } from '@/lib/session';
import { LogoutButton } from '@/components/LogoutButton';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1">
        <header className="flex items-center justify-end gap-4 border-b border-ink-700 px-10 py-3 text-sm">
          <span className="text-ink-400">{session.displayName}</span>
          <LogoutButton />
        </header>
        <main className="px-10 py-8">{children}</main>
      </div>
    </div>
  );
}
