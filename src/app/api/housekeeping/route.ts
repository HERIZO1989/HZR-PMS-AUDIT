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

/**
 * BUG-08 - Utilise desormais advance_housekeeping_task (fonction SQL transactionnelle)
 * qui synchronise rooms.status quand une tache de nettoyage/turnover passe a 'verified',
 * au lieu de ne mettre a jour que la table housekeeping_tasks.
 */
export async function PATCH(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasPermission(session, 'housekeeping.manage')) {
    return NextResponse.json({ error: 'Permission "housekeeping.manage" requise' }, { status: 403 });
  }

  const { id, status } = await req.json();
  if (!id || !status) return NextResponse.json({ error: 'id et status requis' }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc('advance_housekeeping_task', {
    p_task_id: id,
    p_hotel_id: session!.hotelId,
    p_new_status: status,
    p_staff_user_id: session!.staffUserId,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 422 });
  return NextResponse.json({ task: data });
}
