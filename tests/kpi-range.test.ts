import { describe, expect, it } from 'vitest';
import { MAX_KPI_RANGE_DAYS, rangeFromStays, resolveKpiRange } from '../src/lib/kpiRange';

const TODAY = '2026-10-25';

describe('plage de recalcul demandée', () => {
  it('accepte une plage valide et ramène la fin à aujourd’hui', () => {
    expect(resolveKpiRange('2026-01-01', '2026-10-25', TODAY)).toEqual({ ok: true, from: '2026-01-01', to: '2026-10-25' });
    expect(resolveKpiRange('2026-10-01', '2027-03-01', TODAY)).toEqual({ ok: true, from: '2026-10-01', to: '2026-10-25' });
  });
  it('refuse les dates absentes, impossibles ou inversées', () => {
    for (const [f, t] of [[undefined, '2026-10-01'], ['2026-13-01', '2026-10-01'], ['2026-02-30', '2026-03-01'], ['hier', 'aujourd’hui'], ['2026-10-20', '2026-10-01']] as const) {
      expect(resolveKpiRange(f, t, TODAY).ok).toBe(false);
    }
  });
  it('refuse une plage de plus de 400 jours et accepte exactement 400', () => {
    expect(resolveKpiRange('2025-01-01', '2026-10-25', TODAY)).toMatchObject({ ok: false });
    expect(resolveKpiRange('2025-09-21', '2026-10-25', TODAY)).toMatchObject({ ok: true });   // 400 jours inclus
    expect(resolveKpiRange('2025-09-20', '2026-10-25', TODAY)).toMatchObject({ ok: false });  // 401 jours
  });
});

describe('plage déduite des séjours importés', () => {
  it('va de la première arrivée au dernier départ, sans dépasser aujourd’hui', () => {
    expect(rangeFromStays([
      { arrival_date: '2026-01-10', departure_date: '2026-01-12' }, { arrival_date: '2026-10-20', departure_date: '2026-10-22' }, { arrival_date: '2027-03-01', departure_date: '2027-03-05' },
    ], TODAY)).toEqual({ from: '2026-01-10', to: '2026-10-25' });
  });
  it('ignore les lignes sans dates et renvoie null s’il n’y a rien à recalculer', () => {
    expect(rangeFromStays([], TODAY)).toBeNull();
    expect(rangeFromStays([{ arrival_date: '', departure_date: '' }], TODAY)).toBeNull();
    expect(rangeFromStays([{ arrival_date: '2027-03-01', departure_date: '2027-03-05' }], TODAY)).toBeNull();   // séjours entièrement à venir
  });
  it('garde les 400 jours les plus récents quand l’historique est plus long', () => {
    const r = rangeFromStays([{ arrival_date: '2024-01-01', departure_date: '2026-10-10' }], TODAY)!;
    expect(r.to).toBe('2026-10-10');
    expect((Date.parse(r.to) - Date.parse(r.from)) / 86400000 + 1).toBe(MAX_KPI_RANGE_DAYS);
  });
});
