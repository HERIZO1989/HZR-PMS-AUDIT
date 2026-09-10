import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { RawRow, SourceFileType } from './types';

/**
 * Detects the delimiter for CSV/TXT files by sampling the first line.
 * PMS exports commonly use ',', ';' or tab.
 */
function detectDelimiter(sample: string): string {
  const candidates = [',', ';', '\t', '|'];
  const firstLine = sample.split(/\r?\n/, 1)[0] ?? '';
  let best = ',';
  let bestCount = -1;
  for (const c of candidates) {
    const count = firstLine.split(c).length;
    if (count > bestCount) {
      bestCount = count;
      best = c;
    }
  }
  return best;
}

export function parseDelimitedText(content: string): RawRow[] {
  const delimiter = detectDelimiter(content);
  const result = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
    delimiter,
    transformHeader: (h) => h.trim(),
  });

  if (result.errors.length > 0) {
    // Papaparse reports row-level errors but still returns usable data; we surface
    // them via console for now, real errors per-row are caught later in validation.
    console.warn(`[import] ${result.errors.length} parse warning(s):`, result.errors.slice(0, 5));
  }

  return result.data.map((raw, idx) => ({
    rowNumber: idx + 1,
    raw,
  }));
}

export function parseExcel(buffer: Buffer): RawRow[] {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];
  const sheet = workbook.Sheets[firstSheetName];
  const json = XLSX.utils.sheet_to_json<Record<string, string | number | null>>(sheet, {
    defval: null,
    raw: false, // keep formatted strings so date/currency normalization stays consistent with CSV
  });
  return json.map((raw, idx) => ({ rowNumber: idx + 1, raw }));
}

export function parseFile(fileType: SourceFileType, content: string | Buffer): RawRow[] {
  switch (fileType) {
    case 'csv':
    case 'txt':
      return parseDelimitedText(content as string);
    case 'xlsx':
    case 'xls':
      return parseExcel(content as Buffer);
    default:
      throw new Error(`Unsupported file type: ${fileType}`);
  }
}
