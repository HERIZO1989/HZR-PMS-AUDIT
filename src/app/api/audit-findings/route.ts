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
    .from('audit_findings')
    .select('id, business_date, category, severity, title, description, recommendation, status')
    .eq('hotel_id', hotelId)
    .eq('status', 'open')
    .order('severity', { ascending: true })
    .order('business_date', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ findings: data });
}

export async function PATCH(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasPermission(session, 'finance.manage')) {
    return NextResponse.json({ error: 'Permission "finance.manage" requise' }, { status: 403 });
  }

  const { id, status } = await req.json();
  if (!id || !status) return NextResponse.json({ error: 'id et status requis' }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: finding } = await supabase.from('audit_findings').select('hotel_id').eq('id', id).single();
  if (!finding || finding.hotel_id !== session!.hotelId) {
    return NextResponse.json({ error: 'Constat introuvable pour cet hotel' }, { status: 404 });
  }

  const { error } = await supabase
    .from('audit_findings')
    .update({ status, resolved_at: ['resolved', 'dismissed'].includes(status) ? new Date().toISOString() : null })
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
