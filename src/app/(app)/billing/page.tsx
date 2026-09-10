import { redirect } from 'next/navigation';
import { getSession, hasPermission } from '@/lib/session';
import { BillingClient } from '@/components/BillingClient';

export default async function BillingPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  return <BillingClient isAdmin={hasPermission(session, 'admin.full')} />;
}
