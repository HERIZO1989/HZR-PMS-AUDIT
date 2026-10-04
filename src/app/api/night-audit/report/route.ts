import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSessionFromRequest } from '@/lib/session';
import { buildNightAuditReportData, renderNightAuditPdf } from '@/lib/reports/nightAuditReport';

export const runtime = 'nodejs';

/** GET /api/night-audit/report?hotelId=...&date=AAAA-MM-JJ -> PDF du Night Audit de la date d'exploitation. */
export async function GET(req: NextRequest) {
  const hotelId = req.nextUrl.searchParams.get('hotelId');
  const date = req.nextUrl.searchParams.get('date');
  if (!hotelId) return NextResponse.json({ error: 'hotelId requis' }, { status: 400 });
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
    return NextResponse.json({ error: 'date invalide (format AAAA-MM-JJ)' }, { status: 400 });
  }

  const session = await getSessionFromRequest(req);
  if (!session || session.hotelId !== hotelId) {
    return NextResponse.json({ error: 'Acces refuse a cet hotel' }, { status: 403 });
  }

  try {
    const data = await buildNightAuditReportData(getSupabaseAdmin(), hotelId, date);
    const pdf = await renderNightAuditPdf(data);
    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="night-audit-${date}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erreur de génération du rapport' }, { status: 500 });
  }
}
