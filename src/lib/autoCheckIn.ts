// Check-in automatique des arrivees du jour : heure locale de l'hotel, resume, execution (avec report des acomptes).
import type { SupabaseClient } from '@supabase/supabase-js';

/** Heure locale a partir de laquelle la routine enregistre les arrivees (heure d'arrivee habituelle ; avant, les chambres des departs ne sont pas encore libres). */
export const AUTO_CHECK_IN_FROM_HOUR = 12;

export interface AutoCheckInRow {
  reservation_id: string;
  confirmation_number: string;
  outcome: 'checked_in' | 'skipped' | 'failed';
  room?: string;
  reason?: string;
}
export interface AutoCheckInResult { date: string; checked_in: number; skipped: number; failed: number; results: AutoCheckInRow[] }
export interface AutoCheckInRun extends AutoCheckInResult { depositsApplied: number; depositErrors: string[] }

/** Date et heure dans le fuseau de l'hotel (ex. Indian/Antananarivo = UTC+3). */
export function localDateHour(now: Date, timeZone: string): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) % 24 };
}

export const shouldRunAutoCheckIn = (hour: number) => hour >= AUTO_CHECK_IN_FROM_HOUR;

/** Resume lisible : « 11 enregistrées, 2 ignorées, 1 à faire à la main ». */
export function summarizeAutoCheckIn(r: Pick<AutoCheckInResult, 'checked_in' | 'skipped' | 'failed'>): string {
  const parts = [`${r.checked_in} enregistrée(s)`];
  if (r.skipped > 0) parts.push(`${r.skipped} ignorée(s)`);
  if (r.failed > 0) parts.push(`${r.failed} à faire à la main`);
  return parts.join(', ');
}

/** Lance le check-in automatique d'une date, puis reporte les acomptes sur les folios ouverts. Un echec de report n'annule rien : les acomptes restent « en attente ». */
export async function runAutoCheckIn(supabase: SupabaseClient, hotelId: string, date: string, staffUserId: string | null): Promise<AutoCheckInRun> {
  const { data, error } = await supabase.rpc('auto_check_in_arrivals', { p_hotel_id: hotelId, p_date: date, p_staff_user_id: staffUserId });
  if (error) throw new Error(error.message);
  const result = data as AutoCheckInResult;
  let depositsApplied = 0;
  const depositErrors: string[] = [];
  for (const row of result.results.filter((x) => x.outcome === 'checked_in')) {
    const { data: applied, error: e } = await supabase.rpc('apply_reservation_deposits', { p_reservation_id: row.reservation_id, p_hotel_id: hotelId, p_staff_user_id: staffUserId });
    if (e) depositErrors.push(`${row.confirmation_number} : ${e.message}`);
    else depositsApplied += Number(applied ?? 0);
  }
  return { ...result, depositsApplied, depositErrors };
}

export interface ScheduledAutoCheckIn { hotelId: string; hotel: string; ran: boolean; reason?: string; run?: AutoCheckInRun; error?: string }

/** Routine planifiee : pour chaque hotel qui l'a activee, enregistre les arrivees du jour local une fois l'heure atteinte. Idempotente (ne touche que les reservations encore « confirmees »). */
export async function runScheduledAutoCheckIn(supabase: SupabaseClient, now: Date = new Date()): Promise<ScheduledAutoCheckIn[]> {
  const { data: hotels, error } = await supabase.from('hotels').select('id, name, timezone').eq('auto_check_in_enabled', true);
  if (error) throw new Error(error.message);
  const out: ScheduledAutoCheckIn[] = [];
  for (const h of hotels ?? []) {
    try {
      const local = localDateHour(now, h.timezone ?? 'UTC');
      if (!shouldRunAutoCheckIn(local.hour)) { out.push({ hotelId: h.id, hotel: h.name, ran: false, reason: `avant ${AUTO_CHECK_IN_FROM_HOUR} h (heure locale)` }); continue; }
      out.push({ hotelId: h.id, hotel: h.name, ran: true, run: await runAutoCheckIn(supabase, h.id, local.date, null) });
    } catch (e) {
      out.push({ hotelId: h.id, hotel: h.name, ran: false, error: e instanceof Error ? e.message : 'Erreur' });
    }
  }
  return out;
}
