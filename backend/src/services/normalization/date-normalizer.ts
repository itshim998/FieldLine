import { NormalizationError } from './normalizationError.js';

const MONTH_NAMES: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12
};

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function getDaysInMonth(year: number, month: number): number {
  switch (month) {
    case 1: // January
    case 3: // March
    case 5: // May
    case 7: // July
    case 8: // August
    case 10: // October
    case 12: // December
      return 31;
    case 4: // April
    case 6: // June
    case 9: // September
    case 11: // November
      return 30;
    case 2: // February
      return isLeapYear(year) ? 29 : 28;
    default:
      return 0;
  }
}

export function formatCanonicalDate(year: number, month: number, day: number): string {
  const y = String(year).padStart(4, '0');
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function validateCalendarDate(
  year: number,
  month: number,
  day: number,
  sourceValue: unknown,
  fieldName: string,
  rowNumber?: number
): string {
  if (isNaN(year) || isNaN(month) || isNaN(day)) {
    throw new NormalizationError(
      fieldName,
      sourceValue,
      'Invalid numeric date components',
      rowNumber
    );
  }

  if (year < 1000 || year > 9999) {
    throw new NormalizationError(
      fieldName,
      sourceValue,
      `Year ${year} is out of supported range (1000-9999)`,
      rowNumber
    );
  }

  if (month < 1 || month > 12) {
    throw new NormalizationError(
      fieldName,
      sourceValue,
      `Month ${month} is invalid (must be 1-12)`,
      rowNumber
    );
  }

  const maxDays = getDaysInMonth(year, month);
  if (day < 1 || day > maxDays) {
    throw new NormalizationError(
      fieldName,
      sourceValue,
      `Day ${day} is invalid for month ${month}/${year} (max ${maxDays} days)`,
      rowNumber
    );
  }

  return formatCanonicalDate(year, month, day);
}

/**
 * Normalizes Excel serial date numbers to canonical YYYY-MM-DD string.
 */
function normalizeExcelSerialDate(
  serial: number,
  sourceValue: unknown,
  fieldName: string,
  rowNumber?: number
): string {
  if (!isFinite(serial) || serial <= 0) {
    throw new NormalizationError(
      fieldName,
      sourceValue,
      `Invalid Excel serial date '${serial}'`,
      rowNumber
    );
  }

  // Excel date serial calculation (1900 date system with epoch 1899-12-30)
  const utcDays = serial - 25569;
  const ms = Math.round(utcDays * 86400 * 1000);
  const date = new Date(ms);

  if (isNaN(date.getTime())) {
    throw new NormalizationError(
      fieldName,
      sourceValue,
      `Could not convert Excel serial date '${serial}' to calendar date`,
      rowNumber
    );
  }

  return validateCalendarDate(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    sourceValue,
    fieldName,
    rowNumber
  );
}

/**
 * Deterministically normalizes a date input into canonical 'YYYY-MM-DD' format.
 *
 * Supported representations:
 * 1. ISO 8601 strings (YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD, YYYY-MM-DDTHH:mm:ss...)
 * 2. Excel Date objects and Excel numeric serial numbers
 * 3. Unambiguous named month dates (e.g. '01-Apr-2026', 'Apr 1, 2026', '1 April 2026')
 * 4. Unambiguous slash/dash dates (where day > 12 or day === month)
 *
 * Genuinely ambiguous dates (e.g. '01/02/2026') reject with a clear NormalizationError.
 */
export function normalizeDate(
  value: unknown,
  fieldName = 'Date',
  rowNumber?: number
): string {
  if (value === null || value === undefined) {
    throw new NormalizationError(
      fieldName,
      value,
      'Date cannot be empty or missing',
      rowNumber
    );
  }

  // Handle Date instance
  if (value instanceof Date) {
    if (isNaN(value.getTime())) {
      throw new NormalizationError(
        fieldName,
        value,
        'Invalid JavaScript Date object',
        rowNumber
      );
    }
    return validateCalendarDate(
      value.getUTCFullYear(),
      value.getUTCMonth() + 1,
      value.getUTCDate(),
      value,
      fieldName,
      rowNumber
    );
  }

  // Handle number (Excel serial date)
  if (typeof value === 'number') {
    return normalizeExcelSerialDate(value, value, fieldName, rowNumber);
  }

  const rawStr = String(value).trim();
  if (!rawStr) {
    throw new NormalizationError(
      fieldName,
      value,
      'Date cannot be empty or missing',
      rowNumber
    );
  }

  // 1. Check if string is a numeric Excel serial (e.g. '46083')
  if (/^\d{5}(\.\d+)?$/.test(rawStr)) {
    const serial = Number(rawStr);
    if (!isNaN(serial) && serial > 1000) {
      return normalizeExcelSerialDate(serial, value, fieldName, rowNumber);
    }
  }

  // 2. ISO format with timestamp (e.g. 2026-04-01T00:00:00.000Z)
  const isoTimestampMatch = rawStr.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})T/i);
  if (isoTimestampMatch) {
    const year = parseInt(isoTimestampMatch[1], 10);
    const month = parseInt(isoTimestampMatch[2], 10);
    const day = parseInt(isoTimestampMatch[3], 10);
    return validateCalendarDate(year, month, day, value, fieldName, rowNumber);
  }

  // 3. Year-first formats (e.g. YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD)
  const yearFirstMatch = rawStr.match(/^(\d{4})[-/. ](\d{1,2})[-/. ](\d{1,2})$/);
  if (yearFirstMatch) {
    const year = parseInt(yearFirstMatch[1], 10);
    const month = parseInt(yearFirstMatch[2], 10);
    const day = parseInt(yearFirstMatch[3], 10);
    return validateCalendarDate(year, month, day, value, fieldName, rowNumber);
  }

  // 4. Named month formats (e.g. '01-Apr-2026', 'Apr 1, 2026', '1 April 2026', '2026-Apr-01')
  // Pattern 4a: DD-MMM-YYYY or DD MMM YYYY or DD/MMM/YYYY
  const ddMmmYyyyMatch = rawStr.match(/^(\d{1,2})[-/.\s]+([a-zA-Z]+)[-/.\s]+(\d{4})$/);
  if (ddMmmYyyyMatch) {
    const day = parseInt(ddMmmYyyyMatch[1], 10);
    const monthKey = ddMmmYyyyMatch[2].toLowerCase();
    const year = parseInt(ddMmmYyyyMatch[3], 10);
    const month = MONTH_NAMES[monthKey];
    if (!month) {
      throw new NormalizationError(
        fieldName,
        value,
        `Unrecognized month name '${ddMmmYyyyMatch[2]}'`,
        rowNumber
      );
    }
    return validateCalendarDate(year, month, day, value, fieldName, rowNumber);
  }

  // Pattern 4b: MMM DD, YYYY or MMM DD YYYY
  const mmmDdYyyyMatch = rawStr.match(/^([a-zA-Z]+)[-/.\s]+(\d{1,2})(?:st|nd|rd|th)?,?[-/.\s]+(\d{4})$/);
  if (mmmDdYyyyMatch) {
    const monthKey = mmmDdYyyyMatch[1].toLowerCase();
    const day = parseInt(mmmDdYyyyMatch[2], 10);
    const year = parseInt(mmmDdYyyyMatch[3], 10);
    const month = MONTH_NAMES[monthKey];
    if (!month) {
      throw new NormalizationError(
        fieldName,
        value,
        `Unrecognized month name '${mmmDdYyyyMatch[1]}'`,
        rowNumber
      );
    }
    return validateCalendarDate(year, month, day, value, fieldName, rowNumber);
  }

  // Pattern 4c: YYYY-MMM-DD or YYYY MMM DD
  const yyyyMmmDdMatch = rawStr.match(/^(\d{4})[-/.\s]+([a-zA-Z]+)[-/.\s]+(\d{1,2})$/);
  if (yyyyMmmDdMatch) {
    const year = parseInt(yyyyMmmDdMatch[1], 10);
    const monthKey = yyyyMmmDdMatch[2].toLowerCase();
    const day = parseInt(yyyyMmmDdMatch[3], 10);
    const month = MONTH_NAMES[monthKey];
    if (!month) {
      throw new NormalizationError(
        fieldName,
        value,
        `Unrecognized month name '${yyyyMmmDdMatch[2]}'`,
        rowNumber
      );
    }
    return validateCalendarDate(year, month, day, value, fieldName, rowNumber);
  }

  // 5. Slash / Dash / Dot 2-part number with 4-digit Year: A/B/YYYY or A-B-YYYY or A.B.YYYY
  const twoPartYearMatch = rawStr.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (twoPartYearMatch) {
    const first = parseInt(twoPartYearMatch[1], 10);
    const second = parseInt(twoPartYearMatch[2], 10);
    const year = parseInt(twoPartYearMatch[3], 10);

    // Case 5a: Unambiguous Day-first (e.g. 25/06/2026 -> first > 12, second <= 12)
    if (first > 12 && second <= 12) {
      return validateCalendarDate(year, second, first, value, fieldName, rowNumber);
    }

    // Case 5b: Unambiguous Month-first (e.g. 06/25/2026 -> first <= 12, second > 12)
    if (first <= 12 && second > 12) {
      return validateCalendarDate(year, first, second, value, fieldName, rowNumber);
    }

    // Case 5c: Identical day and month (e.g. 05/05/2026)
    if (first === second && first >= 1 && first <= 12) {
      return validateCalendarDate(year, first, second, value, fieldName, rowNumber);
    }

    // Case 5d: Both first and second are <= 12 and not equal (e.g. 01/02/2026)
    // Genuinely ambiguous format without locale or specification
    throw new NormalizationError(
      fieldName,
      value,
      `Ambiguous date format '${rawStr}'. Cannot deterministically distinguish between DD/MM/YYYY and MM/DD/YYYY. Use ISO format YYYY-MM-DD or explicit month name (e.g. 01-Feb-2026).`,
      rowNumber
    );
  }

  throw new NormalizationError(
    fieldName,
    value,
    `Unrecognized or unsupported date format '${rawStr}'`,
    rowNumber
  );
}
