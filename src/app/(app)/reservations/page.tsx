import { ReservationsClient } from '@/components/ReservationsClient';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';

export default async function ReservationsPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  return <ReservationsClient hotelId={session.hotelId} />;
}
