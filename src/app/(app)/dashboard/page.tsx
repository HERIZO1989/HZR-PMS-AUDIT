import { DashboardClient } from '@/components/DashboardClient';
import { getSession } from '@/lib/session';
import { getHotelBrand } from '@/lib/supabaseAdmin';
import { redirect } from 'next/navigation';

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  const { name, currencyCode } = await getHotelBrand(session.hotelId);
  return <DashboardClient hotelId={session.hotelId} hotelName={name} currencyCode={currencyCode} />;
}
