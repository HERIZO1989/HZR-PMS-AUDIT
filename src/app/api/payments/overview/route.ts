import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSessionFromRequest, hasPermission } from '@/lib/session';
import { fetchAllPages } from '@/lib/dbPaging';
import { localDateHour } from '@/lib/autoCheckIn';
import { classifyStay, summarizeCash, summarizeStays, type StayInput } from '@/lib/paymentsOverview';

type Supabase = ReturnType<typeof getSupabaseAdmin>;
const SELECT = 'id, confirmation_number, status, arrival_date, departure_date, total_amount, guests ( first_name, last_name ), rooms ( room_number )';
type ResRow = { id: string; confirmation_number: string; status: string; arrival_date: string; departure_date: string; total_amount: number; guests: { first_name: string | null; last_name: string | null } | { first_name: string | null; last_name: string | null }[] | null; rooms: { room_number: string } | { room_number: string }[] | null };
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);
const chunks = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

/** Paiements du jour en temps reel : statut de paiement des arrivees, des sejours en cours et des departs, avec acomptes, et caisse du jour. Lecture seule. */
export async function GET(req: NextRequest) {
  const hotelId = req.nextUrl.searchParams.get('hotelId');
  if (!hotelId) return NextResponse.json({ error: 'hotelId requis' }, { status: 400 });
  const session = await getSessionFromRequest(req);
  if (!session || session.hotelId !== hotelId) return NextResponse.json({ error: 'Accès refusé à cet hôtel' }, { status: 403 });
  if (!(hasPermission(session, 'reservations.manage') || hasPermission(session, 'finance.manage'))) {
    return NextResponse.json({ error: 'Permission "reservations.manage" ou "finance.manage" requise' }, { status: 403 });
  }

  const supabase: Supabase = getSupabaseAdmin();
  const { data: hotel } = await supabase.from('hotels').select('timezone').eq('id', hotelId).single();
  const tz = hotel?.timezone ?? 'UTC';
  const today = localDateHour(new Date(), tz).date;
  const dateParam = req.nextUrl.searchParams.get('date');
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : today;
  if (date > today) return NextResponse.json({ error: 'Date future non autorisée' }, { status: 400 });

  try {
    const [arrivals, inHouse, departures] = await Promise.all([
      fetchAllPages<ResRow>((a, b) => supabase.from('reservations').select(SELECT).eq('hotel_id', hotelId).eq('arrival_date', date).in('status', ['tentative', 'confirmed', 'checked_in']).order('id').range(a, b)),
      date === today
        ? fetchAllPages<ResRow>((a, b) => supabase.from('reservations').select(SELECT).eq('hotel_id', hotelId).eq('status', 'checked_in').order('id').range(a, b))
        : Promise.resolve([] as ResRow[]),
      fetchAllPages<ResRow>((a, b) => supabase.from('reservations').select(SELECT).eq('hotel_id', hotelId).eq('departure_date', date).in('status', ['checked_in', 'checked_out']).order('id').range(a, b)),
    ]);
    const byId = new Map<string, ResRow>();
    for (const r of [...arrivals, ...inHouse, ...departures]) byId.set(r.id, r);
    const ids = [...byId.keys()];

    const folios: { id: string; reservation_id: string; balance: number; status: string }[] = [];
    const deposits: { reservation_id: string; amount: number; status: string }[] = [];
    for (const part of chunks(ids, 100)) {
      const [{ data: f }, { data: d }] = await Promise.all([
        supabase.from('folios').select('id, reservation_id, balance, status').eq('hotel_id', hotelId).neq('status', 'void').in('reservation_id', part),
        supabase.from('reservation_deposits').select('reservation_id, amount, status').eq('hotel_id', hotelId).in('reservation_id', part).in('status', ['held', 'applied']),
      ]);
      folios.push(...((f ?? []) as typeof folios)); deposits.push(...((d ?? []) as typeof deposits));
    }
    const paidByFolio = new Map<string, number>();
    for (const part of chunks(folios.map((f) => f.id), 100)) {
      const { data: p } = await supabase.from('payments').select('folio_id, amount').eq('hotel_id', hotelId).eq('status', 'captured').in('folio_id', part);
      for (const x of p ?? []) paidByFolio.set(x.folio_id as string, (paidByFolio.get(x.folio_id as string) ?? 0) + Number(x.amount));
    }

    const folioOf = new Map<string, { balance: number; paid: number }>();
    for (const f of folios) {
      const cur = folioOf.get(f.reservation_id) ?? { balance: 0, paid: 0 };
      folioOf.set(f.reservation_id, { balance: cur.balance + Number(f.balance), paid: cur.paid + (paidByFolio.get(f.id) ?? 0) });
    }
    const depOf = new Map<string, { held: number; applied: number }>();
    for (const d of deposits) {
      const cur = depOf.get(d.reservation_id) ?? { held: 0, applied: 0 };
      if (d.status === 'held') cur.held += Number(d.amount); else cur.applied += Number(d.amount);
      depOf.set(d.reservation_id, cur);
    }

    const order = { arrival: 0, departure: 1, inhouse: 2 } as const;
    const rows = ids.map((id) => {
      const r = byId.get(id)!;
      const g = one(r.guests); const f = folioOf.get(id); const d = depOf.get(id);
      const input: StayInput = {
        reservationId: id, confirmationNumber: r.confirmation_number, guest: [g?.first_name, g?.last_name].filter(Boolean).join(' ') || '—',
        room: one(r.rooms)?.room_number ?? null, status: r.status, arrivalDate: r.arrival_date, departureDate: r.departure_date, totalAmount: Number(r.total_amount),
        hasFolio: Boolean(f), charges: f ? f.balance + f.paid : 0, paid: f?.paid ?? 0, depositsHeld: d?.held ?? 0, depositsApplied: d?.applied ?? 0,
      };
      return classifyStay(input, date);
    }).sort((a, b) => order[a.group] - order[b.group] || b.balance - a.balance || a.confirmationNumber.localeCompare(b.confirmationNumber));

    // Caisse du jour : paiements captures et acomptes recus ce jour (fenetre large puis filtre en date locale de l'hotel).
    const from = new Date(Date.parse(`${date}T00:00:00Z`) - 36 * 3600 * 1000).toISOString();
    const to = new Date(Date.parse(`${date}T00:00:00Z`) + 60 * 3600 * 1000).toISOString();
    const [{ data: pays }, { data: deps }, { count: everPaid }] = await Promise.all([
      supabase.from('payments').select('method, amount, transaction_reference, processed_at').eq('hotel_id', hotelId).eq('status', 'captured').gte('processed_at', from).lt('processed_at', to),
      supabase.from('reservation_deposits').select('method, amount, received_at').eq('hotel_id', hotelId).gte('received_at', from).lt('received_at', to),
      supabase.from('payments').select('id', { count: 'exact', head: true }).eq('hotel_id', hotelId).eq('status', 'captured'),
    ]);
    const localDay = (iso: string) => localDateHour(new Date(iso), tz).date;
    const cash = summarizeCash(
      (pays ?? []).map((p) => ({ method: p.method as string, amount: Number(p.amount), reference: (p.transaction_reference as string | null) ?? null, at: p.processed_at as string })),
      (deps ?? []).map((d) => ({ method: d.method as string, amount: Number(d.amount), at: d.received_at as string })), date, localDay);

    return NextResponse.json({ date, today, generatedAt: new Date().toISOString(), rows, summary: summarizeStays(rows), cash, paymentsRecordedEver: everPaid ?? 0 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erreur de lecture des paiements' }, { status: 500 });
  }
}
