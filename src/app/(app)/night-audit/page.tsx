import { NightAuditClient } from '@/components/NightAuditClient';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';

export default async function NightAuditPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  return <NightAuditClient hotelId={session.hotelId} />;
}
