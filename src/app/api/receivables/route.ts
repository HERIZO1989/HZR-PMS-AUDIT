import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSessionFromRequest, hasPermission } from '@/lib/session';
import { fetchAllPages } from '@/lib/dbPaging';
import { buildReceivables, type OpenInvoice } from '@/lib/receivables';

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
    const invoices = await fetchAllPages<OpenInvoice>((a, b) => {
      let q = supabase.from('invoices')
        .select('invoice_number, partner_name, invoice_date, due_date, amount_ttc, payment_status')
        .eq('hotel_id', hotelId).in('payment_status', ['unpaid', 'partial']);
      if (client) q = q.eq('partner_name', client);
      return q.order('invoice_date').order('id').range(a, b);
    });
    const open = invoices.map((i) => ({ ...i, amount_ttc: Number(i.amount_ttc) }));
    if (client) return NextResponse.json({ today, client, invoices: open });
    return NextResponse.json(buildReceivables(open, today));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erreur de lecture des créances' }, { status: 500 });
  }
}
