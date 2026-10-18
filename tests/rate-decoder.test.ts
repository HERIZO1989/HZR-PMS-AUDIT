import { describe, it, expect } from 'vitest';
import { buildRateGrid, decodeRooms, expandLine, isDayRental, nightsBetween, nightsFromTimes, type RoomTypeRate } from '../src/lib/import/rateDecoder';

// Types et tarifs de base d'Anjary (TTC, Ar).
const TYPES: RoomTypeRate[] = [
  { id: 't-fam', name: 'Familiale', base_rate: 193000 },
  { id: 't-std', name: 'Standard', base_rate: 108000 },
  { id: 't-sup', name: 'Supérieur', base_rate: 159000 },
  { id: 't-bal', name: 'Supérieur avec balcon', base_rate: 176000 },
  { id: 't-tstd', name: 'Triple Standard', base_rate: 129250 },
  { id: 't-tsup', name: 'Triple Supérieur', base_rate: 176000 },
  { id: 't-twin', name: 'Twin', base_rate: 108000 },
];
const grid = buildRateGrid(TYPES);
const gridRemise = buildRateGrid(TYPES, { discountDivisor: 1.06 });

describe('Grille de tarifs', () => {
  it('garde un seul type par tarif, le premier par ordre alphabétique', () => {
    expect(grid.rates).toEqual([108000, 129250, 159000, 176000, 193000]);
    expect(grid.typeByRate.get(108000)?.name).toBe('Standard'); // avant Twin
    expect(grid.typeByRate.get(176000)?.name).toBe('Supérieur avec balcon'); // avant Triple Supérieur
  });
  it('ignore les types sans tarif', () => {
    expect(buildRateGrid([{ id: 'x', name: 'X', base_rate: 0 }]).rates).toEqual([]);
  });
});

describe('Décodage du prix par nuit', () => {
  it('lit une chambre au tarif public', () => {
    const d = decodeRooms(159000, grid);
    expect(d.status).toBe('exact');
    expect(d.rooms.map((r) => r.type.name)).toEqual(['Supérieur']);
  });
  it('lit 2 chambres : 216 000 = 2 x 108 000, 318 000 = 2 x 159 000', () => {
    expect(decodeRooms(216000, grid)).toMatchObject({ status: 'exact', rooms: [{ rate: 108000 }, { rate: 108000 }] });
    expect(decodeRooms(318000, grid)).toMatchObject({ status: 'exact', rooms: [{ rate: 159000 }, { rate: 159000 }] });
  });
  it('lit des chambres de types différents : 267 000 = 108 000 + 159 000', () => {
    const d = decodeRooms(267000, grid);
    expect(d.status).toBe('exact');
    expect(d.rooms.map((r) => r.rate).sort()).toEqual([108000, 159000]);
  });
  it('signale une lecture ambiguë et retient la plus petite', () => {
    const d = decodeRooms(352000, grid); // 2 x 176 000 ou 159 000 + 193 000
    expect(d.status).toBe('ambiguous');
    expect(d.alternatives).toBeGreaterThan(1);
    expect(d.rooms).toHaveLength(2);
  });
  it('retient la combinaison avec le moins de chambres', () => {
    // 432 000 = 4 x 108 000 ou 2 x 216 000 (inexistant)... mais aussi 108 000 + 129 250 + ... ; le minimum doit etre <= toute autre lecture
    const d = decodeRooms(432000, grid);
    expect(d.status).not.toBe('unknown');
    const all = grid.sums.get(43200000)!;
    expect(d.rooms.length).toBe(Math.min(...all.map((c) => c.length)));
  });
  it('reconnaît un tarif négocié hors grille', () => {
    for (const v of [150000, 168000, 102000, 249000]) expect(decodeRooms(v, grid).status, String(v)).toBe('unknown');
  });
  it('tolère un arrondi de 1 Ar (division non entière)', () => {
    expect(decodeRooms(158999.67, grid).status).toBe('exact');
  });
  it('est inconnu pour des valeurs invalides ou une grille vide', () => {
    expect(decodeRooms(0, grid).status).toBe('unknown');
    expect(decodeRooms(NaN, grid).status).toBe('unknown');
    expect(decodeRooms(159000, buildRateGrid([])).status).toBe('unknown');
  });
});

describe('Tarifs remisés (tarif public / 1,06)', () => {
  it('calcule les tarifs remisés arrondis au millier', () => {
    expect([...gridRemise.baseOfDiscounted.keys()].sort((a, b) => a - b)).toEqual([102000, 122000, 150000, 166000, 182000]);
    expect(gridRemise.baseOfDiscounted.get(150000)).toBe(159000);
  });
  it('lit 150 000, 102 000, 166 000 et 182 000 comme le même type remisé', () => {
    const cas: [number, string][] = [[150000, 'Supérieur'], [102000, 'Standard'], [166000, 'Supérieur avec balcon'], [182000, 'Familiale']];
    for (const [v, nom] of cas) {
      const d = decodeRooms(v, gridRemise);
      expect(d.status, String(v)).toBe('discounted');
      expect(d.rooms).toHaveLength(1);
      expect(d.rooms[0].type.name).toBe(nom);
    }
  });
  it('lit 2 chambres toutes remisées : 300 000 = 2 x 150 000', () => {
    const d = decodeRooms(300000, gridRemise);
    expect(d.status).toBe('discounted');
    expect(d.rooms.map((r) => r.type.name)).toEqual(['Supérieur', 'Supérieur']);
  });
  it('ne mélange pas tarif public et remisé : 258 000 (= 150 000 remisé + 108 000 public) reste hors grille', () => {
    expect(decodeRooms(258000, gridRemise).status).toBe('unknown');
  });
  it('le tarif public l\'emporte et ne change jamais : aucune lecture exacte existante ne devient remisée', () => {
    for (const v of [108000, 159000, 216000, 318000, 267000]) {
      expect(decodeRooms(v, gridRemise).status, String(v)).toBe(decodeRooms(v, grid).status);
    }
  });
  it('sans diviseur, 150 000 reste hors grille', () => {
    expect(decodeRooms(150000, grid).status).toBe('unknown');
  });
  it('expandLine : note explicite et total conservé', () => {
    const r = expandLine({ arrival: '2026-04-28', departure: '2026-04-30', total: 300000, grid: gridRemise });
    expect(r.status).toBe('discounted');
    expect(r.rooms[0]).toMatchObject({ roomTypeId: 't-sup', totalAmount: 300000 });
    expect(r.rooms[0].note).toMatch(/tarif remisé \(Supérieur 159\s000 remisé à 150\s000 par nuit\)/);
  });
});

describe('Expansion d\'une ligne en chambres', () => {
  it('une chambre : le numéro de confirmation et le montant sont conservés', () => {
    const r = expandLine({ arrival: '2026-04-28', departure: '2026-04-30', total: 318000, grid });
    expect(r.status).toBe('exact');
    expect(r.rooms).toHaveLength(1);
    expect(r.rooms[0]).toMatchObject({ roomTypeId: 't-sup', totalAmount: 318000, roomCount: 1 });
  });
  it('deux chambres : la somme des montants est EXACTEMENT le total de la ligne', () => {
    const r = expandLine({ arrival: '2026-04-28', departure: '2026-04-30', total: 864000, grid }); // 2 nuits x 432 000
    const sum = r.rooms.reduce((s, x) => s + x.totalAmount, 0);
    expect(sum).toBe(864000);
    expect(r.rooms.every((x) => x.roomTypeId !== null)).toBe(true);
  });
  it('plusieurs chambres : chaque réservation porte son type et une note', () => {
    const r = expandLine({ arrival: '2026-04-28', departure: '2026-04-29', total: 216000, grid });
    expect(r.rooms).toHaveLength(2);
    expect(r.rooms.map((x) => x.roomIndex)).toEqual([1, 2]);
    expect(r.rooms[0].note).toMatch(/chambre 1\/2 déduite du tarif \(Standard/);
  });
  it('tarif hors grille : une chambre de type inconnu, à vérifier, montant intact', () => {
    const r = expandLine({ arrival: '2026-04-28', departure: '2026-04-30', total: 300000, grid }); // 150 000 par nuit
    expect(r.status).toBe('unknown');
    expect(r.rooms).toHaveLength(1);
    expect(r.rooms[0]).toMatchObject({ roomTypeId: null, totalAmount: 300000 });
    expect(r.rooms[0].note).toMatch(/hors grille.*à vérifier/);
  });
  it('séjour à la journée ou montant absent : une chambre inconnue, sans division par zéro', () => {
    expect(expandLine({ arrival: '2026-04-28', departure: '2026-04-28', total: 108000, grid }).rooms[0].roomTypeId).toBeNull();
    expect(expandLine({ arrival: '2026-04-28', departure: '2026-04-30', total: null, grid }).rooms[0].note).toMatch(/montant absent/);
  });
  it('lecture ambiguë : note explicite avec le nombre de combinaisons', () => {
    const r = expandLine({ arrival: '2026-04-28', departure: '2026-04-29', total: 352000, grid });
    expect(r.status).toBe('ambiguous');
    expect(r.rooms[0].note).toMatch(/ambiguë/);
  });
  it('calcule les nuits entre deux dates', () => {
    expect(nightsBetween('2026-04-28', '2026-05-02')).toBe(4);
    expect(nightsBetween('2026-04-28', 'n/a')).toBe(0);
  });
});

describe('Nuits comptées selon les heures (lecture de secours)', () => {
  it('calcule les nuits aux arrondis inférieur et supérieur, et refuse les dates sans heure', () => {
    expect(nightsFromTimes('2026-01-13 13:00:00', '2026-01-20 12:00:00')).toEqual({ floor: 6, ceil: 7 });
    expect(nightsFromTimes('2026-01-13 12:00:00', '2026-01-14 11:00:00')).toEqual({ floor: 1, ceil: 1 });
    expect(nightsFromTimes('2026-01-13', '2026-01-20')).toBeNull();
    expect(nightsFromTimes('n/a', '2026-01-20 12:00:00')).toBeNull();
    expect(nightsFromTimes('2026-01-20 12:00:00', '2026-01-13 13:00:00')).toBeNull();
  });
  it('relit une ligne hors grille avec les nuits des heures : ambiguë, jamais exacte, total conservé', () => {
    // 13/01 13h -> 20/01 12h : 7 nuits par écart de dates (1 296 000 / 7 hors grille), 6 nuits par les heures (216 000 = 2 x 108 000)
    const base = { arrival: '2026-01-13', departure: '2026-01-20', total: 1296000, grid };
    expect(expandLine(base).status).toBe('unknown');
    const r = expandLine({ ...base, alternateNights: [6, 7] });
    expect(r.status).toBe('ambiguous');
    expect(r.rooms).toHaveLength(2);
    expect(r.rooms.reduce((s, x) => s + x.totalAmount, 0)).toBe(1296000);
    expect(r.rooms[0].note).toMatch(/nuits recomptées selon les heures.*6 au lieu de 7.*à vérifier/);
  });
  it("ne touche pas une ligne déjà lue par l'écart de dates", () => {
    const r = expandLine({ arrival: '2026-04-28', departure: '2026-04-30', total: 216000, grid, alternateNights: [1, 2] });
    expect(r.status).toBe('exact');
    expect(r.rooms[0].note).toMatch(/déduite du tarif/);
  });
  it('reste hors grille quand aucune lecture de secours ne colle', () => {
    const r = expandLine({ arrival: '2026-04-28', departure: '2026-04-30', total: 280000, grid, alternateNights: [1, 2] });
    expect(r.status).toBe('unknown');
    expect(r.rooms[0].note).toMatch(/hors grille/);
  });
});

describe("Règles confirmées du gérant d'Anjary (tarifs négociés, day use, demi-nuitée)", () => {
  const negotiated = [{ typeName: 'supérieur', rate: 132000 }, { typeName: 'Supérieur avec balcon', rate: 138000 }];
  const gridAnjary = buildRateGrid(TYPES, { discountDivisor: 1.06, negotiated });
  const supplements = [{ typeName: 'Standard', amount: 60000 }, { typeName: 'Supérieur', amount: 90000 }];
  const night = { arrival: '2026-05-10', departure: '2026-05-11', grid: gridAnjary, dayUseSupplements: supplements, halfNight: true };
  const three = { arrival: '2026-05-10', departure: '2026-05-13', grid: gridAnjary };

  it('lit 132 000 comme Supérieur -30 % (nom sans casse ni accents) et 138 000 comme Supérieur avec balcon -30 %', () => {
    const a = expandLine({ ...three, total: 132000 * 3 });
    expect(a.status).toBe('discounted');
    expect(a.rooms[0].roomTypeId).toBe('t-sup');
    expect(a.rooms[0].note).toMatch(/remisé à 132/);
    const b = expandLine({ ...three, total: 138000 * 3 });
    expect(b.status).toBe('discounted');
    expect(b.rooms[0].roomTypeId).toBe('t-bal');
  });
  it('garde 150 000 (Supérieur -20 %) et 102 000 (Standard -20 %) lus par le diviseur', () => {
    expect(expandLine({ ...three, total: 150000 * 3 }).rooms[0].roomTypeId).toBe('t-sup');
    expect(expandLine({ ...three, total: 102000 * 3 }).rooms[0].roomTypeId).toBe('t-std');
  });
  it("ignore un tarif négocié dont le type n'existe pas ou qui est déjà un tarif public", () => {
    const g = buildRateGrid(TYPES, { negotiated: [{ typeName: 'Suite', rate: 250000 }, { typeName: 'Supérieur', rate: 159000 }] });
    expect(g.baseOfDiscounted.size).toBe(0);
  });
  it('lit 168 000 sur une nuit comme Standard 108 000 + 60 000 de day use : ambigu, total conservé', () => {
    const r = expandLine({ ...night, total: 168000 });
    expect(r.status).toBe('ambiguous');
    expect(r.rooms).toHaveLength(1);
    expect(r.rooms[0].roomTypeId).toBe('t-std');
    expect(r.rooms[0].totalAmount).toBe(168000);
    expect(r.rooms[0].note).toMatch(/arrivée anticipée.*60[\s\u202f\u00a0]000.*à vérifier/);
  });
  it('lit 249 000 sur une nuit comme Supérieur 159 000 + 90 000 de day use', () => {
    const r = expandLine({ ...night, total: 249000 });
    expect(r.status).toBe('ambiguous');
    expect(r.rooms[0].roomTypeId).toBe('t-sup');
    expect(r.rooms[0].totalAmount).toBe(249000);
  });
  it("n'applique le day use qu'à une nuit et au type du supplément (pas de 60 000 sur un Supérieur)", () => {
    expect(expandLine({ ...night, departure: '2026-05-12', total: 168000 }).status).toBe('unknown');
    // 219 000 = 159 000 + 60 000 : le supplément Standard ne s'applique pas à un Supérieur
    expect(expandLine({ ...night, total: 219000 }).status).toBe('unknown');
    expect(expandLine({ ...night, dayUseSupplements: undefined, total: 168000, halfNight: false }).status).toBe('unknown');
  });
  it('lit une demi-nuitée : 66 000 = 132 000 / 2 (Supérieur -30 %) et 79 500 = 159 000 / 2', () => {
    const a = expandLine({ ...night, total: 66000 });
    expect(a.status).toBe('ambiguous');
    expect(a.rooms).toHaveLength(1);
    expect(a.rooms[0].roomTypeId).toBe('t-sup');
    expect(a.rooms[0].totalAmount).toBe(66000);
    expect(a.rooms[0].note).toMatch(/demi-nuitée \(50 %\).*à vérifier/);
    expect(expandLine({ ...night, total: 79500 }).rooms[0].roomTypeId).toBe('t-sup');
    // option désactivée ou séjour de 2 nuits : rien n'est deviné
    expect(expandLine({ ...night, halfNight: false, total: 66000 }).status).toBe('unknown');
    expect(expandLine({ ...night, departure: '2026-05-12', total: 66000 }).status).toBe('unknown');
  });
  it('ne change pas une ligne déjà lue au tarif public, avec toutes les options activées', () => {
    expect(expandLine({ ...night, total: 108000 }).status).toBe('exact');
  });
});

describe("Séjours à la journée d'Anjary (216 000 = 2 Standard à 108 000)", () => {
  const day = { arrival: '2026-05-10', departure: '2026-05-10', grid: buildRateGrid(TYPES, { discountDivisor: 1.06 }), sameDayAsOneNight: true };

  it('lit 216 000 un même jour comme 2 chambres Standard à 108 000, total conservé', () => {
    const r = expandLine({ ...day, total: 216000 });
    expect(r.status).toBe('exact');
    expect(r.rooms).toHaveLength(2);
    expect(r.rooms.every((x) => x.roomTypeId === 't-std')).toBe(true);
    expect(r.rooms.reduce((s, x) => s + x.totalAmount, 0)).toBe(216000);
    expect(r.rooms[0].note).toMatch(/séjour à la journée/);
  });
  it('lit 108 000 et 159 000 comme une chambre Standard et une chambre Supérieur', () => {
    expect(expandLine({ ...day, total: 108000 }).rooms[0].roomTypeId).toBe('t-std');
    expect(expandLine({ ...day, total: 159000 }).rooms[0].roomTypeId).toBe('t-sup');
  });
  it('laisse un prix hors grille à vérifier, sans deviner', () => {
    const r = expandLine({ ...day, total: 280000 });
    expect(r.status).toBe('unknown');
    expect(r.rooms[0].roomTypeId).toBeNull();
    expect(r.rooms[0].note).toMatch(/séjour à la journée.*hors grille.*à vérifier/);
  });
  it("ne change rien sans l'option, ni quand le départ précède l'arrivée", () => {
    const off = expandLine({ ...day, sameDayAsOneNight: false, total: 216000 });
    expect(off.status).toBe('unknown');
    expect(off.rooms[0].note).toMatch(/séjour à la journée : type de chambre non déterminé/);
    expect(expandLine({ ...day, departure: '2026-05-09', total: 216000 }).status).toBe('unknown');
  });
});

describe("Day use seul d'Anjary (Standard 60 000, Supérieur 90 000) et balcon -30 % à 146 000", () => {
  const g = buildRateGrid(TYPES, { discountDivisor: 1.06, negotiated: [{ typeName: 'Supérieur avec balcon', rate: 138000 }, { typeName: 'Supérieur avec balcon', rate: 146000 }] });
  const sup = [{ typeName: 'Standard', amount: 60000 }, { typeName: 'Supérieur', amount: 90000 }];
  const night = { arrival: '2026-05-10', departure: '2026-05-11', grid: g, dayUseSupplements: sup };
  const day = { arrival: '2026-05-10', departure: '2026-05-10', grid: g, dayUseSupplements: sup, sameDayAsOneNight: true };

  it('lit 146 000 et 138 000 comme Supérieur avec balcon remisé de 30 %', () => {
    const a = expandLine({ arrival: '2026-05-10', departure: '2026-05-12', total: 146000 * 2, grid: g });
    expect(a.status).toBe('discounted');
    expect(a.rooms[0].roomTypeId).toBe('t-bal');
    expect(expandLine({ arrival: '2026-05-10', departure: '2026-05-12', total: 138000 * 2, grid: g }).rooms[0].roomTypeId).toBe('t-bal');
  });
  it('lit 60 000 comme un day use Standard et 90 000 comme un day use Supérieur (une nuit ou un même jour)', () => {
    for (const base of [night, day]) {
      const a = expandLine({ ...base, total: 60000 });
      expect(a.status).toBe('ambiguous');
      expect(a.rooms[0].roomTypeId).toBe('t-std');
      expect(a.rooms[0].totalAmount).toBe(60000);
      expect(a.rooms[0].note).toMatch(/day use seul.*à vérifier/);
      expect(expandLine({ ...base, total: 90000 }).rooms[0].roomTypeId).toBe('t-sup');
    }
  });
  it('lit 120 000 comme 2 day use Standard, et laisse un montant voisin hors grille', () => {
    const a = expandLine({ ...night, total: 120000 });
    expect(a.rooms).toHaveLength(2);
    expect(a.rooms.every((x) => x.roomTypeId === 't-std')).toBe(true);
    expect(expandLine({ ...night, total: 65000 }).status).toBe('unknown');
  });
  it("n'applique pas le day use seul sur plusieurs nuits ni sans supplément configuré", () => {
    expect(expandLine({ ...night, departure: '2026-05-13', total: 60000 }).status).toBe('unknown');
    expect(expandLine({ ...night, dayUseSupplements: undefined, total: 60000 }).status).toBe('unknown');
  });
});

describe("Tarif public sans remise, Familiale sans taxe ni vignette et erreur de tarif connue d'Anjary", () => {
  const g = buildRateGrid(TYPES, { discountDivisor: 1.06, negotiated: [{ typeName: 'Supérieur', rate: 186000 }, { typeName: 'Familiale', rate: 189000 }] });
  const stay = { arrival: '2026-05-10', departure: '2026-05-12', grid: g, knownRateErrors: [{ rate: 185520, note: 'erreur de tarif dans Odoo' }] };

  it('lit 186 000 comme un Supérieur au tarif public sans remise', () => {
    const r = expandLine({ ...stay, total: 186000 * 2 });
    expect(r.status).toBe('discounted');
    expect(r.rooms[0].roomTypeId).toBe('t-sup');
    expect(r.rooms[0].note).toMatch(/tarif public sans remise/);
    expect(r.rooms[0].note).not.toMatch(/remisé à/);
  });
  it('lit 189 000 comme une Familiale (sans taxe ni vignette)', () => {
    const r = expandLine({ ...stay, total: 189000 * 2 });
    expect(r.rooms[0].roomTypeId).toBe('t-fam');
  });
  it('ne décode jamais 185 520 : erreur de tarif connue, à corriger, total conservé', () => {
    const r = expandLine({ ...stay, total: 185520 * 2 });
    expect(r.status).toBe('unknown');
    expect(r.rooms).toHaveLength(1);
    expect(r.rooms[0].roomTypeId).toBeNull();
    expect(r.rooms[0].totalAmount).toBe(185520 * 2);
    expect(r.rooms[0].note).toMatch(/erreur de tarif dans Odoo.*à corriger/);
  });
  it('sans option, 185 520 reste simplement hors grille', () => {
    const r = expandLine({ ...stay, knownRateErrors: undefined, total: 185520 * 2 });
    expect(r.status).toBe('unknown');
    expect(r.rooms[0].note).toMatch(/hors grille/);
  });
});

describe("Salle de réunion facturée par jour calendaire (200 000 par jour)", () => {
  const rule = { dailyRate: 200000, maxArrivalHour: 9, minDepartureHour: 15 };
  it('reconnaît 1, 2, 3 et 5 jours de salle (arrivée tôt, départ tard)', () => {
    expect(isDayRental('2026-04-23 07:00:00', '2026-04-23 17:00:00', 200000, rule)).toBe(true);
    expect(isDayRental('2026-06-11 08:00:00', '2026-06-12 17:00:00', 400000, rule)).toBe(true);
    expect(isDayRental('2026-04-28 08:00:00', '2026-04-30 17:00:00', 600000, rule)).toBe(true);
    expect(isDayRental('2026-07-20 08:00:00', '2026-07-24 17:00:00', 1000000, rule)).toBe(true);
  });
  it("ne prend pas une chambre : arrivée à 13 h ou départ à 11 h, même si le montant est un multiple de 200 000", () => {
    expect(isDayRental('2026-04-06 14:00:00', '2026-04-08 11:00:00', 600000, rule)).toBe(false);
    expect(isDayRental('2026-03-01 13:00:00', '2026-03-05 11:00:00', 600000, rule)).toBe(false);
  });
  it("exige que le montant corresponde exactement au nombre de jours", () => {
    expect(isDayRental('2026-06-11 08:00:00', '2026-06-12 17:00:00', 600000, rule)).toBe(false);
    expect(isDayRental('2026-06-11 08:00:00', '2026-06-11 17:00:00', 108000, rule)).toBe(false);
  });
  it('refuse sans heures, sans montant ou avec un départ avant l\'arrivée', () => {
    expect(isDayRental('2026-06-11', '2026-06-12', 400000, rule)).toBe(false);
    expect(isDayRental('2026-06-11 08:00:00', '2026-06-12 17:00:00', null, rule)).toBe(false);
    expect(isDayRental('2026-06-12 08:00:00', '2026-06-11 17:00:00', 200000, rule)).toBe(false);
  });
});
