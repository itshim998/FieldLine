import { NormalizationError } from './normalizationError.js';

/**
 * Deterministically normalizes a numeric input into a standard JavaScript number.
 * Returns null if the value is null, undefined, or an empty string.
 *
 * Supported formats:
 * - JavaScript numbers (e.g. 1250, 1250.5)
 * - Numeric strings (e.g. "1250", " 1250.50 ")
 * - Standard thousands separators (e.g. "1,250", "1,250,000.75", "1 250 000.50")
 * - Scientific notation (e.g. "1.25E3", "1.25e-2")
 *
 * Rejects ambiguous or malformed numbers (e.g. "1.234,56", "abc", "12.34.56").
 */
export function normalizeNumber(
  value: unknown,
  fieldName = 'Quantity',
  rowNumber?: number
): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'number') {
    if (isNaN(value) || !isFinite(value)) {
      throw new NormalizationError(
        fieldName,
        value,
        'Numeric value cannot be NaN or Infinity',
        rowNumber
      );
    }
    return value;
  }

  const rawStr = String(value).trim();
  if (rawStr === '') {
    return null;
  }

  // Check for ambiguous European format (e.g. "1.234,56" where dot is thousand and comma is decimal)
  if (/^\d{1,3}(\.\d{3})+,\d+$/.test(rawStr) || /^\d+,\d+,\d+$/.test(rawStr)) {
    throw new NormalizationError(
      fieldName,
      value,
      `Ambiguous or unsupported numeric format '${rawStr}'. Use standard format with dot as decimal separator and optional comma as thousands separator (e.g. 1,250.00).`,
      rowNumber
    );
  }

  let cleaned = rawStr;

  // Handle standard thousands comma separator (e.g. "1,250" or "1,250,000.50")
  if (/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?([eE][+-]?\d+)?$/.test(cleaned)) {
    cleaned = cleaned.replace(/,/g, '');
  }

  // Handle space thousands separator (e.g. "1 250 000.50")
  if (/^[+-]?\d{1,3}(\s\d{3})+(\.\d+)?([eE][+-]?\d+)?$/.test(cleaned)) {
    cleaned = cleaned.replace(/\s+/g, '');
  }

  // Validate strict standard number format: optional sign, digits, optional decimal digits, optional exponent
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(cleaned)) {
    throw new NormalizationError(
      fieldName,
      value,
      `Invalid numeric format '${rawStr}'`,
      rowNumber
    );
  }

  const parsed = Number(cleaned);
  if (isNaN(parsed) || !isFinite(parsed)) {
    throw new NormalizationError(
      fieldName,
      value,
      `Could not parse '${rawStr}' to a valid finite number`,
      rowNumber
    );
  }

  return parsed;
}

/**
 * Normalizes a percentage representation.
 * - Handles percentage strings like '50%', ' 50 % ' -> 50
 * - Handles numbers directly: 50 -> 50, 0.5 -> 0.5
 * - Returns null if empty/null/undefined
 */
export function normalizePercentage(
  value: unknown,
  fieldName = 'Progress',
  rowNumber?: number
): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'number') {
    if (isNaN(value) || !isFinite(value)) {
      throw new NormalizationError(
        fieldName,
        value,
        'Percentage value cannot be NaN or Infinity',
        rowNumber
      );
    }
    return value;
  }

  const rawStr = String(value).trim();
  if (rawStr === '') {
    return null;
  }

  // Check for percentage suffix (e.g. '50%', ' 50 % ')
  if (rawStr.endsWith('%')) {
    const numPart = rawStr.slice(0, -1).trim();
    return normalizeNumber(numPart, fieldName, rowNumber);
  }

  return normalizeNumber(rawStr, fieldName, rowNumber);
}
