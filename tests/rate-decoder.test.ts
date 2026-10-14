import { describe, it, expect } from 'vitest';
import { buildRateGrid, decodeRooms, expandLine, nightsBetween, type RoomTypeRate } from '../src/lib/import/rateDecoder';

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
