import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSessionFromRequest } from '@/lib/session';
import { isPlatformAdmin } from '@/lib/platformAdmin';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** DELETE : supprime un hotel de demonstration. La base refuse tout tenant qui n'est pas marque is_demo (jamais un vrai etablissement). */
export async function DELETE(req: NextRequest, { params }: { params: { tenantId: string } }) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  if (!isPlatformAdmin(session)) return NextResponse.json({ error: 'Réservé à l’administrateur de la plateforme' }, { status: 403 });
  if (!UUID_RE.test(params.tenantId)) return NextResponse.json({ error: 'Identifiant invalide' }, { status: 400 });
  if (params.tenantId === session.tenantId) return NextResponse.json({ error: 'Vous ne pouvez pas supprimer votre propre établissement' }, { status: 400 });

  const { error } = await getSupabaseAdmin().rpc('delete_demo_tenant', { p_tenant_id: params.tenantId });
  if (error) {
    const refused = error.message.includes('Suppression refusée') || error.message.includes('Suppression refusee');
    return NextResponse.json({ error: error.message }, { status: refused ? 403 : 500 });
  }
  console.log(`[demo-hotels] ${session.email} a supprimé l'hôtel de démo ${params.tenantId}`);
  return NextResponse.json({ ok: true });
}
