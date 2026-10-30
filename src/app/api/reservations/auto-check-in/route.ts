import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSessionFromRequest, hasPermission } from '@/lib/session';
import { localDateHour, runAutoCheckIn } from '@/lib/autoCheckIn';

/** Check-in immediat de toutes les arrivees du jour (ou d'une date donnee), chambres choisies automatiquement. */
export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !hasPermission(session, 'reservations.manage')) {
    return NextResponse.json({ error: 'Permission "reservations.manage" requise' }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const supabase = getSupabaseAdmin();
  const { data: hotel } = await supabase.from('hotels').select('timezone').eq('id', session.hotelId).single();
  const today = localDateHour(new Date(), hotel?.timezone ?? 'UTC').date;
  const date = typeof body?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : today;
  if (date > today) return NextResponse.json({ error: 'Impossible d’enregistrer des arrivées futures' }, { status: 400 });
  try {
    return NextResponse.json(await runAutoCheckIn(supabase, session.hotelId, date, session.staffUserId));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erreur du check-in automatique' }, { status: 500 });
  }
}
