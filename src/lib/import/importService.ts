import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { parseFile } from './parsers';
import { suggestMapping, MAPPING_PRESETS } from './mappingPresets';
import { applyTransform } from './normalizers';
import { validateEntity } from './validators';
import { buildOdooConfirmationNumber, isOdooGroupRow, normalizeKey, splitOdooName } from './odoo';
import type { MappingConfig, NormalizedRowResult, SourceFileType, SourceSystem, TargetEntityType } from './types';

export interface ImportContext {
  tenantId: string;
  hotelId: string;
  uploadedBy: string; // staff_users.id
}

/**
 * Full pipeline for one uploaded file:
 * 1) parse            -> raw rows
 * 2) map + normalize   -> normalized_data per row
 * 3) validate          -> status valid/invalid per row
 * 4) stage             -> insert import_batches + import_rows (traceability: raw + normalized + errors)
 * 5) apply (optional)  -> RPC apply_import_batch (transactional, DB-side) once the user confirms the mapping
 *
 * Staging (steps 1-4) and application (step 5) are deliberately separate so the
 * user can review/edit the mapping and see validation errors before anything
 * touches guests/reservations.
 */
export class ImportService {
  constructor(private supabase: SupabaseClient) {}

  static forRequest(supabaseUrl: string, serviceRoleKey: string, ctx: ImportContext) {
    // Backend-only client using the service role key (bypasses RLS by design —
    // tenant/hotel scoping is enforced explicitly in every query below instead).
    const client = createClient(supabaseUrl, serviceRoleKey);
    return { service: new ImportService(client), ctx };
  }

  resolveMapping(headers: string[], sourceSystem: SourceSystem, targetEntityType: TargetEntityType): MappingConfig {
    const preset = MAPPING_PRESETS[sourceSystem];
    if (preset && preset.targetEntityType === targetEntityType) {
      // Le preset n'est retenu que si tous ses en-tetes requis existent dans le fichier ;
      // sinon (autre langue, colonnes renommees) on retombe sur la suggestion par synonymes.
      const present = new Set(headers.map((h) => h.trim()));
      const requiredOk = preset.fields.every((f) => !f.required || present.has(f.sourceField));
      if (requiredOk) return preset;
    }
    return suggestMapping(headers, targetEntityType);
  }

  private mapAndNormalizeRow(
    raw: Record<string, unknown>,
    mapping: MappingConfig
  ): { normalized: Record<string, unknown>; errors: string[] } {
    const normalized: Record<string, unknown> = {};
    const errors: string[] = [];

    for (const field of mapping.fields) {
      const rawValue = raw[field.sourceField];
      if (field.required && (rawValue === undefined || rawValue === null || rawValue === '')) {
        errors.push(`Colonne source "${field.sourceField}" -> "${field.targetField}" est requise mais vide`);
        continue;
      }
      normalized[field.targetField] = applyTransform(rawValue, field.transform, mapping.dateFormat);
    }

    const src = (target: string) => mapping.fields.find((f) => f.targetField === target)?.sourceField;

    // Reference source reutilisee par certains exports : on la remplace par un numero unique et reproductible.
    if (mapping.options?.uniqueConfirmationNumber && normalized.confirmation_number) {
      normalized.confirmation_number = buildOdooConfirmationNumber(
        String(normalized.confirmation_number),
        raw[src('arrival_date') ?? ''],
        raw[src('departure_date') ?? ''],
        raw[src('guest_full_name') ?? '']
      );
    }

    // Split a combined "guest_full_name" if present and first/last not already mapped
    if (normalized.guest_full_name && !normalized.guest_first_name && !normalized.guest_last_name) {
      if (mapping.options?.splitNameLastFirst) {
        const { first, last } = splitOdooName(normalized.guest_full_name);
        normalized.guest_first_name = first;
        normalized.guest_last_name = last;
      } else {
        const parts = String(normalized.guest_full_name).trim().split(/\s+/);
        normalized.guest_first_name = parts[0] ?? 'Guest';
        normalized.guest_last_name = parts.slice(1).join(' ') || 'Import';
      }
      delete normalized.guest_full_name;
    }

    // Statuts du fichier -> statuts du PMS (une valeur inconnue est laissee telle quelle : la validation la signale).
    if (mapping.statusMap && typeof normalized.status === 'string' && normalized.status) {
      const mapped = mapping.statusMap[normalizeKey(normalized.status)];
      if (mapped) normalized.status = mapped;
    }

    return { normalized, errors };
  }

  async stageImport(params: {
    ctx: ImportContext;
    fileName: string;
    fileType: SourceFileType;
    sourceSystem: SourceSystem;
    content: string | Buffer;
    targetEntityType: TargetEntityType;
    mappingOverride?: MappingConfig;
  }): Promise<{ batchId: string; results: NormalizedRowResult[] }> {
    const rawRows = parseFile(params.fileType, params.content);
    if (rawRows.length === 0) {
      throw new Error('Fichier vide ou illisible: aucune ligne détectée');
    }

    const headers = Object.keys(rawRows[0].raw);
    const mapping =
      params.mappingOverride ?? this.resolveMapping(headers, params.sourceSystem, params.targetEntityType);

    const { data: batch, error: batchError } = await this.supabase
      .from('import_batches')
      .insert({
        tenant_id: params.ctx.tenantId,
        hotel_id: params.ctx.hotelId,
        source_system: params.sourceSystem,
        file_name: params.fileName,
        file_type: params.fileType,
        status: 'validating',
        mapping_config: mapping,
        total_rows: rawRows.length,
        uploaded_by: params.ctx.uploadedBy,
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (batchError || !batch) throw new Error(`Impossible de créer le lot d'import: ${batchError?.message}`);

    const results: NormalizedRowResult[] = rawRows.map(({ rowNumber, raw }) => {
      if (
        mapping.options?.skipGroupRows &&
        isOdooGroupRow(
          raw[mapping.fields.find((f) => f.targetField === 'confirmation_number')?.sourceField ?? ''],
          raw[mapping.fields.find((f) => f.targetField === 'guest_full_name')?.sourceField ?? ''],
          raw[mapping.fields.find((f) => f.targetField === 'arrival_date')?.sourceField ?? ''],
          raw[mapping.fields.find((f) => f.targetField === 'departure_date')?.sourceField ?? '']
        )
      ) {
        return { rowNumber, raw, normalized: null, status: 'skipped' as const, errors: ['Ligne de regroupement du fichier (total par statut), ignorée'] };
      }
      const { normalized, errors: mappingErrors } = this.mapAndNormalizeRow(raw, mapping);
      const businessErrors = validateEntity(mapping.targetEntityType, normalized);
      const errors = [...mappingErrors, ...businessErrors];
      return {
        rowNumber,
        raw,
        normalized, // gardee meme si invalide, pour revue
        status: errors.length === 0 ? ('valid' as const) : ('invalid' as const),
        errors,
      };
    });

    const rowsToInsert = results.map((r) => ({
      tenant_id: params.ctx.tenantId,
      import_batch_id: batch.id,
      row_number: r.rowNumber,
      raw_data: r.raw,
      normalized_data: r.normalized,
      status: r.status,
      validation_errors: r.errors,
      target_entity_type: mapping.targetEntityType,
    }));

    // Supabase/PostgREST caps payload size; chunk large files to stay safe.
    const CHUNK = 500;
    for (let i = 0; i < rowsToInsert.length; i += CHUNK) {
      const { error } = await this.supabase.from('import_rows').insert(rowsToInsert.slice(i, i + CHUNK));
      if (error) throw new Error(`Échec insertion lignes d'import: ${error.message}`);
    }

    const validCount = results.filter((r) => r.status === 'valid').length;
    await this.supabase
      .from('import_batches')
      .update({
        status: 'mapping',
        valid_rows: validCount,
        error_rows: results.filter((r) => r.status === 'invalid').length,
      })
      .eq('id', batch.id);

    return { batchId: batch.id, results };
  }

  /**
   * Importe les lignes 'valid' dans guests/reservations, par tranches de 500 (fonction SQL apply_import_batch_chunk) :
   * chaque appel reste largement sous la limite de 8 s de l'API, meme pour un fichier de plusieurs milliers de lignes.
   * Les compteurs retournes portent sur tout le lot.
   */
  async applyBatch(batchId: string): Promise<{ imported: number; invalid: number; skipped: number }> {
    const MAX_CALLS = 100; // 50 000 lignes
    for (let i = 0; i < MAX_CALLS; i++) {
      const { data, error } = await this.supabase.rpc('apply_import_batch_chunk', { p_batch_id: batchId, p_limit: 500 });
      if (error) throw new Error(`Échec de l'application du lot d'import: ${error.message}`);
      const last = data?.[0];
      if (!last) return { imported: 0, invalid: 0, skipped: 0 };
      if (last.remaining === 0) return { imported: last.imported, invalid: last.invalid, skipped: last.skipped };
    }
    throw new Error("Lot d'import trop volumineux : application interrompue, relancez pour poursuivre");
  }
}
