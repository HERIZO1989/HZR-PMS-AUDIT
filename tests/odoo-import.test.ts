import { describe, it, expect } from 'vitest';
import { ImportService } from '../src/lib/import/importService';
import { suggestMapping, MAPPING_PRESETS } from '../src/lib/import/mappingPresets';
import { normalizeDate, normalizeCurrency } from '../src/lib/import/normalizers';

// Tests purs (aucune base requise) : preset Odoo, repli par synonymes, normalisation.
const svc = Object.create(ImportService.prototype) as ImportService;

describe('Import Odoo', () => {
  it('retient le preset quand les en-tetes requis sont presents', () => {
    const headers = ['Référence', 'Client', 'Email', 'Arrivée', 'Départ', 'Total', 'Statut'];
    const m = svc.resolveMapping(headers, 'odoo', 'reservation');
    expect(m).toBe(MAPPING_PRESETS.odoo);
  });

  it('retombe sur les synonymes quand les en-tetes different (export en anglais)', () => {
    const headers = ['Reference', 'Customer', 'Email', 'Check-in', 'Check-out', 'Total'];
    const m = svc.resolveMapping(headers, 'odoo', 'reservation');
    const targets = Object.fromEntries(m.fields.map((f) => [f.targetField, f.sourceField]));
    expect(targets.confirmation_number).toBe('Reference');
    expect(targets.guest_full_name).toBe('Customer');
    expect(targets.arrival_date).toBe('Check-in');
    expect(targets.departure_date).toBe('Check-out');
  });

  it('suggestMapping reconnait les libelles francais Odoo', () => {
    const m = suggestMapping(['Référence', 'Client', 'Courriel', 'Arrivée', 'Départ'], 'reservation');
    expect(m.fields.map((f) => f.targetField).sort()).toEqual(
      ['arrival_date', 'confirmation_number', 'departure_date', 'guest_email', 'guest_full_name']
    );
  });

  it('normalise les dates-heures Odoo et les montants en Ariary', () => {
    expect(normalizeDate('2026-10-03 14:00:00', 'YYYY-MM-DD')).toBe('2026-10-03');
    expect(normalizeCurrency('1 930 000,00')).toBe(1930000);
  });

  it('ne change pas le comportement des presets Opera/Protel complets', () => {
    const opera = ['Confirmation No', 'Guest Name', 'Email', 'Arrival', 'Departure'];
    expect(svc.resolveMapping(opera, 'opera', 'reservation')).toBe(MAPPING_PRESETS.opera);
  });
});
