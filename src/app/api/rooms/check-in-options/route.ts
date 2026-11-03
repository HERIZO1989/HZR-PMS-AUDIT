import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSessionFromRequest, hasPermission } from '@/lib/session';

/** Chambres proposables pour un check-in fait a la main : propres (« vacant_clean »), avec leur type, classees par type puis numero. */
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !hasPermission(session, 'reservations.manage')) {
    return NextResponse.json({ error: 'Permission "reservations.manage" requise' }, { status: 403 });
  }
  const { data, error } = await getSupabaseAdmin()
    .from('rooms')
    .select('id, room_number, room_type_id, room_types(name)')
    .eq('hotel_id', session.hotelId).eq('status', 'vacant_clean')
    .order('room_number');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rooms = (data ?? []).map((r) => {
    const t = Array.isArray(r.room_types) ? r.room_types[0] : r.room_types;
    return { id: r.id as string, roomNumber: r.room_number as string, roomTypeId: r.room_type_id as string | null, typeName: (t?.name as string | undefined) ?? 'Sans type' };
  }).sort((a, b) => a.typeName.localeCompare(b.typeName, 'fr') || a.roomNumber.localeCompare(b.roomNumber, 'fr', { numeric: true }));
  return NextResponse.json({ rooms });
}
