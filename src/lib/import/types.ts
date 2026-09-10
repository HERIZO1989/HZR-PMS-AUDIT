export type SourceFileType = 'csv' | 'txt' | 'xlsx' | 'xls';
export type SourceSystem = 'opera' | 'protel' | 'fidelio' | 'generic_csv' | 'generic_xlsx' | 'generic_txt';
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
}

export interface NormalizedRowResult {
  rowNumber: number;
  raw: Record<string, unknown>;
  normalized: Record<string, unknown> | null;
  status: 'valid' | 'invalid';
  errors: string[];
}

/**
 * NORMALIZED SCHEMAS (what normalized_data must contain before apply_import_batch runs)
 *
 * guest:
 *   first_name*, last_name*, email, phone, nationality, vip_tier, loyalty_number
 *
 * reservation:
 *   confirmation_number*, guest_email*, guest_first_name, guest_last_name,
 *   channel, status, arrival_date* (YYYY-MM-DD), departure_date* (YYYY-MM-DD),
 *   adults, children, total_amount, currency_code
 *
 * (* = required)
 */
