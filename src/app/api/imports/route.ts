import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { ImportService } from '@/lib/import/importService';
import { getSessionFromRequest } from '@/lib/session';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const hotelId = req.nextUrl.searchParams.get('hotelId');
  if (!hotelId) return NextResponse.json({ error: 'hotelId requis' }, { status: 400 });

  const session = await getSessionFromRequest(req);
  if (!session || session.hotelId !== hotelId) {
    return NextResponse.json({ error: 'Accès refusé à cet hôtel' }, { status: 403 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('import_batches')
    .select('id, file_name, source_system, status, total_rows, valid_rows, error_rows, created_at')
    .eq('hotel_id', hotelId)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ batches: data });
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  const hotelId = formData.get('hotelId') as string | null;
  const tenantId = formData.get('tenantId') as string | null;
  const sourceSystem = (formData.get('sourceSystem') as string | null) ?? 'generic_csv';
  const targetEntityType = (formData.get('targetEntityType') as 'guest' | 'reservation' | null) ?? 'reservation';

  if (!file || !hotelId || !tenantId) {
    return NextResponse.json({ error: 'file, hotelId et tenantId sont requis' }, { status: 400 });
  }

  const session = await getSessionFromRequest(req);
  if (!session || session.hotelId !== hotelId || session.tenantId !== tenantId) {
    return NextResponse.json({ error: 'Accès refusé à cet hôtel' }, { status: 403 });
  }

  const fileType = (file.name.split('.').pop()?.toLowerCase() ?? 'csv') as 'csv' | 'txt' | 'xlsx' | 'xls';
  const supabase = getSupabaseAdmin();
  const service = new ImportService(supabase);

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const content = fileType === 'xlsx' || fileType === 'xls' ? buffer : buffer.toString('utf-8');

    const { batchId, results } = await service.stageImport({
      ctx: { tenantId, hotelId, uploadedBy: session.staffUserId },
      fileName: file.name,
      fileType,
      sourceSystem: sourceSystem as any,
      content,
      targetEntityType,
    });

    return NextResponse.json({
      batchId,
      totalRows: results.length,
      validRows: results.filter((r) => r.status === 'valid').length,
      invalidRows: results.filter((r) => r.status === 'invalid').length,
      preview: results.slice(0, 15),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 422 });
  }
}
