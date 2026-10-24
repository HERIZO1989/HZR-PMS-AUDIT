import { AuditClient } from '@/components/AuditClient';
import { getSession } from '@/lib/session';
import { getHotelBrand } from '@/lib/supabaseAdmin';
import { redirect } from 'next/navigation';

export default async function AuditPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  const { currencyCode } = await getHotelBrand(session.hotelId);
  return <AuditClient hotelId={session.hotelId} currencyCode={currencyCode} />;
}
