import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { ImportService } from '@/lib/import/importService';
import { getSessionFromRequest, hasPermission } from '@/lib/session';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { batchId: string } }) {
  const session = await getSessionFromRequest(req);
  if (!hasPermission(session, 'reservations.manage')) {
    return NextResponse.json({ error: 'Permission "reservations.manage" requise' }, { status: 403 });
  }

  const supabase = getSupabaseAdmin();

  const { data: batch } = await supabase
    .from('import_batches')
    .select('hotel_id')
    .eq('id', params.batchId)
    .single();
  if (!batch || batch.hotel_id !== session!.hotelId) {
    return NextResponse.json({ error: 'Lot introuvable pour cet hotel' }, { status: 404 });
  }

  const service = new ImportService(supabase);

  try {
    const summary = await service.applyBatch(params.batchId);
    return NextResponse.json(summary);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
