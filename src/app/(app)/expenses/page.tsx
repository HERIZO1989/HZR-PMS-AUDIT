import { ExpensesClient } from '@/components/ExpensesClient';
import { getSession } from '@/lib/session';
import { getHotelBrand } from '@/lib/supabaseAdmin';
import { redirect } from 'next/navigation';

export default async function ExpensesPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  const { currencyCode } = await getHotelBrand(session.hotelId);
  return <ExpensesClient hotelId={session.hotelId} currencyCode={currencyCode} />;
}
