import { CanonicalScheduleImportRow } from '../../models/domain.types.js';
import { ValidationError } from '../../errors/AppError.js';
import { normalizeNumber } from '../normalization/number-normalizer.js';

export type CanonicalFieldKey = keyof CanonicalScheduleImportRow;

export const REQUIRED_FIELDS: readonly CanonicalFieldKey[] = [
  'externalId',
  'name',
  'plannedStart',
  'plannedFinish'
] as const;

export const FIELD_DISPLAY_NAMES: Record<CanonicalFieldKey, string> = {
  externalId: 'Activity ID',
  name: 'Activity Name',
  plannedStart: 'Start Date',
  plannedFinish: 'Finish Date',
  description: 'Description',
  wbsCode: 'WBS Code',
  location: 'Location',
  plannedQuantity: 'Quantity',
  unit: 'Unit',
  baselineProgress: 'Baseline Progress'
};


/**
 * Dictionary of supported header aliases for each canonical field.
 * All keys should be lowercased and stripped of excessive whitespace/punctuation.
 */
const ALIAS_MAP: Record<CanonicalFieldKey, string[]> = {
  externalId: [
    'activity id',
    'activityid',
    'activity_id',
    'id',
    'task id',
    'taskid',
    'task_id',
    'activity',
    'act id',
    'act_id',
    'actid',
    'activity code',
    'task code',
    'external id',
    'external_id',
    'externalid',
    'code'
  ],
  name: [
    'activity name',
    'activityname',
    'activity_name',
    'task name',
    'taskname',
    'task_name',
    'name',
    'title',
    'activity title',
    'task title',
    'task'
  ],
  plannedStart: [
    'start',
    'start date',
    'startdate',
    'start_date',
    'planned start',
    'plannedstart',
    'planned_start',
    'early start',
    'early_start',
    'earlystart',
    'baseline start',
    'target start'
  ],
  plannedFinish: [
    'finish',
    'finish date',
    'finishdate',
    'finish_date',
    'planned finish',
    'plannedfinish',
    'planned_finish',
    'early finish',
    'early_finish',
    'earlyfinish',
    'end',
    'end date',
    'enddate',
    'end_date',
    'baseline finish',
    'target finish'
  ],
  description: [
    'description',
    'desc',
    'activity description',
    'task description',
    'activity_description',
    'task_description',
    'details',
    'scope'
  ],
  wbsCode: [
    'wbs',
    'wbs code',
    'wbscode',
    'wbs_code',
    'work breakdown structure',
    'wbs element',
    'wbs_element'
  ],
  location: [
    'location',
    'area',
    'zone',
    'site',
    'section',
    'station',
    'loc'
  ],
  plannedQuantity: [
    'quantity',
    'qty',
    'planned quantity',
    'planned qty',
    'plannedquantity',
    'planned_quantity',
    'planned_qty',
    'target qty',
    'target quantity',
    'budget qty',
    'budget quantity',
    'budgeted quantity'
  ],
  unit: [
    'unit',
    'uom',
    'units',
    'unit of measure',
    'unit of measurement',
    'unit_of_measure',
    'unit_of_measurement'
  ],
  baselineProgress: [
    'baseline progress',
    'baseline_progress',
    'baselineprogress',
    'progress',
    'progress %',
    'progress%',
    'baseline %',
    'baseline%'
  ]
};


/**
 * Normalizes a header string for alias matching.
 */
export function normalizeHeaderString(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

/**
 * Resolves a raw header name to a CanonicalFieldKey if recognized.
 */
export function matchHeaderToCanonicalField(rawHeader: string): CanonicalFieldKey | null {
  if (!rawHeader) return null;
  const normalized = normalizeHeaderString(rawHeader);

  // Exact canonical match
  if (normalized in FIELD_DISPLAY_NAMES) {
    return normalized as CanonicalFieldKey;
  }

  // Also check without spaces (e.g. 'activityid', 'plannedstart')
  const noSpace = normalized.replace(/\s+/g, '');

  for (const [field, aliases] of Object.entries(ALIAS_MAP)) {
    for (const alias of aliases) {
      const normalizedAlias = normalizeHeaderString(alias);
      if (normalized === normalizedAlias || noSpace === normalizedAlias.replace(/\s+/g, '')) {
        return field as CanonicalFieldKey;
      }
    }
  }

  return null;
}

export interface HeaderMappingResult {
  headerToField: Record<string, CanonicalFieldKey>;
  missingRequiredFields: CanonicalFieldKey[];
}

/**
 * Inspects raw headers and builds a mapping to canonical fields,
 * checking whether all required columns are present.
 */
export function mapHeaders(rawHeaders: string[]): HeaderMappingResult {
  const headerToField: Record<string, CanonicalFieldKey> = {};
  const matchedFields = new Set<CanonicalFieldKey>();

  for (const header of rawHeaders) {
    if (!header || typeof header !== 'string') continue;
    const trimmed = header.trim();
    if (!trimmed) continue;

    const matchedField = matchHeaderToCanonicalField(trimmed);
    if (matchedField && !matchedFields.has(matchedField)) {
      headerToField[trimmed] = matchedField;
      matchedFields.add(matchedField);
    }
  }

  const missingRequiredFields = REQUIRED_FIELDS.filter((req) => !matchedFields.has(req));

  return {
    headerToField,
    missingRequiredFields
  };
}

/**
 * Validates header mapping and throws a structured ValidationError if required headers are missing.
 */
export function validateHeaders(rawHeaders: string[]): Record<string, CanonicalFieldKey> {
  if (!rawHeaders || rawHeaders.length === 0) {
    throw new ValidationError('Uploaded schedule file has no header columns');
  }

  const { headerToField, missingRequiredFields } = mapHeaders(rawHeaders);

  if (missingRequiredFields.length > 0) {
    const missingNames = missingRequiredFields
      .map((field) => `${FIELD_DISPLAY_NAMES[field]} (${field})`)
      .join(', ');
    throw new ValidationError(
      `Missing required schedule column(s): ${missingNames}. Required columns: Activity ID, Activity Name, Start Date, Finish Date.`
    );
  }

  return headerToField;
}

/**
 * Transforms a raw row dictionary into a CanonicalScheduleImportRow.
 */
export function transformRowToCanonical(
  rawRow: Record<string, unknown>,
  headerToField: Record<string, CanonicalFieldKey>,
  rowNumber: number
): CanonicalScheduleImportRow | null {
  const rowData: Partial<Record<CanonicalFieldKey, unknown>> = {};
  let hasAnyValue = false;

  for (const [rawHeader, value] of Object.entries(rawRow)) {
    const canonicalKey = headerToField[rawHeader] || matchHeaderToCanonicalField(rawHeader);
    if (canonicalKey) {
      rowData[canonicalKey] = value;
      if (value !== null && value !== undefined && String(value).trim() !== '') {
        hasAnyValue = true;
      }
    }
  }

  // Skip completely empty trailing row
  if (!hasAnyValue) {
    return null;
  }

  // Extract and validate required fields
  const externalIdRaw = rowData.externalId !== undefined && rowData.externalId !== null ? String(rowData.externalId).trim() : '';
  const nameRaw = rowData.name !== undefined && rowData.name !== null ? String(rowData.name).trim() : '';
  const startRaw = rowData.plannedStart !== undefined && rowData.plannedStart !== null ? String(rowData.plannedStart).trim() : '';
  const finishRaw = rowData.plannedFinish !== undefined && rowData.plannedFinish !== null ? String(rowData.plannedFinish).trim() : '';

  const missingRowFields: string[] = [];
  if (!externalIdRaw) missingRowFields.push('Activity ID');
  if (!nameRaw) missingRowFields.push('Activity Name');
  if (!startRaw) missingRowFields.push('Start Date');
  if (!finishRaw) missingRowFields.push('Finish Date');

  if (missingRowFields.length > 0) {
    throw new ValidationError(
      `Row ${rowNumber}: Missing required field(s): ${missingRowFields.join(', ')}`
    );
  }

  // Optional fields
  const description =
    rowData.description !== undefined && rowData.description !== null
      ? String(rowData.description).trim() || null
      : null;

  const wbsCode =
    rowData.wbsCode !== undefined && rowData.wbsCode !== null
      ? String(rowData.wbsCode).trim() || null
      : null;

  const location =
    rowData.location !== undefined && rowData.location !== null
      ? String(rowData.location).trim() || null
      : null;

  const unit =
    rowData.unit !== undefined && rowData.unit !== null
      ? String(rowData.unit).trim() || null
      : null;

  // Planned quantity parsing
  let plannedQuantity: number | null = null;
  if (rowData.plannedQuantity !== undefined && rowData.plannedQuantity !== null) {
    const qtyStr = String(rowData.plannedQuantity).trim();
    if (qtyStr !== '') {
      const parsedNum = normalizeNumber(qtyStr, 'planned quantity', rowNumber);
      if (parsedNum !== null && parsedNum < 0) {
        throw new ValidationError(
          `Row ${rowNumber}: Invalid planned quantity '${qtyStr}'. Must be a non-negative number.`
        );
      }
      plannedQuantity = parsedNum;
    }
  }


  const result: CanonicalScheduleImportRow = {
    externalId: externalIdRaw,
    name: nameRaw,
    plannedStart: startRaw,
    plannedFinish: finishRaw,
    description,
    wbsCode,
    location,
    plannedQuantity,
    unit
  };

  if (rowData.baselineProgress !== undefined && rowData.baselineProgress !== null) {
    result.baselineProgress = rowData.baselineProgress as string | number;
  }

  return result;
}


