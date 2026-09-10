import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSessionFromRequest } from '@/lib/session';

export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get('tenantId');
  if (!tenantId) return NextResponse.json({ error: 'tenantId requis' }, { status: 400 });

  const session = await getSessionFromRequest(req);
  if (!session || session.tenantId !== tenantId) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('guests')
    .select('id, first_name, last_name, email, phone, vip_tier, loyalty_number, is_blacklisted, nationality')
    .eq('tenant_id', tenantId)
    .order('vip_tier', { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ guests: data });
}
