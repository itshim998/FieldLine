import { NormalizationError } from './normalizationError.js';

export interface TextNormalizeOptions {
  collapseWhitespace?: boolean;
  allowEmpty?: boolean;
}

/**
 * Normalizes a text string by trimming leading/trailing whitespace and optionally
 * collapsing consecutive internal whitespace characters.
 * Returns null if the resulting string is empty and allowEmpty is false (default).
 */
export function normalizeText(
  value: unknown,
  options: TextNormalizeOptions = {}
): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const { collapseWhitespace = true, allowEmpty = false } = options;
  let str = String(value).trim();

  if (collapseWhitespace) {
    str = str.replace(/\s+/g, ' ');
  }

  if (str === '') {
    return allowEmpty ? '' : null;
  }

  return str;
}

/**
 * Normalizes an external identifier (Activity ID).
 * - Trims leading and trailing whitespace
 * - Collapses repeated internal whitespace
 * - Preserves punctuation, case, and structure (e.g. 'ACT-001/A')
 * - Throws NormalizationError if empty or missing
 */
export function normalizeIdentifier(
  value: unknown,
  fieldName = 'Activity ID',
  rowNumber?: number
): string {
  const normalized = normalizeText(value, { collapseWhitespace: true, allowEmpty: false });

  if (!normalized) {
    throw new NormalizationError(
      fieldName,
      value,
      'Identifier cannot be empty or missing',
      rowNumber
    );
  }

  return normalized;
}

/**
 * Normalizes a name string (Activity Name).
 * - Trims leading and trailing whitespace
 * - Collapses repeated internal whitespace ('  Excavation   Work  ' -> 'Excavation Work')
 * - Preserves original capitalization
 * - Throws NormalizationError if empty or missing
 */
export function normalizeName(
  value: unknown,
  fieldName = 'Activity Name',
  rowNumber?: number
): string {
  const normalized = normalizeText(value, { collapseWhitespace: true, allowEmpty: false });

  if (!normalized) {
    throw new NormalizationError(
      fieldName,
      value,
      'Name cannot be empty or missing',
      rowNumber
    );
  }

  return normalized;
}

/**
 * Normalizes optional text fields (description, wbsCode, location, etc.).
 * - Trims and collapses internal whitespace
 * - Converts empty/whitespace-only values to null
 */
export function normalizeOptionalText(value: unknown): string | null {
  return normalizeText(value, { collapseWhitespace: true, allowEmpty: false });
}
