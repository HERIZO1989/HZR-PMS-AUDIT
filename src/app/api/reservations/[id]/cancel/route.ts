import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSessionFromRequest, hasPermission } from '@/lib/session';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSessionFromRequest(req);
  if (!hasPermission(session, 'reservations.manage')) {
    return NextResponse.json({ error: 'Permission "reservations.manage" requise' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc('cancel_reservation', {
    p_reservation_id: params.id,
    p_hotel_id: session!.hotelId,
    p_reason: body?.reason ?? null,
    p_cancelled_by: session!.staffUserId,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 422 });
  return NextResponse.json({ reservation: data });
}
