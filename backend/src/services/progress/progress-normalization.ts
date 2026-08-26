import { ActivityExecutionStatus } from '../../models/domain.types.js';
import { normalizeUnit } from '../normalization/unit-normalizer.js';
import {
  NormalizeProgressInput,
  ProgressNormalizationResult,
  PercentDerivationSource
} from './progress-normalization.types.js';

/**
 * Checks if two unit representations are compatible.
 * Uses conservative canonical unit normalization.
 */
export function areUnitsCompatible(
  inputUnit: string | null | undefined,
  activityUnit: string | null | undefined
): boolean {
  const normInput = normalizeUnit(inputUnit);
  const normActivity = normalizeUnit(activityUnit);

  // Both null/empty -> considered compatible
  if (!normInput && !normActivity) {
    return true;
  }

  // One specified, other missing -> incompatible
  if (!normInput || !normActivity) {
    return false;
  }

  return normInput.toLowerCase() === normActivity.toLowerCase();
}

/**
 * Maps Pass 8 extraction status to canonical ActivityExecutionStatus.
 */
export function mapExtractionStatus(
  extractionStatus: string,
  progressPercent: number | null,
  actualQuantity: number | null
): ActivityExecutionStatus {
  switch (extractionStatus) {
    case 'completed':
      return 'completed';
    case 'not_started':
      return 'not_started';
    case 'delayed':
      return 'delayed';
    case 'in_progress':
      return 'in_progress';
    case 'unknown':
    default:
      if (progressPercent === 100) {
        return 'completed';
      }
      if (progressPercent === 0 && (actualQuantity === null || actualQuantity === 0)) {
        return 'not_started';
      }
      return 'in_progress';
  }
}

/**
 * Pure deterministic progress normalization.
 *
 * Converts a structured field fact + matched activity into canonical progress observations.
 * - Does not perform network calls or AI queries.
 * - Calculates percentages via deterministic quantity math when valid data is available.
 * - Applies strict percentage precedence:
 *   1. Quantity-derived percentage
 *   2. Explicit reported percentage
 *   3. Completion status fallback (100%)
 *   4. Unavailable (null)
 * - Capping rule: caps at 100% while preserving physical actual quantity.
 * - Unit safety: verifies unit compatibility conservatively before division.
 */
export function normalizeProgress(input: NormalizeProgressInput): ProgressNormalizationResult {
  const { fact, activity, actualQuantity = null, quantityUnit = null, asOfDate } = input;

  const notesProvenance: string[] = [];
  let actualPercent: number | null = null;
  let percentSource: PercentDerivationSource = 'unavailable';
  const effectiveAsOfDate = asOfDate || new Date().toISOString().split('T')[0];

  // 1. Determine unit compatibility if actual quantity is supplied
  const hasActualQuantity =
    actualQuantity !== null &&
    actualQuantity !== undefined &&
    typeof actualQuantity === 'number' &&
    !isNaN(actualQuantity) &&
    actualQuantity >= 0;

  const hasPlannedQuantity =
    activity.plannedQuantity !== null &&
    activity.plannedQuantity !== undefined &&
    typeof activity.plannedQuantity === 'number' &&
    !isNaN(activity.plannedQuantity) &&
    activity.plannedQuantity > 0;

  let unitsCompatible = false;
  if (hasActualQuantity) {
    unitsCompatible = areUnitsCompatible(quantityUnit, activity.unit);
    if (!unitsCompatible && (quantityUnit || activity.unit)) {
      notesProvenance.push(
        `Incompatible units: reported '${quantityUnit ?? 'none'}' vs planned '${activity.unit ?? 'none'}'; quantity-derived calculation skipped.`
      );
    }
  }

  // 2. Derive Percentage following strict precedence:
  // Precedence 1: Quantity-derived percentage
  if (hasActualQuantity && hasPlannedQuantity && unitsCompatible) {
    const rawCalculated = (actualQuantity / (activity.plannedQuantity as number)) * 100;
    const rounded = Math.round(rawCalculated * 100) / 100;

    if (rawCalculated > 100) {
      actualPercent = 100;
      notesProvenance.push(
        `Quantity-derived progress (${rounded}%) exceeded 100%; actual percent was capped at 100.`
      );
    } else {
      actualPercent = rounded;
      notesProvenance.push(
        `Quantity-derived progress: ${actualQuantity}/${activity.plannedQuantity} ${activity.unit ?? ''} (${actualPercent}%).`
      );
    }
    percentSource = 'quantity_derived';
  }
  // Precedence 2: Explicit reported percentage from extraction fact
  else if (
    fact.progress_percent !== null &&
    fact.progress_percent !== undefined &&
    typeof fact.progress_percent === 'number' &&
    !isNaN(fact.progress_percent)
  ) {
    actualPercent = Math.min(100, Math.max(0, fact.progress_percent));
    percentSource = 'reported_percent';
    notesProvenance.push(`Reported progress: ${actualPercent}%.`);
  }
  // Precedence 3: Completion status fallback
  else if (fact.status === 'completed') {
    actualPercent = 100;
    percentSource = 'completed_status';
    notesProvenance.push('Status is completed; progress normalized to 100%.');
  }
  // Precedence 4: Unavailable
  else {
    actualPercent = null;
    percentSource = 'unavailable';
    notesProvenance.push('No deterministic percentage could be safely derived.');
  }

  // 3. Status mapping
  let status = mapExtractionStatus(fact.status, actualPercent, hasActualQuantity ? actualQuantity : null);

  // If actual percent is 100% and fact status wasn't 'not_started' or 'delayed', default to completed
  if (actualPercent === 100 && fact.status !== 'delayed' && fact.status !== 'not_started') {
    status = 'completed';
  }

  // 4. Derive actualStart and actualFinish dates
  let actualStart: string | null = null;
  let actualFinish: string | null = null;

  if (status === 'started' || status === 'in_progress') {
    actualStart = effectiveAsOfDate;
    actualFinish = null;
  } else if (status === 'completed') {
    actualFinish = effectiveAsOfDate;
    actualStart = effectiveAsOfDate; // Default fallback; caller service reconciles with earliest history
  } else if (status === 'delayed' && actualPercent !== null && actualPercent > 0) {
    actualStart = effectiveAsOfDate;
    actualFinish = null;
  }

  // Assemble notes
  const combinedNotes = notesProvenance.length > 0 ? notesProvenance.join(' ') : null;

  return {
    actualPercent,
    actualQuantity: hasActualQuantity ? actualQuantity : null,
    status,
    percentSource,
    quantityUnit: quantityUnit ? normalizeUnit(quantityUnit) ?? quantityUnit : null,
    actualStart,
    actualFinish,
    asOfDate: effectiveAsOfDate,
    notes: combinedNotes,
    notesProvenance
  };
}
