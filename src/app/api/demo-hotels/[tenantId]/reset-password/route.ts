import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSessionFromRequest } from '@/lib/session';
import { isPlatformAdmin } from '@/lib/platformAdmin';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** POST : nouveau mot de passe pour les comptes d'un hotel de demonstration (affiche une seule fois). Refuse tout tenant non marque demo. */
export async function POST(req: NextRequest, { params }: { params: { tenantId: string } }) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  if (!isPlatformAdmin(session)) return NextResponse.json({ error: 'Réservé à l’administrateur de la plateforme' }, { status: 403 });
  if (!UUID_RE.test(params.tenantId)) return NextResponse.json({ error: 'Identifiant invalide' }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: password, error } = await supabase.rpc('reset_demo_password', { p_tenant_id: params.tenantId });
  if (error || !password) {
    const refused = error?.message?.includes('refusee') || error?.message?.includes('refusée');
    return NextResponse.json({ error: error?.message ?? 'Réinitialisation impossible' }, { status: refused ? 403 : 500 });
  }
  const { data: tenant } = await supabase.from('tenants').select('code').eq('id', params.tenantId).single();
  console.log(`[demo-hotels] ${session.email} a réinitialisé le mot de passe de l'hôtel de démo ${tenant?.code}`);
  return NextResponse.json({ tenantCode: tenant?.code ?? null, password });
}
