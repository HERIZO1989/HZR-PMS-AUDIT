import { describe, expect, it } from 'vitest';
import { AUTO_CHECK_IN_FROM_HOUR, localDateHour, shouldRunAutoCheckIn, summarizeAutoCheckIn } from '../src/lib/autoCheckIn';

describe('heure locale de l’hôtel', () => {
  it('Madagascar (UTC+3) : le jour local peut précéder ou suivre le jour UTC', () => {
    expect(localDateHour(new Date('2026-10-28T09:20:00Z'), 'Indian/Antananarivo')).toEqual({ date: '2026-10-28', hour: 12 });
    expect(localDateHour(new Date('2026-10-28T22:30:00Z'), 'Indian/Antananarivo')).toEqual({ date: '2026-10-29', hour: 1 });
    expect(localDateHour(new Date('2026-10-28T21:00:00Z'), 'Indian/Antananarivo')).toEqual({ date: '2026-10-29', hour: 0 });
  });
  it('gère minuit sans « 24 » et un autre fuseau', () => {
    expect(localDateHour(new Date('2026-10-28T21:05:00Z'), 'Indian/Antananarivo').hour).toBe(0);
    expect(localDateHour(new Date('2026-07-01T10:00:00Z'), 'Europe/Paris')).toEqual({ date: '2026-07-01', hour: 12 });
    expect(localDateHour(new Date('2026-10-28T09:00:00Z'), 'UTC')).toEqual({ date: '2026-10-28', hour: 9 });
  });
});

describe('quand la routine enregistre les arrivées', () => {
  it('seulement à partir de l’heure d’arrivée habituelle', () => {
    expect(AUTO_CHECK_IN_FROM_HOUR).toBe(12);
    expect([0, 3, 11].map(shouldRunAutoCheckIn)).toEqual([false, false, false]);
    expect([12, 14, 23].map(shouldRunAutoCheckIn)).toEqual([true, true, true]);
  });
  it('la routine toutes les 2 h (20 min après l’heure paire UTC) passe bien à 13 h 20 locale', () => {
    // GitHub Actions : '20 */2 * * *' => 10:20 UTC = 13:20 à Madagascar ; 08:20 UTC = 11:20 (trop tôt)
    expect(shouldRunAutoCheckIn(localDateHour(new Date('2026-10-28T08:20:00Z'), 'Indian/Antananarivo').hour)).toBe(false);
    expect(shouldRunAutoCheckIn(localDateHour(new Date('2026-10-28T10:20:00Z'), 'Indian/Antananarivo').hour)).toBe(true);
  });
});

describe('résumé du lot', () => {
  it('liste enregistrées, ignorées et à faire à la main sans bruit', () => {
    expect(summarizeAutoCheckIn({ checked_in: 11, skipped: 2, failed: 1 })).toBe('11 enregistrée(s), 2 ignorée(s), 1 à faire à la main');
    expect(summarizeAutoCheckIn({ checked_in: 3, skipped: 0, failed: 0 })).toBe('3 enregistrée(s)');
    expect(summarizeAutoCheckIn({ checked_in: 0, skipped: 0, failed: 0 })).toBe('0 enregistrée(s)');
  });
});
