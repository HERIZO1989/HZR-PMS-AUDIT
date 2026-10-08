import { describe, it, expect, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { ImportService } from '../src/lib/import/importService';
import { suggestMapping, MAPPING_PRESETS } from '../src/lib/import/mappingPresets';
import { normalizeDate, normalizeCurrency } from '../src/lib/import/normalizers';
import { splitOdooName, buildOdooConfirmationNumber, isOdooGroupRow, normalizeKey } from '../src/lib/import/odoo';

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
      return { insert: async (r: any[]) => { rows.push(...r); return { error: null }; } };
    },
  };
  return { client, rows };
}

async function stage() {
  const { client } = fakeSupabase();
  return new ImportService(client).stageImport({
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
    expect(ok).toHaveLength(4); // 6 reservations - 1 sejour a la journee - 1 depart avant arrivee
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

  it('signale clairement un sejour a la journee et un depart avant l\'arrivee', async () => {
    const { results } = await stage();
    const same = results.find((r) => r.raw['Référence'] === 'B00004');
    const inverted = results.find((r) => r.raw['Référence'] === 'B00005');
    expect(same?.status).toBe('invalid');
    expect(same?.errors.join(' ')).toMatch(/à la journée/);
    expect(inverted?.status).toBe('invalid');
    expect(inverted?.errors.join(' ')).toMatch(/postérieure/);
  });
});

describe('Assistants Odoo', () => {
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
