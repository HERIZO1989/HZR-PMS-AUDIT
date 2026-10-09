import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/Sidebar';
import { getSession } from '@/lib/session';
import { isPlatformAdmin } from '@/lib/platformAdmin';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  return (
    <div className="min-h-screen bg-ink-800">
      <Sidebar displayName={session.displayName} showDemo={isPlatformAdmin(session)} />
      <main className="mx-auto max-w-[1360px] px-6 py-8">{children}</main>
    </div>
  );
}
