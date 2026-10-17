/**
 * Decodage du nombre et du type de chambres d'une ligne d'export qui ne donne que dates et montant total.
 *
 * Principe : les tarifs de base des types de chambre de l'hotel forment une grille (ex. 108 000, 129 250, 159 000, 176 000, 193 000 Ar).
 * Une ligne de N chambres vendues au tarif public a un prix par nuit egal a la somme de N tarifs de la grille
 * (216 000 = 2 x 108 000 ; 318 000 = 2 x 159 000). On cherche les combinaisons possibles :
 *  - une seule combinaison  -> 'exact'      : lecture fiable ;
 *  - plusieurs              -> 'ambiguous'  : on retient celle qui a le moins de chambres, a verifier ;
 *  - aucune (tarif negocie) -> 'unknown'    : une chambre de type inconnu, a verifier.
 * Tarifs remises : quand un diviseur est fourni (ex. 1,06 a Anjary : 159 000 -> 150 000, 108 000 -> 102 000), une ligne dont TOUTES les chambres
 * sont au tarif remise d'un type est lue 'discounted' (essayee seulement si aucune lecture au tarif public n'existe, sans melanger les deux).
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
  /** Idem pour les tarifs remises : combinaisons de chambres TOUTES remisees. */
  discountedSums: Map<number, number[][]>;
  /** Tarif remise -> tarif public d'origine. */
  baseOfDiscounted: Map<number, number>;
}

export type DecodeStatus = 'exact' | 'discounted' | 'ambiguous' | 'unknown';

export interface DecodedRooms {
  status: DecodeStatus;
  rooms: { rate: number; type: RoomTypeRate; publicRate?: number }[];
  alternatives: number;
}

const MAX_ROOMS = 20;
const MAX_SOLUTIONS_PER_SUM = 30;
const cents = (v: number) => Math.round(v * 100);

const norm = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

export function buildRateGrid(
  types: RoomTypeRate[],
  options: { maxRooms?: number; discountDivisor?: number; negotiated?: { typeName: string; rate: number }[] } = {}
): RateGrid {
  const maxRooms = options.maxRooms ?? MAX_ROOMS;
  const usable = types.filter((t) => Number(t.base_rate) > 0).map((t) => ({ ...t, base_rate: Number(t.base_rate) }));
  const typeByRate = new Map<number, RoomTypeRate>();
  for (const t of [...usable].sort((a, b) => a.name.localeCompare(b.name, 'fr'))) {
    if (!typeByRate.has(t.base_rate)) typeByRate.set(t.base_rate, t);
  }
  const rates = [...typeByRate.keys()].sort((a, b) => a - b);
  const walkInto = (target: Map<number, number[][]>, values: number[]) => {
    const walk = (start: number, count: number, total: number, combo: number[]) => {
      if (count > 0) {
        const key = cents(total);
        const list = target.get(key) ?? [];
        if (list.length < MAX_SOLUTIONS_PER_SUM) list.push([...combo]);
        target.set(key, list);
      }
      if (count === maxRooms) return;
      for (let i = start; i < values.length; i++) {
        combo.push(values[i]);
        walk(i, count + 1, total + values[i], combo);
        combo.pop();
      }
    };
    if (values.length > 0) walk(0, 0, 0, []);
  };

  const sums = new Map<number, number[][]>();
  walkInto(sums, rates);

  // Tarifs remises : tarif public / diviseur, arrondi au millier ; ignores s'ils tombent sur un tarif public existant.
  const baseOfDiscounted = new Map<number, number>();
  const divisor = options.discountDivisor;
  if (divisor && divisor > 1) {
    for (const base of rates) {
      const discounted = Math.round(base / divisor / 1000) * 1000;
      if (discounted > 0 && !typeByRate.has(discounted) && !baseOfDiscounted.has(discounted)) baseOfDiscounted.set(discounted, base);
    }
  }
  // Tarifs negocies confirmes : tarif exact par nuit rattache a un type (par son nom, sans tenir compte des accents ni de la casse).
  for (const n of options.negotiated ?? []) {
    const type = usable.find((t) => norm(t.name) === norm(n.typeName));
    const rate = Number(n.rate);
    if (type && rate > 0 && !typeByRate.has(rate) && !baseOfDiscounted.has(rate)) baseOfDiscounted.set(rate, type.base_rate);
  }
  const discountedRates = [...baseOfDiscounted.keys()].sort((a, b) => a - b);
  const discountedSums = new Map<number, number[][]>();
  walkInto(discountedSums, discountedRates);
  return { rates, typeByRate, sums, discountedSums, baseOfDiscounted };
}

const lookup = (sums: Map<number, number[][]>, perNight: number): number[][] | undefined => {
  const center = cents(perNight);
  let found = sums.get(center);
  for (let delta = 1; delta <= 100 && !found; delta++) found = sums.get(center - delta) ?? sums.get(center + delta);
  return found && found.length > 0 ? found : undefined;
};

/** Decode un prix par nuit (tolerance de 1 unite de monnaie, pour les divisions non entieres). */
export function decodeRooms(perNight: number, grid: RateGrid): DecodedRooms {
  if (!Number.isFinite(perNight) || perNight <= 0 || grid.rates.length === 0) return { status: 'unknown', rooms: [], alternatives: 0 };

  const publicFound = lookup(grid.sums, perNight);
  if (publicFound) {
    const best = [...publicFound].sort((a, b) => a.length - b.length)[0];
    return {
      status: publicFound.length === 1 ? 'exact' : 'ambiguous',
      rooms: best.map((rate) => ({ rate, type: grid.typeByRate.get(rate)! })),
      alternatives: publicFound.length,
    };
  }

  const discountedFound = lookup(grid.discountedSums, perNight);
  if (discountedFound) {
    const best = [...discountedFound].sort((a, b) => a.length - b.length)[0];
    return {
      status: discountedFound.length === 1 ? 'discounted' : 'ambiguous',
      rooms: best.map((rate) => {
        const publicRate = grid.baseOfDiscounted.get(rate)!;
        return { rate, publicRate, type: grid.typeByRate.get(publicRate)! };
      }),
      alternatives: discountedFound.length,
    };
  }
  return { status: 'unknown', rooms: [], alternatives: 0 };
}

/** Nombre de nuits entre deux dates AAAA-MM-JJ. */
export function nightsBetween(arrival: string, departure: string): number {
  const a = Date.parse(`${arrival}T00:00:00Z`);
  const d = Date.parse(`${departure}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(d)) return 0;
  return Math.round((d - a) / 86400000);
}

/**
 * Nombre de nuits selon les HEURES d'arrivee et de depart (dates-heures « AAAA-MM-JJ HH:MM[:SS] » ou ISO), arrondi inferieur et superieur.
 * Sert uniquement de lecture de secours : sur l'export d'Anjary, certains montants ne collent a la grille que si les nuits sont comptees
 * ainsi (ex. entree 13h00, sortie 12h00 le 7e jour -> 6 nuits facturees et non 7). Retourne null si les heures sont absentes ou illisibles.
 */
export function nightsFromTimes(arrivalRaw: unknown, departureRaw: unknown): { floor: number; ceil: number } | null {
  const parse = (v: unknown): number | null => {
    const m = String(v ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (!m || m[4] === undefined) return null; // pas d'heure : pas de lecture de secours
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  };
  const a = parse(arrivalRaw);
  const d = parse(departureRaw);
  if (a === null || d === null || d <= a) return null;
  const days = (d - a) / 86400000;
  return { floor: Math.max(1, Math.floor(days)), ceil: Math.max(1, Math.ceil(days)) };
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
export function expandLine(params: { arrival: string; departure: string; total: number | null; grid: RateGrid; alternateNights?: number[]; dayUseSupplements?: { typeName: string; amount: number }[]; halfNight?: boolean; sameDayAsOneNight?: boolean; knownRateErrors?: { rate: number; note?: string }[] }): { status: DecodeStatus; rooms: ExpandedRoom[] } {
  const { arrival, departure, grid } = params;
  const total = Number(params.total ?? 0);
  let nights = nightsBetween(arrival, departure);
  // Sejour a la journee (meme date d'arrivee et de depart) : le montant est le prix d'UNE journee, lu comme une nuit.
  const sameDay = nights === 0 && arrival === departure && !!params.sameDayAsOneNight && total > 0;
  if (sameDay) nights = 1;
  const single = (note: string): { status: DecodeStatus; rooms: ExpandedRoom[] } => ({
    status: 'unknown',
    rooms: [{ roomIndex: 1, roomCount: 1, roomTypeId: null, totalAmount: total, note }],
  });
  if (nights <= 0) return single('[Import Odoo] séjour à la journée : type de chambre non déterminé, à vérifier');
  if (!(total > 0)) return single('[Import Odoo] montant absent : nombre et type de chambres non déterminés, à vérifier');

  const perNight = total / nights;
  // Erreur de tarif connue dans le systeme source : jamais decodee, a corriger a la source.
  const knownError = (params.knownRateErrors ?? []).find((e) => Math.abs(e.rate - perNight) <= 1);
  if (knownError) {
    return single(`[Import Odoo] tarif de ${fmt(perNight)} par nuit : ${knownError.note ?? 'erreur de tarif connue dans le système source'}, type de chambre non déterminé, à corriger`);
  }
  let decoded = decodeRooms(perNight, grid);
  let usedNights = nights;
  let recount = false;
  let dayUse = 0;
  let halfNight = false;
  let pureDayUse = 0;
  if (decoded.status === 'unknown' && nights === 1) {
    // Day use seul : le montant vaut le supplement d'un type (Standard 60 000, Superieur 90 000), pour 1 a 3 chambres. A verifier.
    outer: for (const sup of params.dayUseSupplements ?? []) {
      const type = [...grid.typeByRate.values()].find((t) => norm(t.name) === norm(sup.typeName));
      if (!type || !(sup.amount > 0)) continue;
      for (let k = 1; k <= 3; k++) {
        if (Math.abs(total - k * sup.amount) <= 1 + k) {
          decoded = { status: 'ambiguous', rooms: Array.from({ length: k }, () => ({ rate: sup.amount, type })), alternatives: 1 };
          pureDayUse = sup.amount;
          break outer;
        }
      }
    }
  }
  if (decoded.status === 'unknown' && nights === 1 && !sameDay) {
    // Arrivee anticipee : UNE chambre au tarif de son type + supplement unique de ce type (day use). Toujours a verifier.
    for (const sup of params.dayUseSupplements ?? []) {
      if (!(sup.amount > 0) || !(total > sup.amount)) continue;
      const attempt = decodeRooms(total - sup.amount, grid);
      if (attempt.status !== 'unknown' && attempt.rooms.length === 1 && norm(attempt.rooms[0].type.name) === norm(sup.typeName)) {
        decoded = { ...attempt, status: 'ambiguous' };
        dayUse = sup.amount;
        break;
      }
    }
    // Demi-nuitee (50 %) : le montant vaut la moitie du tarif d'UNE chambre. Toujours a verifier.
    if (decoded.status === 'unknown' && params.halfNight) {
      const attempt = decodeRooms(total * 2, grid);
      if (attempt.status !== 'unknown' && attempt.rooms.length === 1) {
        decoded = { ...attempt, status: 'ambiguous' };
        halfNight = true;
      }
    }
  }
  if (decoded.status === 'unknown') {
    // Lecture de secours : nuits comptees selon les heures. Jamais « exacte » : c'est une deduction, toujours a verifier.
    for (const alt of sameDay ? [] : [...new Set(params.alternateNights ?? [])]) {
      if (!(alt > 0) || alt === nights) continue;
      const attempt = decodeRooms(total / alt, grid);
      if (attempt.status !== 'unknown') {
        decoded = { ...attempt, status: 'ambiguous' };
        usedNights = alt;
        recount = true;
        break;
      }
    }
  }
  if (decoded.status === 'unknown') {
    return single(sameDay
      ? `[Import Odoo] séjour à la journée : prix de ${fmt(perNight)} hors grille, 1 chambre de type non déterminé, à vérifier`
      : `[Import Odoo] tarif de ${fmt(perNight)} par nuit hors grille : 1 chambre de type non déterminé, à vérifier`);
  }

  const count = decoded.rooms.length;
  let allocated = 0;
  const rooms: ExpandedRoom[] = decoded.rooms.map((room, i) => {
    const isLast = i === count - 1;
    const amount = isLast ? Math.round((total - allocated) * 100) / 100 : Math.round(room.rate * usedNights * 100) / 100;
    allocated += amount;
    const label = decoded.status === 'exact'
      ? `chambre ${i + 1}/${count} déduite du tarif (${room.type.name}, ${fmt(room.rate)} par nuit)`
      : decoded.status === 'discounted'
        ? room.publicRate && room.rate > room.publicRate
          ? `chambre ${i + 1}/${count} déduite d'un tarif public sans remise (${room.type.name} ${fmt(room.rate)} par nuit, grille ${fmt(room.publicRate)} déjà remisée de 15 %)`
          : `chambre ${i + 1}/${count} déduite d'un tarif remisé (${room.type.name} ${fmt(room.publicRate ?? room.rate)} remisé à ${fmt(room.rate)} par nuit)`
        : pureDayUse
          ? `day use seul (${fmt(pureDayUse)} par chambre) : chambre ${i + 1}/${count} ${room.type.name}, à vérifier`
          : halfNight
          ? `demi-nuitée (50 %) : chambre ${i + 1}/${count} ${room.type.name} (${fmt(room.rate)} par nuit, moitié facturée), à vérifier`
          : dayUse
          ? `arrivée anticipée : ${fmt(dayUse)} de day use retiré du montant (chambre ${i + 1}/${count} ${room.type.name}, ${fmt(room.rate)} par nuit), à vérifier`
          : recount
            ? `nuits recomptées selon les heures d'arrivée et de départ (${usedNights} au lieu de ${nights}) : chambre ${i + 1}/${count} ${room.type.name} (${fmt(room.rate)} par nuit), à vérifier`
            : `lecture ambiguë (${decoded.alternatives} combinaisons possibles), la plus petite retenue : chambre ${i + 1}/${count} ${room.type.name}, à vérifier`;
    return { roomIndex: i + 1, roomCount: count, roomTypeId: room.type.id, totalAmount: amount, note: `[Import Odoo] ${label}${sameDay ? ' (séjour à la journée : prix de la journée lu comme une nuit)' : ''}` };
  });
  return { status: decoded.status, rooms };
}
