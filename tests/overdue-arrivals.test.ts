import { describe, expect, it } from 'vitest';
import { classifyOverdue, findDuplicateBases, type OverdueReservation } from '../src/lib/overdueArrivals';

const res = (confirmation_number: string, arrival_date: string, room_type_id: string | null, over: Partial<OverdueReservation> = {}): OverdueReservation => ({
  id: `id-${confirmation_number}`, confirmation_number, arrival_date, departure_date: '2026-11-20', total_amount: 100000, room_type_id, typeName: room_type_id ? `Type ${room_type_id}` : null, skip_auto_check_in: false, ...over,
});

describe('classement des arrivées en retard', () => {
  it('enregistrable seulement si une chambre propre du type existe ; à la main sinon', () => {
    const rows = classifyOverdue([res('A', '2026-10-23', 'T1'), res('B', '2026-10-24', null), res('C', '2026-10-25', 'T2')], { T1: 3 }, new Set());
    expect(rows.map((r) => [r.confirmation_number, r.kind])).toEqual([['A', 'auto'], ['B', 'manual'], ['C', 'manual']]);
    expect(rows[1].reason).toBe('Type de chambre manquant : choisir une chambre');
    expect(rows[2].reason).toBe('Aucune chambre libre du type Type T2');
  });

  it('ne promet jamais deux fois la même chambre : les chambres propres sont consommées', () => {
    const rows = classifyOverdue([res('A', '2026-10-20', 'T1'), res('B', '2026-10-21', 'T1'), res('C', '2026-10-22', 'T1')], { T1: 2 }, new Set());
    expect(rows.map((r) => r.kind)).toEqual(['auto', 'auto', 'manual']);
  });

  it('les arrivées les plus anciennes passent en premier', () => {
    const rows = classifyOverdue([res('B', '2026-10-25', 'T1'), res('A', '2026-10-09', 'T1')], { T1: 1 }, new Set());
    expect(rows.map((r) => [r.confirmation_number, r.kind])).toEqual([['A', 'auto'], ['B', 'manual']]);
  });

  it('jamais automatique : check-in annulé à la main, ou bloc en doublon de lignes par chambre', () => {
    const rows = classifyOverdue([res('V', '2026-10-20', 'T1', { skip_auto_check_in: true }), res('D', '2026-10-21', 'T1')], { T1: 5 }, new Set(['D']));
    expect(rows.map((r) => [r.confirmation_number, r.kind])).toEqual([['V', 'blocked'], ['D', 'blocked']]);
    expect(rows[0].reason).toContain('Check-in annulé');
    expect(rows[1].reason).toContain('Doublon');
  });

  it('une liste vide ne produit rien', () => {
    expect(classifyOverdue([], {}, new Set())).toEqual([]);
  });
});

describe('détection des blocs en doublon', () => {
  it('reconnaît un bloc dont les lignes par chambre existent, et pas un simple numéro proche', () => {
    const all = ['B00152-261028-a4109e', 'B00152-261028-a4109e-1', 'B00152-261028-a4109e-2', 'B00200-261028-aaaaaa', 'B00200-261028-aaaaaa-bis', 'B00300-261028-bbbbbb'];
    const dup = findDuplicateBases(['B00152-261028-a4109e', 'B00200-261028-aaaaaa', 'B00300-261028-bbbbbb'], all);
    expect([...dup]).toEqual(['B00152-261028-a4109e']);
  });
  it('une ligne par chambre n’est pas elle-même un bloc en doublon', () => {
    expect(findDuplicateBases(['B1-x-aaaa-1'], ['B1-x-aaaa-1']).size).toBe(0);
  });
});
