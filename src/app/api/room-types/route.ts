import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSessionFromRequest } from '@/lib/session';

export async function GET(req: NextRequest) {
  const hotelId = req.nextUrl.searchParams.get('hotelId');
  if (!hotelId) return NextResponse.json({ error: 'hotelId requis' }, { status: 400 });

  const session = await getSessionFromRequest(req);
  if (!session || session.hotelId !== hotelId) {
    return NextResponse.json({ error: 'Accès refusé à cet hôtel' }, { status: 403 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('room_types')
    .select('id, name, base_rate')
    .eq('hotel_id', hotelId)
    .eq('status', 'active')
    .order('base_rate', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ roomTypes: data });
}
