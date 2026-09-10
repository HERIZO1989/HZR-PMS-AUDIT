import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSessionFromRequest, hasPermission } from '@/lib/session';

export async function GET(req: NextRequest) {
  const hotelId = req.nextUrl.searchParams.get('hotelId');
  if (!hotelId) return NextResponse.json({ error: 'hotelId requis' }, { status: 400 });

  const session = await getSessionFromRequest(req);
  if (!session || session.hotelId !== hotelId) {
    return NextResponse.json({ error: 'Acces refuse a cet hotel' }, { status: 403 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('night_audit_runs')
    .select(
      `id, business_date, status, started_at, completed_at, summary,
       staff_users ( display_name ),
       night_audit_checks ( id, check_type, status, details )`
    )
    .eq('hotel_id', hotelId)
    .order('business_date', { ascending: false })
    .limit(30);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ runs: data });
}

/** Declenche un nouveau cycle : recalcule les KPI puis regenere les findings d'audit ouverts. */
export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasPermission(session, 'night_audit.run')) {
    return NextResponse.json({ error: 'Permission "night_audit.run" requise' }, { status: 403 });
  }

  const { hotelId } = await req.json();
  if (!hotelId || hotelId !== session!.hotelId) {
    return NextResponse.json({ error: 'hotelId invalide' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc('run_hotel_audit', {
    p_hotel_id: hotelId,
    p_start_date: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
    p_end_date: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ summary: data?.[0] ?? null });
}
