import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSessionFromRequest, hasPermission } from '@/lib/session';

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

/** BUG-13 - Creation manuelle d'un client, independamment d'une reservation. */
export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasPermission(session, 'reservations.manage')) {
    return NextResponse.json({ error: 'Permission "reservations.manage" requise' }, { status: 403 });
  }

  const { firstName, lastName, email, phone, nationality, vipTier } = await req.json();
  if (!firstName || !lastName) {
    return NextResponse.json({ error: 'firstName et lastName requis' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  if (email) {
    const { data: existing } = await supabase
      .from('guests')
      .select('id')
      .eq('tenant_id', session!.tenantId)
      .ilike('email', email)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ error: 'Un client avec cet email existe déjà' }, { status: 409 });
    }
  }

  const { data, error } = await supabase
    .from('guests')
    .insert({
      tenant_id: session!.tenantId,
      first_name: firstName,
      last_name: lastName,
      email: email || null,
      phone: phone || null,
      nationality: nationality || null,
      vip_tier: vipTier || 'none',
      gdpr_consent_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 422 });
  return NextResponse.json({ guest: data }, { status: 201 });
}
