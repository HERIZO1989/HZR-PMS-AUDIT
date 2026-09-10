import { HousekeepingClient } from '@/components/HousekeepingClient';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';

export default async function HousekeepingPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  return <HousekeepingClient hotelId={session.hotelId} />;
}
