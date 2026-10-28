import { ReportClient } from '@/components/ReportClient';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';

export default async function ReportPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  return <ReportClient hotelId={session.hotelId} />;
}
