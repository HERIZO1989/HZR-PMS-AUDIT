import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSessionFromRequest, hasPermission } from '@/lib/session';
import { fetchAllPages } from '@/lib/dbPaging';
import { classifyOverdue, findDuplicateBases, type OverdueReservation, type OverdueRow } from '@/lib/overdueArrivals';
import { localDateHour, summarizeAutoCheckIn, type AutoCheckInRow } from '@/lib/autoCheckIn';
import { rangeFromStays } from '@/lib/kpiRange';

type Supabase = ReturnType<typeof getSupabaseAdmin>;

async function loadOverdue(supabase: Supabase, hotelId: string, today: string): Promise<OverdueRow[]> {
  const raw = await fetchAllPages<{ id: string; confirmation_number: string; arrival_date: string; departure_date: string; total_amount: number; room_type_id: string | null; skip_auto_check_in: boolean; room_types: { name: string } | { name: string }[] | null }>((a, b) => supabase
    .from('reservations').select('id, confirmation_number, arrival_date, departure_date, total_amount, room_type_id, skip_auto_check_in, room_types(name)')
    .eq('hotel_id', hotelId).eq('status', 'confirmed').lt('arrival_date', today).gt('departure_date', today)
    .order('arrival_date').order('id').range(a, b));
  const rows: OverdueReservation[] = raw.map((r) => ({
    id: r.id, confirmation_number: r.confirmation_number, arrival_date: r.arrival_date, departure_date: r.departure_date, total_amount: Number(r.total_amount),
    room_type_id: r.room_type_id, typeName: (Array.isArray(r.room_types) ? r.room_types[0]?.name : r.room_types?.name) ?? null, skip_auto_check_in: r.skip_auto_check_in,
  }));
  if (rows.length === 0) return [];

  const rooms = await fetchAllPages<{ room_type_id: string | null }>((a, b) => supabase.from('rooms').select('room_type_id').eq('hotel_id', hotelId).eq('status', 'vacant_clean').order('id').range(a, b));
  const cleanByType: Record<string, number> = {};
  for (const r of rooms) if (r.room_type_id) cleanByType[r.room_type_id] = (cleanByType[r.room_type_id] ?? 0) + 1;

  const prefixes = [...new Set(rows.map((r) => r.confirmation_number))];
  const { data: siblings } = await supabase.from('reservations').select('confirmation_number').eq('hotel_id', hotelId)
    .or(prefixes.map((p) => `confirmation_number.like.${p}-%`).join(','));
  const dup = findDuplicateBases(prefixes, (siblings ?? []).map((s) => s.confirmation_number as string));
  return classifyOverdue(rows, cleanByType, dup);
}

async function context(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !hasPermission(session, 'reservations.manage')) return { error: NextResponse.json({ error: 'Permission "reservations.manage" requise' }, { status: 403 }) } as const;
  const supabase = getSupabaseAdmin();
  const { data: hotel } = await supabase.from('hotels').select('timezone').eq('id', session.hotelId).single();
  return { session, supabase, today: localDateHour(new Date(), hotel?.timezone ?? 'UTC').date } as const;
}

/** Apercu : les sejours en cours jamais enregistres, avec ce qui est possible pour chacun. */
export async function GET(req: NextRequest) {
  const ctx = await context(req);
  if ('error' in ctx) return ctx.error;
  try {
    const rows = await loadOverdue(ctx.supabase, ctx.session.hotelId, ctx.today);
    return NextResponse.json({ today: ctx.today, rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erreur de lecture' }, { status: 500 });
  }
}

/** Enregistre les arrivees en retard « auto » (ou un sous-ensemble choisi), puis reporte les acomptes et recalcule les indicateurs. */
export async function POST(req: NextRequest) {
  const ctx = await context(req);
  if ('error' in ctx) return ctx.error;
  const { session, supabase, today } = ctx;
  const body = await req.json().catch(() => ({}));
  const only = Array.isArray(body?.ids) ? new Set(body.ids.filter((x: unknown): x is string => typeof x === 'string')) : null;

  try {
    // La classification est refaite cote serveur : on n'enregistre jamais que ce qui est reellement enregistrable a cet instant.
    const rows = (await loadOverdue(supabase, session.hotelId, today)).filter((r) => r.kind === 'auto' && (!only || only.has(r.id)));
    const results: AutoCheckInRow[] = [];
    const done: { arrival_date: string; departure_date: string }[] = [];
    let depositsApplied = 0;
    const depositErrors: string[] = [];
    for (const r of rows) {
      const { data, error } = await supabase.rpc('auto_check_in_reservation', { p_reservation_id: r.id, p_hotel_id: session.hotelId, p_staff_user_id: session.staffUserId });
      if (error) { results.push({ reservation_id: r.id, confirmation_number: r.confirmation_number, outcome: 'failed', reason: error.message }); continue; }
      const roomId = (data as { assigned_room_id?: string } | null)?.assigned_room_id;
      const { data: room } = roomId ? await supabase.from('rooms').select('room_number').eq('id', roomId).maybeSingle() : { data: null };
      results.push({ reservation_id: r.id, confirmation_number: r.confirmation_number, outcome: 'checked_in', room: room?.room_number as string | undefined });
      done.push({ arrival_date: r.arrival_date, departure_date: r.departure_date });
      const { data: applied, error: depErr } = await supabase.rpc('apply_reservation_deposits', { p_reservation_id: r.id, p_hotel_id: session.hotelId, p_staff_user_id: session.staffUserId });
      if (depErr) depositErrors.push(`${r.confirmation_number} : ${depErr.message}`); else depositsApplied += Number(applied ?? 0);
    }

    // Ces sejours deviennent visibles dans l'occupation sur toute leur duree passee : on recalcule les indicateurs concernes.
    let kpi: { from: string; to: string; days: number } | null = null;
    const range = rangeFromStays(done, today);
    if (range) {
      const { data, error } = await supabase.rpc('compute_kpi_snapshots', { p_hotel_id: session.hotelId, p_start_date: range.from, p_end_date: range.to });
      if (!error) kpi = { ...range, days: Number(data ?? 0) };
    }
    const checked = results.filter((x) => x.outcome === 'checked_in').length;
    const failed = results.length - checked;
    console.log(`[overdue] ${session.email} : ${summarizeAutoCheckIn({ checked_in: checked, skipped: 0, failed })}`);
    return NextResponse.json({ date: today, checked_in: checked, skipped: 0, failed, results, depositsApplied, depositErrors, kpi });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erreur du check-in des arrivées en retard' }, { status: 500 });
  }
}
