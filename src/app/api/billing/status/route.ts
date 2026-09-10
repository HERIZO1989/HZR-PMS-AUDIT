import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSessionFromRequest } from '@/lib/session';

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const supabase = getSupabaseAdmin();

  const [{ data: subscription }, { data: plans }, { count: hotelCount }] = await Promise.all([
    supabase
      .from('subscriptions')
      .select('plan_code, status, current_period_end, cancel_at_period_end, trial_end')
      .eq('tenant_id', session.tenantId)
      .maybeSingle(),
    supabase.from('billing_plans').select('*').order('sort_order', { ascending: true }),
    supabase.from('hotels').select('*', { count: 'exact', head: true }).eq('tenant_id', session.tenantId),
  ]);

  const currentPlan = plans?.find((p) => p.code === subscription?.plan_code) ?? null;

  let roomCount = 0;
  if (currentPlan) {
    const { count } = await supabase
      .from('rooms')
      .select('*, hotels!inner(tenant_id)', { count: 'exact', head: true })
      .eq('hotels.tenant_id', session.tenantId);
    roomCount = count ?? 0;
  }

  return NextResponse.json({
    subscription,
    plans,
    usage: { hotels: hotelCount ?? 0, rooms: roomCount },
  });
}
