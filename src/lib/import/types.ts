export type SourceFileType = 'csv' | 'txt' | 'xlsx' | 'xls';
export type SourceSystem = 'opera' | 'protel' | 'odoo' | 'fidelio' | 'generic_csv' | 'generic_xlsx' | 'generic_txt';
export type TargetEntityType = 'guest' | 'reservation';

export interface RawRow {
  rowNumber: number;
  raw: Record<string, string | number | null>;
}

export interface FieldMapping {
  /** Column header as it appears in the source file */
  sourceField: string;
  /** Canonical field name on the target entity (see NORMALIZED SCHEMAS below) */
  targetField: string;
  /** Optional transform applied during normalization: date | phone | currency | trim | upper | lower */
  transform?: 'date' | 'phone' | 'currency' | 'trim' | 'upper' | 'lower';
  required?: boolean;
}

export interface MappingConfig {
  targetEntityType: TargetEntityType;
  fields: FieldMapping[];
  /** e.g. 'DD/MM/YYYY', 'MM-DD-YYYY', 'YYYY-MM-DD' — used by the date normalizer */
  dateFormat?: string;
  /** Correspondance des valeurs de statut du fichier vers celles du PMS (cles sans accents ni casse, voir normalizeKey). */
  statusMap?: Record<string, string>;
  /** Specificites d'un export (voir odoo.ts). */
  options?: {
    /** Ignore les lignes de regroupement (ex. "checkout (4219)") au lieu de les signaler invalides. */
    skipGroupRows?: boolean;
    /** Remplace la reference source (reutilisee) par un numero de confirmation unique et reproductible. */
    uniqueConfirmationNumber?: boolean;
    /** Separe un nom unique "NOM Prenom" en nom / prenom. */
    splitNameLastFirst?: boolean;
    /** Une reservation dont l'arrivee et le depart tombent le meme jour est importee comme sejour a la journee (stay_type = 'day_use'). */
    allowDayUse?: boolean;
    /** Deduit le nombre et le type de chambres de chaque ligne a partir du prix par nuit et de la grille de tarifs de l'hotel (voir rateDecoder.ts). */
    inferRoomsFromRate?: boolean;
    /** Tarifs remises : tarif public / diviseur (ex. 1,06 a Anjary). Voir rateDecoder.ts. */
    discountedRateDivisor?: number;
    /** Tarifs negocies confirmes, en plus du diviseur : tarif exact par nuit rattache a un type de chambre (ex. Superieur a 132 000 = -30 % sur le tarif public). */
    negotiatedRates?: { typeName: string; rate: number; label?: string }[];
    /** Supplement unique d'arrivee anticipee (day use) par type de chambre, ex. Standard 60 000 et Superieur 90 000 a Anjary : sejour d'UNE nuit = tarif de la chambre + supplement. */
    dayUseSupplements?: { typeName: string; amount: number }[];
    /** Demi-nuitee (50 %) : un sejour d'UNE nuit dont le montant vaut la moitie du tarif d'une chambre (ex. 66 000 = 132 000 / 2, 79 500 = 159 000 / 2). */
    halfNight?: boolean;
    /** Sejour a la journee (arrivee et depart le meme jour) : le montant est lu comme le prix d'UNE journee, au tarif d'une ou plusieurs chambres (ex. 216 000 = 2 Standard a 108 000). */
    sameDayAsOneNight?: boolean;
    /** Prix par nuit connus pour etre des erreurs de tarif dans le systeme source : jamais decodes, signales a corriger a la source (ex. 185 520 a Anjary). */
    knownRateErrors?: { rate: number; note?: string }[];
    /** Prix par nuit qui ne sont PAS de l'hebergement (ex. location de salle de reunion a Anjary : 200 000) : ligne ignoree, jamais importee comme sejour. */
    nonStayRates?: { rate: number; reason: string }[];
    /** Location facturee par JOUR CALENDAIRE (ex. salle de reunion a Anjary : 200 000 par jour, arrivee tot le matin, depart en fin d'apres-midi) : montant = tarif x nombre de jours (arrivee et depart inclus). Ligne ignoree. */
    dayRentalRates?: { dailyRate: number; maxArrivalHour: number; minDepartureHour: number; reason: string }[];
  };
}

/** Periode importee : les lignes dont le depart est anterieur a cette date sont ignorees (ex. historique deja traite dans l'ancien systeme). */
export interface ImportScope {
  /** AAAA-MM-JJ : seuls les sejours dont le depart est ce jour-la ou plus tard sont importes. */
  departureFrom?: string;
}

/** Bilan du decodage des chambres, par ligne source. */
export interface RoomDecodeSummary {
  exact: number;
  discounted: number;
  ambiguous: number;
  unknown: number;
  /** Nombre de reservations (chambres) creees a partir des lignes valides. */
  rooms: number;
}

export interface NormalizedRowResult {
  rowNumber: number;
  raw: Record<string, unknown>;
  normalized: Record<string, unknown> | null;
  status: 'valid' | 'invalid' | 'skipped';
  errors: string[];
}

/**
 * NORMALIZED SCHEMAS (what normalized_data must contain before apply_import_batch runs)
 *
 * guest:
 *   first_name*, last_name*, email, phone, nationality, vip_tier, loyalty_number
 *
 * reservation:
 *   confirmation_number*, guest_email (ou guest_first_name / guest_last_name a defaut), guest_first_name, guest_last_name,
 *   channel, status, arrival_date* (YYYY-MM-DD), departure_date* (YYYY-MM-DD),
 *   adults, children, total_amount, currency_code
 *
 * (* = required)
 */
