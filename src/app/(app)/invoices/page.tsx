import { InvoicesClient } from '@/components/InvoicesClient';
import { getSession, hasPermission } from '@/lib/session';
import { getHotelBrand } from '@/lib/supabaseAdmin';
import { redirect } from 'next/navigation';

export default async function InvoicesPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  const { currencyCode } = await getHotelBrand(session.hotelId);
  return <InvoicesClient hotelId={session.hotelId} currencyCode={currencyCode} canManage={hasPermission(session, 'finance.manage')} />;
}
