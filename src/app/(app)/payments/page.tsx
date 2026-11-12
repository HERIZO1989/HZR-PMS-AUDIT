import { PaymentsClient } from '@/components/PaymentsClient';
import { getSession } from '@/lib/session';
import { getHotelBrand } from '@/lib/supabaseAdmin';
import { redirect } from 'next/navigation';

export default async function PaymentsPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  const { currencyCode } = await getHotelBrand(session.hotelId);
  return <PaymentsClient hotelId={session.hotelId} currencyCode={currencyCode} />;
}
