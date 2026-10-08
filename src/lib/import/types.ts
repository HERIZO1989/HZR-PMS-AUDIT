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
  };
}

/** Periode importee : les lignes dont le depart est anterieur a cette date sont ignorees (ex. historique deja traite dans l'ancien systeme). */
export interface ImportScope {
  /** AAAA-MM-JJ : seuls les sejours dont le depart est ce jour-la ou plus tard sont importes. */
  departureFrom?: string;
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
