import { ImportsClient } from '@/components/ImportsClient';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';

export default async function ImportsPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  return <ImportsClient hotelId={session.hotelId} tenantId={session.tenantId} />;
}
