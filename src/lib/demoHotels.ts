export interface DemoHotelRequest {
  hotelName: string;
  rooms: number;
  guests: number;
  reservations: number;
}

export const DEMO_LIMITS = {
  rooms: { min: 5, max: 200, default: 40 },
  guests: { min: 5, max: 500, default: 60 },
  reservations: { min: 0, max: 2000, default: 120 },
} as const;

/** Valide et normalise le corps de la requete (la base reverifie les memes bornes). Retourne un message en francais en cas d'erreur. */
export function parseDemoRequest(body: unknown): { ok: true; value: DemoHotelRequest } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Requête invalide' };
  const b = body as Record<string, unknown>;
  const hotelName = typeof b.hotelName === 'string' ? b.hotelName.trim().replace(/\s+/g, ' ') : '';
  if (hotelName.length < 2 || hotelName.length > 80) return { ok: false, error: "Le nom de l'hôtel doit comporter entre 2 et 80 caractères" };

  const num = (v: unknown, def: number) => (v === undefined || v === null || v === '' ? def : Number(v));
  const rooms = num(b.rooms, DEMO_LIMITS.rooms.default);
  const guests = num(b.guests, DEMO_LIMITS.guests.default);
  const reservations = num(b.reservations, DEMO_LIMITS.reservations.default);

  for (const [label, value, lim] of [
    ['chambres', rooms, DEMO_LIMITS.rooms],
    ['clients', guests, DEMO_LIMITS.guests],
    ['réservations', reservations, DEMO_LIMITS.reservations],
  ] as const) {
    if (!Number.isInteger(value) || value < lim.min || value > lim.max) {
      return { ok: false, error: `Nombre de ${label} : entier entre ${lim.min} et ${lim.max}` };
    }
  }
  return { ok: true, value: { hotelName, rooms, guests, reservations } };
}
