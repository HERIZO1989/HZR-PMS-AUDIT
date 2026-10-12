/**
 * Decodage du nombre et du type de chambres d'une ligne d'export qui ne donne que dates et montant total.
 *
 * Principe : les tarifs de base des types de chambre de l'hotel forment une grille (ex. 108 000, 129 250, 159 000, 176 000, 193 000 Ar).
 * Une ligne de N chambres vendues au tarif public a un prix par nuit egal a la somme de N tarifs de la grille
 * (216 000 = 2 x 108 000 ; 318 000 = 2 x 159 000). On cherche les combinaisons possibles :
 *  - une seule combinaison  -> 'exact'      : lecture fiable ;
 *  - plusieurs              -> 'ambiguous'  : on retient celle qui a le moins de chambres, a verifier ;
 *  - aucune (tarif negocie) -> 'unknown'    : une chambre de type inconnu, a verifier.
 * C'est une deduction, pas une lecture : une chambre vendue a un tarif special peut etre decodee a tort.
 */
export interface RoomTypeRate {
  id: string;
  name: string;
  base_rate: number;
}

export interface RateGrid {
  /** Tarifs distincts, tries. */
  rates: number[];
  /** Type retenu pour chaque tarif (a tarif egal : premier par ordre alphabetique, ex. Standard avant Twin). */
  typeByRate: Map<number, RoomTypeRate>;
  /** Montant (en centimes) -> combinaisons (listes de tarifs triees) qui le produisent. */
  sums: Map<number, number[][]>;
}

export type DecodeStatus = 'exact' | 'ambiguous' | 'unknown';

export interface DecodedRooms {
  status: DecodeStatus;
  rooms: { rate: number; type: RoomTypeRate }[];
  alternatives: number;
}

const MAX_ROOMS = 20;
const MAX_SOLUTIONS_PER_SUM = 30;
const cents = (v: number) => Math.round(v * 100);

export function buildRateGrid(types: RoomTypeRate[], maxRooms: number = MAX_ROOMS): RateGrid {
  const usable = types.filter((t) => Number(t.base_rate) > 0).map((t) => ({ ...t, base_rate: Number(t.base_rate) }));
  const typeByRate = new Map<number, RoomTypeRate>();
  for (const t of [...usable].sort((a, b) => a.name.localeCompare(b.name, 'fr'))) {
    if (!typeByRate.has(t.base_rate)) typeByRate.set(t.base_rate, t);
  }
  const rates = [...typeByRate.keys()].sort((a, b) => a - b);
  const sums = new Map<number, number[][]>();

  const walk = (start: number, count: number, total: number, combo: number[]) => {
    if (count > 0) {
      const key = cents(total);
      const list = sums.get(key) ?? [];
      if (list.length < MAX_SOLUTIONS_PER_SUM) list.push([...combo]);
      sums.set(key, list);
    }
    if (count === maxRooms) return;
    for (let i = start; i < rates.length; i++) {
      combo.push(rates[i]);
      walk(i, count + 1, total + rates[i], combo);
      combo.pop();
    }
  };
  if (rates.length > 0) walk(0, 0, 0, []);
  return { rates, typeByRate, sums };
}

/** Decode un prix par nuit (tolerance de 1 unite de monnaie, pour les divisions non entieres). */
export function decodeRooms(perNight: number, grid: RateGrid): DecodedRooms {
  if (!Number.isFinite(perNight) || perNight <= 0 || grid.rates.length === 0) return { status: 'unknown', rooms: [], alternatives: 0 };
  const center = cents(perNight);
  let found = grid.sums.get(center);
  if (!found) {
    for (let delta = 1; delta <= 100 && !found; delta++) found = grid.sums.get(center - delta) ?? grid.sums.get(center + delta);
  }
  if (!found || found.length === 0) return { status: 'unknown', rooms: [], alternatives: 0 };
  const best = [...found].sort((a, b) => a.length - b.length)[0];
  return {
    status: found.length === 1 ? 'exact' : 'ambiguous',
    rooms: best.map((rate) => ({ rate, type: grid.typeByRate.get(rate)! })),
    alternatives: found.length,
  };
}

/** Nombre de nuits entre deux dates AAAA-MM-JJ. */
export function nightsBetween(arrival: string, departure: string): number {
  const a = Date.parse(`${arrival}T00:00:00Z`);
  const d = Date.parse(`${departure}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(d)) return 0;
  return Math.round((d - a) / 86400000);
}

export interface ExpandedRoom {
  roomIndex: number;
  roomCount: number;
  roomTypeId: string | null;
  totalAmount: number;
  note: string;
}

const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR');

/**
 * Transforme une ligne (dates + montant total) en une liste de chambres. La somme des montants est EXACTEMENT le montant de la ligne
 * (la derniere chambre absorbe l'arrondi). Retourne 1 chambre de type inconnu quand rien ne se decode.
 */
export function expandLine(params: { arrival: string; departure: string; total: number | null; grid: RateGrid }): { status: DecodeStatus; rooms: ExpandedRoom[] } {
  const { arrival, departure, grid } = params;
  const total = Number(params.total ?? 0);
  const nights = nightsBetween(arrival, departure);
  const single = (note: string): { status: DecodeStatus; rooms: ExpandedRoom[] } => ({
    status: 'unknown',
    rooms: [{ roomIndex: 1, roomCount: 1, roomTypeId: null, totalAmount: total, note }],
  });
  if (nights <= 0) return single('[Import Odoo] séjour à la journée : type de chambre non déterminé, à vérifier');
  if (!(total > 0)) return single('[Import Odoo] montant absent : nombre et type de chambres non déterminés, à vérifier');

  const perNight = total / nights;
  const decoded = decodeRooms(perNight, grid);
  if (decoded.status === 'unknown') {
    return single(`[Import Odoo] tarif de ${fmt(perNight)} par nuit hors grille : 1 chambre de type non déterminé, à vérifier`);
  }

  const count = decoded.rooms.length;
  let allocated = 0;
  const rooms: ExpandedRoom[] = decoded.rooms.map((room, i) => {
    const isLast = i === count - 1;
    const amount = isLast ? Math.round((total - allocated) * 100) / 100 : Math.round(room.rate * nights * 100) / 100;
    allocated += amount;
    const label = decoded.status === 'exact'
      ? `chambre ${i + 1}/${count} déduite du tarif (${room.type.name}, ${fmt(room.rate)} par nuit)`
      : `lecture ambiguë (${decoded.alternatives} combinaisons possibles), la plus petite retenue : chambre ${i + 1}/${count} ${room.type.name}, à vérifier`;
    return { roomIndex: i + 1, roomCount: count, roomTypeId: room.type.id, totalAmount: amount, note: `[Import Odoo] ${label}` };
  });
  return { status: decoded.status, rooms };
}
