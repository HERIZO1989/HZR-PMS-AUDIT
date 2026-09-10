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
    .from('housekeeping_tasks')
    .select(
      `id, task_type, status, priority, scheduled_for, notes,
       rooms ( room_number, floor ),
       staff_users ( display_name )`
    )
    .eq('hotel_id', hotelId)
    .order('priority', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tasks: data });
}

export async function PATCH(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasPermission(session, 'housekeeping.manage')) {
    return NextResponse.json({ error: 'Permission "housekeeping.manage" requise' }, { status: 403 });
  }

  const { id, status } = await req.json();
  if (!id || !status) return NextResponse.json({ error: 'id et status requis' }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: task } = await supabase.from('housekeeping_tasks').select('hotel_id').eq('id', id).single();
  if (!task || task.hotel_id !== session!.hotelId) {
    return NextResponse.json({ error: 'Tache introuvable pour cet hotel' }, { status: 404 });
  }

  const patch: Record<string, unknown> = { status };
  if (status === 'in_progress') patch.started_at = new Date().toISOString();
  if (status === 'completed' || status === 'verified') patch.completed_at = new Date().toISOString();

  const { error } = await supabase.from('housekeeping_tasks').update(patch).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
