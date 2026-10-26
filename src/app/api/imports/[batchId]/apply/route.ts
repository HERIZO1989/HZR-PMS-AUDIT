import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { ImportService } from '@/lib/import/importService';
import { getSessionFromRequest, hasPermission } from '@/lib/session';
import { fetchAllPages } from '@/lib/dbPaging';
import { rangeFromStays } from '@/lib/kpiRange';

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

    // Les indicateurs ne se recalculaient que par la routine de nuit : un import d'historique restait invisible dans le tableau de bord.
    // On recalcule la plage des sejours importes. Un echec ne remet pas en cause l'import : le bouton « Recalculer les indicateurs » prend le relais.
    let kpi: { from: string; to: string; days: number } | null = null;
    let kpiError: string | null = null;
    if (summary.imported > 0) {
      try {
        const today = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
        const rows = await fetchAllPages<{ normalized_data: { arrival_date?: string; departure_date?: string } | null }>((a, b) => supabase
          .from('import_rows').select('normalized_data').eq('import_batch_id', params.batchId).eq('status', 'imported').order('id').range(a, b));
        const range = rangeFromStays(rows.map((r) => ({ arrival_date: r.normalized_data?.arrival_date ?? '', departure_date: r.normalized_data?.departure_date ?? '' })), today);
        if (range) {
          const { data, error } = await supabase.rpc('compute_kpi_snapshots', { p_hotel_id: session!.hotelId, p_start_date: range.from, p_end_date: range.to });
          if (error) throw new Error(error.message);
          kpi = { ...range, days: Number(data ?? 0) };
        }
      } catch (e) {
        kpiError = e instanceof Error ? e.message : 'Recalcul des indicateurs impossible';
      }
    }
    return NextResponse.json({ ...summary, kpi, ...(kpiError ? { kpiError } : {}) });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
