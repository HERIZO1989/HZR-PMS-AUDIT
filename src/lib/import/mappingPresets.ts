import type { MappingConfig, SourceSystem } from './types';
import { ODOO_STATUS_MAP } from './odoo';

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
  odoo: {
    // Export Odoo reel d'Anjary (liste des reservations, interface francaise, groupee par statut).
    // Pas d'e-mail ni d'adultes/enfants dans cet export : le client est identifie par son nom.
    targetEntityType: 'reservation',
    dateFormat: 'YYYY-MM-DD',
    fields: [
      { sourceField: 'Référence', targetField: 'confirmation_number', required: true },
      { sourceField: 'Nom du Client', targetField: 'guest_full_name', required: true },
      { sourceField: "Date d'entrée", targetField: 'arrival_date', transform: 'date', required: true },
      { sourceField: 'Date de sortie', targetField: 'departure_date', transform: 'date', required: true },
      { sourceField: 'Montant total', targetField: 'total_amount', transform: 'currency' },
      { sourceField: 'Devise', targetField: 'currency_code' },
      { sourceField: 'Status', targetField: 'status' },
    ],
    statusMap: ODOO_STATUS_MAP,
    options: { skipGroupRows: true, uniqueConfirmationNumber: true, splitNameLastFirst: true, allowDayUse: true, inferRoomsFromRate: true, discountedRateDivisor: 1.06,
      // Grille deja a -15 % : remises sur le tarif public. 150 000 = Superieur -20 %, 102 000 = Standard -20 % (couverts par le diviseur),
      // 132 000 = Superieur -30 %, 138 000 et 146 000 = Superieur avec balcon -30 % (regles du gerant, 2026-10-16).
      negotiatedRates: [
        { typeName: 'Supérieur', rate: 132000, label: '-30 %' },
        { typeName: 'Supérieur avec balcon', rate: 138000, label: '-30 %' },
        { typeName: 'Supérieur avec balcon', rate: 146000, label: '-30 %' },
        { typeName: 'Supérieur', rate: 186000, label: 'tarif public sans remise' },
        { typeName: 'Familiale', rate: 189000, label: 'sans taxe ni vignette (6 000)' },
      ],
      // Day use : Standard 60 000, Superieur 90 000. Seul (60 000, 90 000) ou avec la nuitee (168 000 = 108 000 + 60 000 ; 249 000 = 159 000 + 90 000), sejour d'une nuit.
      dayUseSupplements: [{ typeName: 'Standard', amount: 60000 }, { typeName: 'Supérieur', amount: 90000 }],
      // Demi-nuitee : 66 000 = 132 000 / 2 ; 79 500 = 159 000 / 2.
      halfNight: true,
      // 185 520 par nuit : erreur de tarif dans Odoo, a corriger a la source (jamais decode).
      knownRateErrors: [{ rate: 185520, note: 'erreur de tarif dans Odoo' }],
      // Sejour a la journee : 216 000 = 2 Standard a 108 000 (regle du gerant).
      sameDayAsOneNight: true },
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
  confirmation_number: ['confirmation', 'confirmation no', 'reservation id', 'booking id', 'res no', 'resno', 'référence', 'reference', 'numéro de réservation', 'n° réservation'],
  guest_full_name: ['client', 'customer', 'nom du client', 'guest', 'guest name', 'nom complet'],
  guest_email: ['email', 'guest email', 'e-mail', 'mail', 'courriel', 'client/email', 'client/courriel'],
  guest_first_name: ['first name', 'firstname', 'prenom', 'prénom'],
  guest_last_name: ['last name', 'lastname', 'nom', 'surname'],
  arrival_date: ['arrival', 'arrival date', 'check-in', 'checkin', 'date arrivee', "date d'arrivée", 'arrivée', "date d'entrée"],
  departure_date: ['departure', 'departure date', 'check-out', 'checkout', 'date depart', 'date de départ', 'départ', 'date de sortie'],
  total_amount: ['total', 'total amount', 'rate amount', 'amount', 'montant', 'montant total', 'total price'],
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
