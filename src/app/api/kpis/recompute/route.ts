import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSessionFromRequest, hasPermission } from '@/lib/session';
import { resolveKpiRange } from '@/lib/kpiRange';

/** Recalcule les indicateurs journaliers (occupation, ADR, RevPAR, revenu) sur une plage : utile apres un import ou une correction de statuts. N'ecrit que dans kpi_daily_snapshots. */
export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !hasPermission(session, 'finance.manage')) {
    return NextResponse.json({ error: 'Permission "finance.manage" requise' }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const today = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
  const range = resolveKpiRange(body?.from, body?.to, today);
  if (!range.ok) return NextResponse.json({ error: range.error }, { status: 400 });

  const { data, error } = await getSupabaseAdmin().rpc('compute_kpi_snapshots', {
    p_hotel_id: session.hotelId, p_start_date: range.from, p_end_date: range.to,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  console.log(`[kpis] ${session.email} a recalculé les indicateurs du ${range.from} au ${range.to} (${data} jours)`);
  return NextResponse.json({ from: range.from, to: range.to, days: Number(data ?? 0) });
}
