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

  const { hotelId, action, businessDate } = await req.json();
  if (!hotelId || hotelId !== session!.hotelId) {
    return NextResponse.json({ error: 'hotelId invalide' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // Poste les nuitees (charges chambre) des clients en sejour pour une date d'exploitation.
  // Idempotent : relancer la meme date ne cree aucun doublon.
  if (action === 'post_room_charges') {
    if (typeof businessDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(businessDate) || Number.isNaN(Date.parse(businessDate))) {
      return NextResponse.json({ error: 'businessDate invalide (format AAAA-MM-JJ)' }, { status: 400 });
    }
    const dayMs = 86400000;
    const delta = (Date.parse(businessDate) - Date.parse(new Date().toISOString().slice(0, 10))) / dayMs;
    if (delta > 1 || delta < -31) {
      return NextResponse.json({ error: 'businessDate hors plage (31 jours passes, lendemain au plus)' }, { status: 400 });
    }
    const { data, error } = await supabase.rpc('post_room_charges', {
      p_hotel_id: hotelId,
      p_business_date: businessDate,
      p_staff_user_id: session!.staffUserId,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ result: data?.[0] ?? null });
  }

  const { data, error } = await supabase.rpc('run_hotel_audit', {
    p_hotel_id: hotelId,
    p_start_date: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
    p_end_date: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ summary: data?.[0] ?? null });
}
