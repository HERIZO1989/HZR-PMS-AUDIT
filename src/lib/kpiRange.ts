// Plage de recalcul des indicateurs (compute_kpi_snapshots) : validation et deduction depuis des sejours importes.

export const MAX_KPI_RANGE_DAYS = 400;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const isRealDate = (d: string) => {
  if (!DATE_RE.test(d)) return false;
  const t = Date.parse(`${d}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;   // refuse le 30 février et le mois 13, sans lever d'exception
};
const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

export type KpiRange = { ok: true; from: string; to: string } | { ok: false; error: string };

/** Valide une plage demandee : dates reelles, fin ramenee a aujourd'hui, debut <= fin, au plus 400 jours. */
export function resolveKpiRange(from: unknown, to: unknown, today: string): KpiRange {
  if (typeof from !== 'string' || typeof to !== 'string' || !isRealDate(from) || !isRealDate(to)) {
    return { ok: false, error: 'Dates invalides (format AAAA-MM-JJ attendu)' };
  }
  const end = to > today ? today : to;
  if (from > end) return { ok: false, error: 'La date de début doit précéder la date de fin' };
  if (days(from, end) > MAX_KPI_RANGE_DAYS) return { ok: false, error: `Plage trop longue (${MAX_KPI_RANGE_DAYS} jours maximum)` };
  return { ok: true, from, to: end };
}

/** Plage a recalculer apres un import : de la premiere arrivee au dernier depart (sans depasser aujourd'hui) ; au-dela de 400 jours, on garde les plus recents. */
export function rangeFromStays(stays: { arrival_date: string; departure_date: string }[], today: string): { from: string; to: string } | null {
  const valid = stays.filter((s) => isRealDate(s.arrival_date) && isRealDate(s.departure_date));
  if (valid.length === 0) return null;
  let from = valid.reduce((m, s) => (s.arrival_date < m ? s.arrival_date : m), valid[0].arrival_date);
  const lastDeparture = valid.reduce((m, s) => (s.departure_date > m ? s.departure_date : m), valid[0].departure_date);
  const to = lastDeparture > today ? today : lastDeparture;
  if (from > to) return null;
  if (days(from, to) > MAX_KPI_RANGE_DAYS) from = addDays(to, -(MAX_KPI_RANGE_DAYS - 1));
  return { from, to };
}
