import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSessionFromRequest, hasPermission } from '@/lib/session';
import { AUTO_CHECK_IN_FROM_HOUR } from '@/lib/autoCheckIn';

/** Lecture (reservations.manage) et reglage (admin.full) du check-in automatique quotidien de l'hotel. */
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !hasPermission(session, 'reservations.manage')) return NextResponse.json({ error: 'Permission "reservations.manage" requise' }, { status: 403 });
  const { data } = await getSupabaseAdmin().from('hotels').select('auto_check_in_enabled').eq('id', session.hotelId).single();
  return NextResponse.json({ enabled: Boolean(data?.auto_check_in_enabled), fromHour: AUTO_CHECK_IN_FROM_HOUR, canChange: hasPermission(session, 'admin.full') });
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !hasPermission(session, 'admin.full')) return NextResponse.json({ error: 'Permission "admin.full" requise' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  if (typeof body?.enabled !== 'boolean') return NextResponse.json({ error: 'enabled (booléen) requis' }, { status: 400 });
  const { error } = await getSupabaseAdmin().from('hotels').update({ auto_check_in_enabled: body.enabled, updated_at: new Date().toISOString() }).eq('id', session.hotelId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  console.log(`[settings] ${session.email} a ${body.enabled ? 'activé' : 'désactivé'} le check-in automatique`);
  return NextResponse.json({ enabled: body.enabled });
}
