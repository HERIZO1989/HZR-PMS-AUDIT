import { DashboardClient } from '@/components/DashboardClient';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  return <DashboardClient hotelId={session.hotelId} />;
}
