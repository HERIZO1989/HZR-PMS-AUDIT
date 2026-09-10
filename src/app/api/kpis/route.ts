import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSessionFromRequest } from '@/lib/session';

export async function GET(req: NextRequest) {
  const hotelId = req.nextUrl.searchParams.get('hotelId');
  const days = Number(req.nextUrl.searchParams.get('days') ?? 30);
  if (!hotelId) return NextResponse.json({ error: 'hotelId requis' }, { status: 400 });

  const session = await getSessionFromRequest(req);
  if (!session || session.hotelId !== hotelId) {
    return NextResponse.json({ error: 'Accès refusé à cet hôtel' }, { status: 403 });
  }

  const supabase = getSupabaseAdmin();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const { data, error } = await supabase
    .from('kpi_daily_snapshots')
    .select('business_date, occupancy_rate, adr, revpar, rooms_occupied, rooms_available, total_room_revenue')
    .eq('hotel_id', hotelId)
    .gte('business_date', startDate.toISOString().slice(0, 10))
    .order('business_date', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const avg = (key: 'occupancy_rate' | 'adr' | 'revpar') =>
    data.length ? data.reduce((sum, row) => sum + Number(row[key]), 0) / data.length : 0;

  return NextResponse.json({
    series: data,
    averages: {
      occupancy_rate: avg('occupancy_rate'),
      adr: avg('adr'),
      revpar: avg('revpar'),
    },
  });
}
