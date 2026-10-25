import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSessionFromRequest, hasPermission } from '@/lib/session';
import { fetchAllPages } from '@/lib/dbPaging';
import { buildReceivables, tagInvoices, type OpenInvoice } from '@/lib/receivables';

/** Creances clients (factures non soldees) : synthese par anciennete et par client ; avec ?client=, le detail des factures d'un client. */
export async function GET(req: NextRequest) {
  const hotelId = req.nextUrl.searchParams.get('hotelId');
  if (!hotelId) return NextResponse.json({ error: 'hotelId requis' }, { status: 400 });
  const session = await getSessionFromRequest(req);
  if (!session || session.hotelId !== hotelId) return NextResponse.json({ error: 'Accès refusé à cet hôtel' }, { status: 403 });
  if (!hasPermission(session, 'finance.manage')) return NextResponse.json({ error: 'Permission "finance.manage" requise' }, { status: 403 });

  const today = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
  const client = req.nextUrl.searchParams.get('client');
  const supabase = getSupabaseAdmin();

  try {
    // Toutes les factures de l'hotel : l'etiquette « a rapprocher » depend des numeros en double et des paiements proches du meme client.
    const all = await fetchAllPages<OpenInvoice>((x, y) => supabase.from('invoices')
      .select('invoice_number, partner_name, invoice_date, due_date, amount_ttc, payment_status')
      .eq('hotel_id', hotelId).order('invoice_date').order('id').range(x, y));
    const tagged = tagInvoices(all.map((i) => ({ ...i, amount_ttc: Number(i.amount_ttc) })));
    const open = tagged.filter((i) => (i.payment_status === 'unpaid' || i.payment_status === 'partial') && (!client || i.partner_name === client));
    if (client) return NextResponse.json({ today, client, invoices: open });
    return NextResponse.json(buildReceivables(open, today));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erreur de lecture des créances' }, { status: 500 });
  }
}
