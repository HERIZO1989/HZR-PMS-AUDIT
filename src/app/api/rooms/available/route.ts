import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSessionFromRequest } from '@/lib/session';

/**
 * PARTIE A — Disponibilite calculee cote serveur. C'est un helper de confort pour l'UI
 * (afficher les chambres libres) ; la garantie reelle vient de la contrainte EXCLUDE
 * PostgreSQL appliquee dans create_reservation/update_reservation, qui reste la seule
 * source de verite en cas de requetes concurrentes.
 */
export async function GET(req: NextRequest) {
  const hotelId = req.nextUrl.searchParams.get('hotelId');
  const roomTypeId = req.nextUrl.searchParams.get('roomTypeId');
  const arrival = req.nextUrl.searchParams.get('arrival');
  const departure = req.nextUrl.searchParams.get('departure');

  if (!hotelId || !roomTypeId || !arrival || !departure) {
    return NextResponse.json({ error: 'hotelId, roomTypeId, arrival, departure requis' }, { status: 400 });
  }

  const session = await getSessionFromRequest(req);
  if (!session || session.hotelId !== hotelId) {
    return NextResponse.json({ error: 'Accès refusé à cet hôtel' }, { status: 403 });
  }

  const supabase = getSupabaseAdmin();

  const { data: rooms, error: roomsError } = await supabase
    .from('rooms')
    .select('id, room_number, status')
    .eq('hotel_id', hotelId)
    .eq('room_type_id', roomTypeId)
    .neq('status', 'out_of_order');

  if (roomsError) return NextResponse.json({ error: roomsError.message }, { status: 500 });

  const { data: conflicting, error: resError } = await supabase
    .from('reservations')
    .select('assigned_room_id')
    .eq('hotel_id', hotelId)
    .not('status', 'in', '(cancelled,no_show)')
    .not('assigned_room_id', 'is', null)
    .lt('arrival_date', departure)
    .gt('departure_date', arrival);

  if (resError) return NextResponse.json({ error: resError.message }, { status: 500 });

  const busyRoomIds = new Set((conflicting ?? []).map((r) => r.assigned_room_id));
  const availableRooms = (rooms ?? []).filter((r) => !busyRoomIds.has(r.id));

  return NextResponse.json({ availableRooms });
}
