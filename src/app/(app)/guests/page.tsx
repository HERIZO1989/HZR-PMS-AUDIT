import { GuestsClient } from '@/components/GuestsClient';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';

export default async function GuestsPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  return <GuestsClient tenantId={session.tenantId} />;
}
