import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSessionFromRequest, hasPermission } from '@/lib/session';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Annule un import termine : supprime les reservations importees auxquelles rien ne s'est rattache depuis (folio, sejour...)
 * et les clients crees par le lot qui n'ont plus aucune reservation. Les reservations deja utilisees sont conservees et comptees.
 */
export async function POST(req: NextRequest, { params }: { params: { batchId: string } }) {
  const session = await getSessionFromRequest(req);
  if (!hasPermission(session, 'reservations.manage')) {
    return NextResponse.json({ error: 'Permission "reservations.manage" requise' }, { status: 403 });
  }
  if (!UUID_RE.test(params.batchId)) return NextResponse.json({ error: 'Identifiant invalide' }, { status: 400 });

  const { data, error } = await getSupabaseAdmin().rpc('rollback_import_batch', {
    p_batch_id: params.batchId,
    p_hotel_id: session!.hotelId,
  });
  if (error || !data?.[0]) {
    const known = /introuvable|termine|deja ete annule/.test(error?.message ?? '');
    return NextResponse.json({ error: error?.message ?? 'Annulation impossible' }, { status: known ? 409 : 500 });
  }
  console.log(`[imports] ${session!.email} a annulé le lot ${params.batchId} : ${data[0].reservations_deleted} supprimées, ${data[0].reservations_kept} conservées`);
  return NextResponse.json({
    reservationsDeleted: data[0].reservations_deleted,
    reservationsKept: data[0].reservations_kept,
    guestsDeleted: data[0].guests_deleted,
  });
}
