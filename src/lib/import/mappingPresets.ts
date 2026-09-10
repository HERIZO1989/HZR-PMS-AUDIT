import type { MappingConfig, SourceSystem } from './types';

/**
 * Presets: known column headers used by common PMS export formats.
 * These are starting points — the user can still adjust the mapping in the UI
 * before validating/importing (mapping_config is stored per import_batch for traceability).
 */
export const MAPPING_PRESETS: Record<SourceSystem, MappingConfig | null> = {
  opera: {
    targetEntityType: 'reservation',
    dateFormat: 'DD-MMM-YY',
    fields: [
      { sourceField: 'Confirmation No', targetField: 'confirmation_number', required: true },
      { sourceField: 'Guest Name', targetField: 'guest_full_name' },
      { sourceField: 'Email', targetField: 'guest_email', required: true },
      { sourceField: 'Arrival', targetField: 'arrival_date', transform: 'date', required: true },
      { sourceField: 'Departure', targetField: 'departure_date', transform: 'date', required: true },
      { sourceField: 'Rate Amount', targetField: 'total_amount', transform: 'currency' },
      { sourceField: 'Market Code', targetField: 'channel' },
      { sourceField: 'Res Status', targetField: 'status' },
      { sourceField: 'Adults', targetField: 'adults' },
      { sourceField: 'Children', targetField: 'children' },
      { sourceField: 'Currency', targetField: 'currency_code' },
    ],
  },
  protel: {
    targetEntityType: 'reservation',
    dateFormat: 'DD.MM.YYYY',
    fields: [
      { sourceField: 'ResNo', targetField: 'confirmation_number', required: true },
      { sourceField: 'GuestEmail', targetField: 'guest_email', required: true },
      { sourceField: 'GuestFirstName', targetField: 'guest_first_name' },
      { sourceField: 'GuestLastName', targetField: 'guest_last_name' },
      { sourceField: 'ArrivalDate', targetField: 'arrival_date', transform: 'date', required: true },
      { sourceField: 'DepartureDate', targetField: 'departure_date', transform: 'date', required: true },
      { sourceField: 'TotalPrice', targetField: 'total_amount', transform: 'currency' },
      { sourceField: 'Source', targetField: 'channel' },
      { sourceField: 'Status', targetField: 'status' },
    ],
  },
  fidelio: null,
  generic_csv: null,
  generic_xlsx: null,
  generic_txt: null,
};

/**
 * Best-effort auto-mapping for unknown/generic sources: matches source headers
 * to canonical target fields using normalized string comparison + synonyms.
 * Always returned as a *suggestion* — the user confirms/edits before validating.
 */
const SYNONYMS: Record<string, string[]> = {
  confirmation_number: ['confirmation', 'confirmation no', 'reservation id', 'booking id', 'res no', 'resno'],
  guest_email: ['email', 'guest email', 'e-mail', 'mail'],
  guest_first_name: ['first name', 'firstname', 'prenom', 'prénom'],
  guest_last_name: ['last name', 'lastname', 'nom', 'surname'],
  arrival_date: ['arrival', 'arrival date', 'check-in', 'checkin', 'date arrivee', "date d'arrivée"],
  departure_date: ['departure', 'departure date', 'check-out', 'checkout', 'date depart', 'date de départ'],
  total_amount: ['total', 'total amount', 'rate amount', 'amount', 'montant', 'total price'],
  channel: ['channel', 'source', 'market code', 'market'],
  status: ['status', 'res status', 'statut'],
  adults: ['adults', 'pax adults', 'adultes'],
  children: ['children', 'kids', 'enfants'],
  currency_code: ['currency', 'devise'],
  phone: ['phone', 'telephone', 'tel', 'mobile'],
  first_name: ['first name', 'firstname', 'prenom', 'prénom'],
  last_name: ['last name', 'lastname', 'nom'],
  email: ['email', 'e-mail', 'mail'],
  nationality: ['nationality', 'nationalite', 'country'],
  vip_tier: ['vip', 'vip tier', 'loyalty tier'],
  loyalty_number: ['loyalty number', 'loyalty id', 'membership no'],
};

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/[_-]/g, ' ').replace(/\s+/g, ' ');
}

export function suggestMapping(headers: string[], targetEntityType: 'guest' | 'reservation'): MappingConfig {
  const fields: MappingConfig['fields'] = [];
  const usedTargets = new Set<string>();

  for (const header of headers) {
    const normalizedHeader = normalize(header);
    for (const [target, synonyms] of Object.entries(SYNONYMS)) {
      if (usedTargets.has(target)) continue;
      if (synonyms.some((s) => normalize(s) === normalizedHeader)) {
        fields.push({
          sourceField: header,
          targetField: target,
          transform: target.includes('date') ? 'date' : target === 'total_amount' ? 'currency' : undefined,
        });
        usedTargets.add(target);
        break;
      }
    }
  }

  return { targetEntityType, fields };
}
