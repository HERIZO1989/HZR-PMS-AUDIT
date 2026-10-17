import { describe, it, expect, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { ImportService } from '../src/lib/import/importService';
import { suggestMapping, MAPPING_PRESETS } from '../src/lib/import/mappingPresets';
import { normalizeDate, normalizeCurrency } from '../src/lib/import/normalizers';
import { splitOdooName, buildOdooConfirmationNumber, isOdooGroupRow, normalizeKey, ODOO_STATUS_MAP } from '../src/lib/import/odoo';
import { validateEntity } from '../src/lib/import/validators';

// Tests purs (aucune base requise). Le classeur de test reproduit la structure de l'export reel d'Anjary
// (liste groupee par statut, cellules de date, montants formates) avec des donnees entierement fictives.
const svc = Object.create(ImportService.prototype) as ImportService;

const HEADERS = ['Référence', 'Nom du Client', 'Vendeur', "Date d'entrée", 'Date de sortie', 'Montant total', 'Devise', 'Status', 'Statut de la facture', 'Statut du paiement', 'Acompte'];

function buildWorkbook(): Buffer {
  const d = (s: string) => new Date(s + 'Z');
  const rows: unknown[][] = [
    HEADERS,
    ['checkout (3)', null, null, null, null, 700000, null, null, null, null, null],
    ['B00001', 'DUPONT Marie', 'Réception', d('2026-04-28T12:00:00'), d('2026-04-30T11:00:00'), 216000, 'MGA', 'Sortie', 'Entièrement facturé', 'Payé', 'Non'],
    ['B00001', 'MARTIN Paul Henri', 'Réception', d('2026-04-28T12:00:00'), d('2026-04-30T11:00:00'), 216000, 'MGA', 'Sortie', 'Entièrement facturé', 'Payé', 'Non'], // meme reference, meme dates, autre client
    ['B00002', 'ATELIER SARL EXEMPLE', 'Miora', d('2026-05-02T12:00:00'), d('2026-05-09T11:00:00'), 268000.5, 'MGA', 'Sortie', 'À facturer', 'Non payé', 'Oui'],
    ['confirm (2)', null, null, null, null, 400000, null, null, null, null, null],
    ['B00003', 'LEROY Anne', 'Réception', d('2026-11-02T12:00:00'), d('2026-11-04T11:00:00'), null, 'MGA', 'Confirmé', 'Rien à facturer', 'Pas de facture', 'Non'],
    ['B00004', 'DURAND Luc', 'Réception', d('2026-06-10T13:00:00'), d('2026-06-10T11:00:00'), 108000, 'MGA', 'Confirmé', 'Rien à facturer', 'Pas de facture', 'Non'], // meme jour
    ['lock (1)', null, null, null, null, 1, null, null, null, null, null],
    ['B00005', 'PETIT Jean', 'Réception', d('2026-04-30T20:00:00'), d('2026-04-02T11:00:00'), 159000, 'MGA', 'Verrouiller', 'À facturer', 'Pas de facture', 'Non'], // depart avant arrivee
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows, { cellDates: true });
  for (const addr of Object.keys(ws)) {
    const c = ws[addr] as XLSX.CellObject;
    if (addr[0] === '!') continue;
    if (c.t === 'd') c.z = 'yyyy-mm-dd hh:mm:ss';
    if (c.t === 'n' && /^F/.test(addr)) c.z = '#,##0.00';
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

let roomTypes: any[] = [];
function fakeSupabase() {
  const rows: any[] = [];
  const client: any = {
    from(t: string) {
      if (t === 'import_batches') {
        return {
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'b1' }, error: null }) }) }),
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      }
      if (t === 'room_types') return { select: () => ({ eq: async () => ({ data: roomTypes, error: null }) }) };
      return { insert: async (r: any[]) => { rows.push(...r); return { error: null }; } };
    },
  };
  return { client, rows };
}

async function stage(scope?: { departureFrom?: string }) {
  const { client } = fakeSupabase();
  return new ImportService(client).stageImport({
    scope,
    ctx: { tenantId: 't', hotelId: 'h', uploadedBy: 'u' },
    fileName: 'export.xlsx', fileType: 'xlsx', sourceSystem: 'odoo', content: buildWorkbook(), targetEntityType: 'reservation',
  });
}

describe('Preset Odoo (colonnes de l\'export reel)', () => {
  it('est retenu avec les en-tetes reels', () => {
    expect(svc.resolveMapping(HEADERS, 'odoo', 'reservation')).toBe(MAPPING_PRESETS.odoo);
  });

  it('retombe sur les synonymes quand les en-tetes different (export en anglais)', () => {
    const m = svc.resolveMapping(['Reference', 'Customer', 'Email', 'Check-in', 'Check-out', 'Total'], 'odoo', 'reservation');
    const t = Object.fromEntries(m.fields.map((f) => [f.targetField, f.sourceField]));
    expect(t).toMatchObject({ confirmation_number: 'Reference', guest_full_name: 'Customer', arrival_date: 'Check-in', departure_date: 'Check-out' });
  });

  it("reconnait aussi les libelles Odoo par synonymes (« Date d'entrée », « Montant total »)", () => {
    const m = suggestMapping(['Référence', 'Nom du Client', "Date d'entrée", 'Date de sortie', 'Montant total', 'Status'], 'reservation');
    expect(m.fields.map((f) => f.targetField).sort()).toEqual(['arrival_date', 'confirmation_number', 'departure_date', 'guest_full_name', 'status', 'total_amount']);
  });

  it('ne change pas les presets Opera/Protel', () => {
    expect(svc.resolveMapping(['Confirmation No', 'Guest Name', 'Email', 'Arrival', 'Departure'], 'opera', 'reservation')).toBe(MAPPING_PRESETS.opera);
  });
});

describe('Import Odoo de bout en bout (classeur fictif)', () => {
  it('ignore les lignes de regroupement et ne les compte pas comme erreurs', async () => {
    const { results } = await stage();
    expect(results).toHaveLength(9); // 3 regroupements + 6 reservations
    expect(results.filter((r) => r.status === 'skipped')).toHaveLength(3);
    expect(results.find((r) => r.raw['Référence'] === 'checkout (3)')?.status).toBe('skipped');
  });

  it('importe les reservations sans e-mail et normalise dates, montants, devise et statuts', async () => {
    const { results } = await stage();
    const ok = results.filter((r) => r.status === 'valid').map((r) => r.normalized as any);
    expect(ok).toHaveLength(5); // 6 reservations - 1 depart avant arrivee (le sejour a la journee est accepte)
    const dupont = ok.find((o) => o.guest_last_name === 'DUPONT');
    expect(dupont).toMatchObject({ guest_first_name: 'Marie', arrival_date: '2026-04-28', departure_date: '2026-04-30', total_amount: 216000, currency_code: 'MGA', status: 'checked_out' });
    expect(dupont.guest_email).toBeUndefined();
    expect(ok.find((o) => o.guest_last_name === 'ATELIER SARL EXEMPLE')).toMatchObject({ guest_first_name: '', total_amount: 268000.5 });
    expect(ok.find((o) => o.guest_last_name === 'LEROY')).toMatchObject({ status: 'confirmed', total_amount: null });
  });

  it('donne un numero de confirmation unique meme quand la reference Odoo est reutilisee', async () => {
    const { results } = await stage();
    const numbers = results.filter((r) => r.status === 'valid').map((r) => (r.normalized as any).confirmation_number);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(numbers.filter((n: string) => n.startsWith('B00001-'))).toHaveLength(2);
  });

  it("importe un sejour a la journee comme tel et refuse toujours un depart avant l'arrivee", async () => {
    const { results } = await stage();
    const same = results.find((r) => r.raw['Référence'] === 'B00004');
    const inverted = results.find((r) => r.raw['Référence'] === 'B00005');
    expect(same?.status).toBe('valid');
    expect((same?.normalized as any).stay_type).toBe('day_use');
    expect(results.filter((r) => r.status === 'valid' && (r.normalized as any).stay_type === 'day_use')).toHaveLength(1);
    expect(inverted?.status).toBe('invalid');
    expect(inverted?.errors.join(' ')).toMatch(/postérieure/);
  });
});

describe('Periode importee', () => {
  it("ignore les sejours termines avant la date choisie, erreurs comprises", async () => {
    const { results } = await stage({ departureFrom: '2026-06-01' });
    const byRef = (ref: string) => results.find((r) => r.raw['Référence'] === ref)!;
    expect(byRef('B00001').status).toBe('skipped');           // depart 30/04
    expect(byRef('B00002').status).toBe('skipped');           // depart 09/05
    expect(byRef('B00005').status).toBe('skipped');           // depart 02/04 : erreur sans importance, hors periode
    expect(byRef('B00005').errors.join(' ')).toMatch(/hors période/);
    expect(byRef('B00003').status).toBe('valid');             // depart 04/11
    expect(byRef('B00004').status).toBe('valid');             // depart 10/06 (jour meme, jour d'usage)
    expect(results.filter((r) => r.status === 'valid')).toHaveLength(2);
  });

  it("garde un sejour qui part le jour meme de la date choisie", async () => {
    const { results } = await stage({ departureFrom: '2026-06-10' });
    expect(results.find((r) => r.raw['Référence'] === 'B00004')?.status).toBe('valid');
  });

  it('sans periode, tout est conserve', async () => {
    const { results } = await stage();
    expect(results.filter((r) => r.status === 'skipped')).toHaveLength(3); // seulement les regroupements
  });
});

describe('Validation du sejour a la journee', () => {
  const base = { confirmation_number: 'X', guest_first_name: 'A', guest_last_name: 'B', arrival_date: '2026-06-10', departure_date: '2026-06-10' };
  it('refuse arrivee = depart sans type day_use (autres sources)', () => {
    expect(validateEntity('reservation', base).join(' ')).toMatch(/à la journée/);
  });
  it('accepte arrivee = depart avec stay_type day_use', () => {
    expect(validateEntity('reservation', { ...base, stay_type: 'day_use' })).toEqual([]);
  });
  it('refuse un depart anterieur meme en day_use', () => {
    expect(validateEntity('reservation', { ...base, departure_date: '2026-06-09', stay_type: 'day_use' }).join(' ')).toMatch(/postérieure/);
  });
});

describe('Assistants Odoo', () => {
  it('lit « Verrouiller » comme un sejour parti et garde les autres statuts', () => {
    expect(ODOO_STATUS_MAP[normalizeKey('Verrouiller')]).toBe('checked_out');
    expect(ODOO_STATUS_MAP[normalizeKey('Attribué')]).toBe('confirmed');
    expect(ODOO_STATUS_MAP[normalizeKey('Brouillon')]).toBe('tentative');
  });

  it('detecte les lignes de regroupement', () => {
    expect(isOdooGroupRow('checkout (4219)', null, null, null)).toBe(true);
    expect(isOdooGroupRow('B00045', 'DUPONT Marie', '2026-04-28', '2026-04-30')).toBe(false);
    expect(isOdooGroupRow('B00045', null, null, null)).toBe(false); // pas de « (nombre) » : vraie ligne incomplete
  });

  it('separe « NOM Prenom » selon la convention de la base', () => {
    expect(splitOdooName('DUPONT Marie')).toEqual({ last: 'DUPONT', first: 'Marie' });
    expect(splitOdooName('MARTIN DE LA TOUR Paul Henri')).toEqual({ last: 'MARTIN DE LA TOUR', first: 'Paul Henri' });
    expect(splitOdooName('RAKOTO ANDRY')).toEqual({ last: 'RAKOTO', first: 'Andry' });
    expect(splitOdooName('YELLAPAH-CHETTY Venoo')).toEqual({ last: 'YELLAPAH-CHETTY', first: 'Venoo' });
    expect(splitOdooName('Ludovic Isidore')).toEqual({ last: 'Isidore', first: 'Ludovic' });
    expect(splitOdooName('Enelec')).toEqual({ last: 'Enelec', first: '' });
    expect(splitOdooName('ASSOCIATION DE TRAIL')).toEqual({ last: 'ASSOCIATION DE TRAIL', first: '' });
    expect(splitOdooName('IHF TROPHY JEUNES 2026')).toEqual({ last: 'IHF TROPHY JEUNES 2026', first: '' });
  });

  it('construit un numero reproductible qui depend de la reference, des dates et du client', () => {
    const a = buildOdooConfirmationNumber('B00001', '2026-04-28 12:00:00', '2026-04-30 11:00:00', 'DUPONT Marie');
    expect(a).toBe(buildOdooConfirmationNumber('B00001', '2026-04-28 12:00:00', '2026-04-30 11:00:00', 'dupont marie'));
    expect(a).toMatch(/^B00001-260428-[0-9a-f]{6}$/);
    expect(a).not.toBe(buildOdooConfirmationNumber('B00001', '2026-04-28 12:00:00', '2026-04-30 11:00:00', 'MARTIN Paul'));
  });

  it('compare les statuts sans accents ni casse', () => {
    expect(normalizeKey('Confirmé')).toBe('confirme');
    expect(normalizeKey(' Attribué ')).toBe('attribue');
  });

  it('normalise les dates-heures Odoo et les montants formates', () => {
    expect(normalizeDate('2026-10-03 14:00:00', 'YYYY-MM-DD')).toBe('2026-10-03');
    expect(normalizeCurrency('11,960,400.00')).toBe(11960400);
    expect(normalizeCurrency('1 930 000,00')).toBe(1930000);
  });
});

describe("Application d'un lot par tranches", () => {
  it('rappelle la fonction SQL jusqu\'a ce qu\'il ne reste rien et retourne les compteurs du lot', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: [{ processed: 500, remaining: 700, imported: 500, invalid: 3, skipped: 6 }], error: null })
      .mockResolvedValueOnce({ data: [{ processed: 500, remaining: 200, imported: 1000, invalid: 3, skipped: 6 }], error: null })
      .mockResolvedValueOnce({ data: [{ processed: 200, remaining: 0, imported: 1200, invalid: 3, skipped: 6 }], error: null });
    const result = await new ImportService({ rpc } as any).applyBatch('b1');
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc).toHaveBeenCalledWith('apply_import_batch_chunk', { p_batch_id: 'b1', p_limit: 500 });
    expect(result).toEqual({ imported: 1200, invalid: 3, skipped: 6 });
  });

  it('remonte une erreur SQL au lieu de boucler', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(new ImportService({ rpc } as any).applyBatch('b1')).rejects.toThrow(/boom/);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('s\'arrete avec un message clair si le lot ne se vide jamais', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ processed: 500, remaining: 99, imported: 1, invalid: 0, skipped: 0 }], error: null });
    await expect(new ImportService({ rpc } as any).applyBatch('b1')).rejects.toThrow(/trop volumineux/);
    expect(rpc).toHaveBeenCalledTimes(100);
  });
});

describe('Import Odoo : chambres déduites du tarif', () => {
  const TYPES = [
    { id: 't-std', name: 'Standard', base_rate: 108000 },
    { id: 't-sup', name: 'Supérieur', base_rate: 159000 },
  ];
  function workbook(lines: [string, string, string, string, number][]): Buffer {
    const d = (s: string) => new Date(s + 'Z');
    const rows: unknown[][] = [HEADERS, ...lines.map(([ref, client, arr, dep, total]) => [ref, client, 'Réception', d(arr), d(dep), total, 'MGA', 'Confirmé', 'Rien à facturer', 'Pas de facture', 'Non'])];
    const ws = XLSX.utils.aoa_to_sheet(rows, { cellDates: true });
    for (const addr of Object.keys(ws)) { const c = ws[addr] as XLSX.CellObject; if (addr[0] !== '!' && c.t === 'd') c.z = 'yyyy-mm-dd hh:mm:ss'; }
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'S'); return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }
  async function stageWith(lines: [string, string, string, string, number][], types = TYPES) {
    roomTypes = types;
    const { client } = fakeSupabase();
    return new ImportService(client).stageImport({
      ctx: { tenantId: 't', hotelId: 'h', uploadedBy: 'u' }, fileName: 'e.xlsx', fileType: 'xlsx', sourceSystem: 'odoo', content: workbook(lines), targetEntityType: 'reservation',
    });
  }

  it('crée une réservation par chambre, avec son type, et conserve le total de la ligne', async () => {
    const { results, roomDecode } = await stageWith([
      ['B1', 'DUPONT Marie', '2026-10-20 12:00:00', '2026-10-22 11:00:00', 636000], // 2 nuits x 318 000 = 2 x Supérieur
      ['B2', 'MARTIN Paul', '2026-10-20 12:00:00', '2026-10-21 11:00:00', 108000],   // 1 Standard
      ['B3', 'LEROY Anne', '2026-10-20 12:00:00', '2026-10-22 11:00:00', 280000],    // 140 000 : hors grille
      ['B4', 'PETIT Jean', '2026-10-20 12:00:00', '2026-10-22 11:00:00', 300000],    // 150 000 = Supérieur 159 000 remisé
    ]);
    const valid = results.filter((r) => r.status === 'valid').map((r) => r.normalized as any);
    expect(valid).toHaveLength(5); // 2 + 1 + 1 + 1
    const dupont = valid.filter((v) => v.guest_last_name === 'DUPONT');
    expect(dupont).toHaveLength(2);
    expect(dupont.every((v) => v.room_type_id === 't-sup')).toBe(true);
    expect(dupont.reduce((s: number, v: any) => s + v.total_amount, 0)).toBe(636000);
    expect(new Set(valid.map((v) => v.confirmation_number)).size).toBe(5); // numéros tous distincts
    expect(dupont[0].confirmation_number.endsWith('-1') && dupont[1].confirmation_number.endsWith('-2')).toBe(true);
    const martin = valid.find((v) => v.guest_last_name === 'MARTIN');
    expect(martin).toMatchObject({ room_type_id: 't-std', total_amount: 108000 });
    expect(martin.confirmation_number).not.toMatch(/-1$/); // une seule chambre : numéro inchangé
    const leroy = valid.find((v) => v.guest_last_name === 'LEROY');
    expect(leroy.room_type_id).toBeUndefined();
    expect(leroy.special_requests).toMatch(/hors grille/);
    const petit = valid.find((v) => v.guest_last_name === 'PETIT');
    expect(petit).toMatchObject({ room_type_id: 't-sup', total_amount: 300000 });
    expect(petit.special_requests).toMatch(/tarif remisé \(Supérieur 159\s000 remisé à 150\s000/);
    expect(roomDecode).toEqual({ exact: 2, discounted: 1, ambiguous: 0, unknown: 1, rooms: 5 });
  });

  it("relit les nuits selon les heures quand l'écart de dates ne colle pas à la grille, et le signale à vérifier", async () => {
    // 13/01 13h -> 20/01 12h : 7 nuits par les dates (hors grille), 6 nuits par les heures = 2 x Standard à 108 000
    const { results, roomDecode } = await stageWith([['B9', 'DURAND Luc', '2026-01-13 13:00:00', '2026-01-20 12:00:00', 1296000]]);
    const valid = results.filter((r) => r.status === 'valid').map((r) => r.normalized as any);
    expect(valid).toHaveLength(2);
    expect(valid.every((v) => v.room_type_id === 't-std')).toBe(true);
    expect(valid.reduce((s: number, v: any) => s + v.total_amount, 0)).toBe(1296000);
    expect(valid[0].special_requests).toMatch(/nuits recomptées selon les heures/);
    expect(roomDecode).toEqual({ exact: 0, discounted: 0, ambiguous: 1, unknown: 0, rooms: 2 });
  });

  it("ignore une location de salle de réunion (200 000 par jour) au lieu de créer un séjour, sans toucher aux vraies chambres", async () => {
    const { results } = await stageWith([
      ['B1', 'GIZ Prodecid', '2026-10-20 08:00:00', '2026-10-21 08:00:00', 200000],    // 1 jour de salle
      ['B2', 'CROIX ROUGE', '2026-10-20 08:00:00', '2026-10-23 08:00:00', 600000],     // 3 jours de salle : 200 000 par jour
      ['B3', 'MARTIN Paul', '2026-10-20 12:00:00', '2026-10-21 11:00:00', 108000],     // une vraie chambre Standard
      ['B4', 'LEROY Anne', '2026-10-20 12:00:00', '2026-10-21 11:00:00', 199000],      // proche mais différent : n'est pas une salle
    ]);
    const skipped = results.filter((r) => r.status === 'skipped');
    expect(skipped).toHaveLength(2);
    expect(skipped.every((r) => r.normalized === null && /salle de réunion.*hors hébergement/.test(r.errors[0]))).toBe(true);
    expect(skipped.map((r) => r.rowNumber).length).toBe(2);
    const valid = results.filter((r) => r.status === 'valid').map((r) => r.normalized as any);
    expect(valid.map((v) => v.guest_last_name).sort()).toEqual(['LEROY', 'MARTIN']);
  });

  it('un réimport du même fichier donne les mêmes numéros', async () => {
    const lines: [string, string, string, string, number][] = [['B1', 'DUPONT Marie', '2026-10-20 12:00:00', '2026-10-22 11:00:00', 636000]];
    const a = (await stageWith(lines)).results.map((r) => (r.normalized as any).confirmation_number);
    const b = (await stageWith(lines)).results.map((r) => (r.normalized as any).confirmation_number);
    expect(a).toEqual(b);
  });

  it("n'expanse rien quand l'hôtel n'a aucun type de chambre avec un tarif", async () => {
    const { results, roomDecode } = await stageWith([['B1', 'DUPONT Marie', '2026-10-20 12:00:00', '2026-10-22 11:00:00', 636000]], []);
    expect(roomDecode).toBeUndefined();
    expect(results.filter((r) => r.status === 'valid')).toHaveLength(1);
  });
});
