import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSessionFromRequest, hasPermission } from '@/lib/session';

/** PARTIE A — Modification (uniquement avant check-in, applique par update_reservation). */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSessionFromRequest(req);
  if (!hasPermission(session, 'reservations.manage')) {
    return NextResponse.json({ error: 'Permission "reservations.manage" requise' }, { status: 403 });
  }

  const body = await req.json();
  const { arrivalDate, departureDate, assignedRoomId, adults, children, specialRequests } = body ?? {};

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc('update_reservation', {
    p_reservation_id: params.id,
    p_hotel_id: session!.hotelId,
    p_arrival_date: arrivalDate ?? null,
    p_departure_date: departureDate ?? null,
    p_assigned_room_id: assignedRoomId ?? null,
    p_adults: adults ?? null,
    p_children: children ?? null,
    p_special_requests: specialRequests ?? null,
    p_updated_by: session!.staffUserId,
  });

  if (error) {
    const status = error.code === '23P01' ? 409 : 422;
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json({ reservation: data });
}
