import { describe, expect, it } from 'vitest';
import { cleanSearch, parseReservationView, viewQuery } from '../src/lib/reservationViews';

const TODAY = '2026-11-05';

describe('vues de la liste des réservations', () => {
  it('par défaut : les arrivées du jour, pas les réservations lointaines', () => {
    expect(parseReservationView(null)).toBe('today');
    expect(parseReservationView('nimporte quoi')).toBe('today');
    expect(viewQuery('today', TODAY)).toMatchObject({ arrivalEq: TODAY, statuses: ['tentative', 'confirmed', 'checked_in'], ascending: true });
  });
  it('reconnaît les cinq vues', () => {
    for (const v of ['today', 'inhouse', 'late', 'upcoming', 'all']) expect(parseReservationView(v)).toBe(v);
  });
  it('en séjour = enregistrés ; en retard = confirmés arrivés avant aujourd’hui et partant après ; à venir = arrivée après aujourd’hui', () => {
    expect(viewQuery('inhouse', TODAY).statuses).toEqual(['checked_in']);
    expect(viewQuery('late', TODAY)).toMatchObject({ statuses: ['tentative', 'confirmed'], arrivalLt: TODAY, departureGt: TODAY });
    expect(viewQuery('upcoming', TODAY)).toMatchObject({ statuses: ['tentative', 'confirmed'], arrivalGt: TODAY, ascending: true });
  });
  it('« Toutes » garde l’ancien comportement : sans filtre, les plus récentes d’abord, 100 lignes', () => {
    expect(viewQuery('all', TODAY)).toEqual({ statuses: null, ascending: false, limit: 100 });
  });
  it('la recherche retire les caractères qui casseraient le filtre', () => {
    expect(cleanSearch('  B00500-261009, (x)%_*  ')).toBe('B00500-261009   x');
    expect(cleanSearch(null)).toBe('');
    expect(cleanSearch('x'.repeat(100)).length).toBe(60);
  });
});
