// Vues de la liste des reservations : la liste ne chargeait que les 100 arrivees les plus lointaines (surtout des reservations futures),
// si bien que les arrivees du jour et les sejours en cours n'y figuraient meme pas.

export type ReservationView = 'today' | 'inhouse' | 'late' | 'upcoming' | 'all';

export const RESERVATION_VIEWS: { code: ReservationView; label: string }[] = [
  { code: 'today', label: 'Arrivées du jour' },
  { code: 'inhouse', label: 'En séjour' },
  { code: 'late', label: 'En retard' },
  { code: 'upcoming', label: 'À venir' },
  { code: 'all', label: 'Toutes' },
];

export const parseReservationView = (v: string | null | undefined): ReservationView =>
  RESERVATION_VIEWS.find((x) => x.code === v)?.code ?? 'today';

export interface ViewQuery {
  statuses: string[] | null;
  arrivalEq?: string;
  arrivalLt?: string;
  arrivalGt?: string;
  departureGt?: string;
  ascending: boolean;
  limit: number;
}

/** Filtres de chaque vue pour une date locale donnee. « Toutes » garde l'ancien comportement (les plus recentes d'abord). */
export function viewQuery(view: ReservationView, today: string): ViewQuery {
  switch (view) {
    case 'today': return { statuses: ['tentative', 'confirmed', 'checked_in'], arrivalEq: today, ascending: true, limit: 300 };
    case 'inhouse': return { statuses: ['checked_in'], ascending: true, limit: 300 };
    case 'late': return { statuses: ['tentative', 'confirmed'], arrivalLt: today, departureGt: today, ascending: true, limit: 300 };
    case 'upcoming': return { statuses: ['tentative', 'confirmed'], arrivalGt: today, ascending: true, limit: 300 };
    default: return { statuses: null, ascending: false, limit: 100 };
  }
}

/** Recherche par numero de confirmation : on retire les caracteres qui casseraient le filtre. */
export const cleanSearch = (q: string | null | undefined): string => (q ?? '').replace(/[,()%_\\*]/g, ' ').trim().slice(0, 60);
