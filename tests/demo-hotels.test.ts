import { describe, it, expect } from 'vitest';
import { isPlatformAdmin } from '../src/lib/platformAdmin';
import { parseDemoRequest, DEMO_LIMITS } from '../src/lib/demoHotels';

describe("Administrateur de la plateforme", () => {
  const env = 'owner@exemple.mg, Admin@Exemple.MG ,';
  it('autorise une adresse de la liste, sans tenir compte de la casse ni des espaces', () => {
    expect(isPlatformAdmin({ email: 'OWNER@exemple.mg' }, env)).toBe(true);
    expect(isPlatformAdmin({ email: ' admin@exemple.mg ' }, env)).toBe(true);
  });
  it('refuse toute autre adresse, y compris un compte de démonstration', () => {
    expect(isPlatformAdmin({ email: 'gm@demo.local' }, env)).toBe(false);
    expect(isPlatformAdmin({ email: 'autre@exemple.mg' }, env)).toBe(false);
  });
  it('refuse par défaut quand la variable est absente ou vide', () => {
    expect(isPlatformAdmin({ email: 'owner@exemple.mg' }, undefined)).toBe(false);
    expect(isPlatformAdmin({ email: 'owner@exemple.mg' }, '')).toBe(false);
    expect(isPlatformAdmin({ email: 'owner@exemple.mg' }, ' , ')).toBe(false);
  });
  it('refuse sans session ou sans e-mail', () => {
    expect(isPlatformAdmin(null, env)).toBe(false);
    expect(isPlatformAdmin({ email: '' }, env)).toBe(false);
  });
  it("n'accepte pas une adresse qui contient seulement celle de la liste", () => {
    expect(isPlatformAdmin({ email: 'xowner@exemple.mg' }, env)).toBe(false);
    expect(isPlatformAdmin({ email: 'owner@exemple.mg.evil.com' }, env)).toBe(false);
  });
});

describe('Validation de la demande de création', () => {
  it('applique les valeurs par défaut et nettoie le nom', () => {
    const r = parseDemoRequest({ hotelName: '  Grand   Hôtel  Démo ' });
    expect(r).toEqual({ ok: true, value: { hotelName: 'Grand Hôtel Démo', currency: 'EUR', rooms: 40, guests: 60, reservations: 120 } });
  });
  it('accepte les bornes exactes', () => {
    expect(parseDemoRequest({ hotelName: 'Hôtel', rooms: DEMO_LIMITS.rooms.max, guests: DEMO_LIMITS.guests.min, reservations: 0 }).ok).toBe(true);
  });
  it('refuse un nom trop court ou trop long', () => {
    expect(parseDemoRequest({ hotelName: 'A' }).ok).toBe(false);
    expect(parseDemoRequest({ hotelName: 'x'.repeat(81) }).ok).toBe(false);
    expect(parseDemoRequest({}).ok).toBe(false);
  });
  it('refuse les nombres hors bornes, décimaux ou non numériques', () => {
    for (const bad of [{ rooms: 4 }, { rooms: 201 }, { guests: 501 }, { reservations: -1 }, { reservations: 2001 }, { rooms: 10.5 }, { rooms: 'abc' }]) {
      const r = parseDemoRequest({ hotelName: 'Hôtel', ...bad });
      expect(r.ok, JSON.stringify(bad)).toBe(false);
    }
  });
  it('accepte EUR et MGA et refuse toute autre devise', () => {
    expect(parseDemoRequest({ hotelName: 'Hôtel', currency: 'MGA' })).toMatchObject({ ok: true, value: { currency: 'MGA' } });
    expect(parseDemoRequest({ hotelName: 'Hôtel', currency: 'EUR' })).toMatchObject({ ok: true, value: { currency: 'EUR' } });
    for (const bad of ['USD', 'mga', 'toString', '__proto__', 12]) {
      expect(parseDemoRequest({ hotelName: 'Hôtel', currency: bad }).ok, String(bad)).toBe(false);
    }
  });
  it('refuse un corps invalide', () => {
    expect(parseDemoRequest(null).ok).toBe(false);
    expect(parseDemoRequest('texte').ok).toBe(false);
  });
});
