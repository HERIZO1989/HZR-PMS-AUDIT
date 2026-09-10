/**
 * Normalizes a wide variety of date formats found in PMS exports into ISO 'YYYY-MM-DD'.
 * Returns null if the value cannot be confidently parsed (caller should treat as validation error).
 */
export function normalizeDate(value: unknown, hintFormat?: string): string | null {
  if (value === null || value === undefined || value === '') return null;

  // Already a Date instance (e.g. from XLSX with cellDates: true)
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const str = String(value).trim();

  // ISO first: YYYY-MM-DD
  let m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  m = str.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    // If hint says MM-DD-YYYY (US exports), swap day/month
    if (hintFormat?.toUpperCase().startsWith('MM')) {
      return `${y}-${d.padStart(2, '0')}-${mo.padStart(2, '0')}`;
    }
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // DD-MMM-YY (Oracle Opera style, e.g. "05-SEP-26")
  m = str.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (m) {
    const months: Record<string, string> = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    };
    const mo = months[m[2].toLowerCase()];
    if (!mo) return null;
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${mo}-${m[1].padStart(2, '0')}`;
  }

  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);

  return null;
}

/** Normalizes a phone number to a loose E.164-like format (keeps leading + if present). */
export function normalizePhone(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const digits = String(value).replace(/[^\d+]/g, '');
  return digits.length >= 6 ? digits : null;
}

/** Parses a currency/amount string like "1 234,56 €" or "$1,234.56" into a plain number. */
export function normalizeCurrency(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return value;
  let str = String(value).trim().replace(/[^\d,.\-]/g, '');
  // Heuristic: if both , and . present, the last one is the decimal separator
  const lastComma = str.lastIndexOf(',');
  const lastDot = str.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) {
      str = str.replace(/\./g, '').replace(',', '.');
    } else {
      str = str.replace(/,/g, '');
    }
  } else if (lastComma > -1) {
    str = str.replace(',', '.');
  }
  const n = parseFloat(str);
  return isNaN(n) ? null : n;
}

export function applyTransform(value: unknown, transform: string | undefined, dateFormat?: string): unknown {
  switch (transform) {
    case 'date':
      return normalizeDate(value, dateFormat);
    case 'phone':
      return normalizePhone(value);
    case 'currency':
      return normalizeCurrency(value);
    case 'trim':
      return typeof value === 'string' ? value.trim() : value;
    case 'upper':
      return typeof value === 'string' ? value.toUpperCase() : value;
    case 'lower':
      return typeof value === 'string' ? value.toLowerCase() : value;
    default:
      return typeof value === 'string' ? value.trim() : value;
  }
}
