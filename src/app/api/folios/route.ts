import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSessionFromRequest } from '@/lib/session';

export async function GET(req: NextRequest) {
  const reservationId = req.nextUrl.searchParams.get('reservationId');
  if (!reservationId) return NextResponse.json({ error: 'reservationId requis' }, { status: 400 });

  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const supabase = getSupabaseAdmin();

  const { data: folio, error: folioError } = await supabase
    .from('folios')
    .select('id, folio_number, status, balance, currency_code, hotel_id')
    .eq('reservation_id', reservationId)
    .maybeSingle();

  if (folioError) return NextResponse.json({ error: folioError.message }, { status: 500 });
  if (!folio) return NextResponse.json({ folio: null, lines: [], payments: [] });

  if (folio.hotel_id !== session.hotelId) {
    return NextResponse.json({ error: 'Accès refusé à cet hôtel' }, { status: 403 });
  }

  const [{ data: lines, error: linesError }, { data: payments, error: paymentsError }] = await Promise.all([
    supabase
      .from('folio_lines')
      .select('id, line_type, description, quantity, amount, posted_at')
      .eq('folio_id', folio.id)
      .order('posted_at', { ascending: true }),
    supabase
      .from('payments')
      .select('id, method, amount, status, processed_at')
      .eq('folio_id', folio.id)
      .order('processed_at', { ascending: true }),
  ]);

  if (linesError) return NextResponse.json({ error: linesError.message }, { status: 500 });
  if (paymentsError) return NextResponse.json({ error: paymentsError.message }, { status: 500 });

  return NextResponse.json({ folio, lines, payments });
}
