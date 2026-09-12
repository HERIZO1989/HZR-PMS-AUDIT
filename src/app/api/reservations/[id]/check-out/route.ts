import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSessionFromRequest, hasPermission } from '@/lib/session';

/** PARTIE B — Check-out transactionnel (libere la chambre en 'vacant_dirty', cree la tache housekeeping). */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSessionFromRequest(req);
  if (!hasPermission(session, 'reservations.manage')) {
    return NextResponse.json({ error: 'Permission "reservations.manage" requise' }, { status: 403 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc('check_out_reservation', {
    p_reservation_id: params.id,
    p_hotel_id: session!.hotelId,
    p_staff_user_id: session!.staffUserId,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 422 });
  return NextResponse.json({ reservation: data });
}
