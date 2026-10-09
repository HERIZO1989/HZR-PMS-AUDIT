import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { isPlatformAdmin } from '@/lib/platformAdmin';
import { DemoHotelsClient } from '@/components/DemoHotelsClient';

export default async function DemoPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!isPlatformAdmin(session)) redirect('/dashboard');
  return <DemoHotelsClient />;
}
