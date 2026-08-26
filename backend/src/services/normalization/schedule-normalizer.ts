import { CanonicalScheduleImportRow } from '../../models/domain.types.js';
import { NormalizedScheduleActivity, ScheduleNormalizer } from './types.js';
import { normalizeIdentifier, normalizeName, normalizeOptionalText } from './text-normalizer.js';
import { normalizeDate } from './date-normalizer.js';
import { normalizeNumber, normalizePercentage } from './number-normalizer.js';
import { normalizeUnit } from './unit-normalizer.js';

export class DefaultScheduleNormalizer implements ScheduleNormalizer {
  /**
   * Normalizes a single canonical import row into a canonical NormalizedScheduleActivity.
   */
  normalizeActivityRow(
    row: CanonicalScheduleImportRow,
    rowNumber?: number
  ): NormalizedScheduleActivity {
    const externalId = normalizeIdentifier(row.externalId, 'Activity ID', rowNumber);
    const name = normalizeName(row.name, 'Activity Name', rowNumber);
    const plannedStart = normalizeDate(row.plannedStart, 'Start Date', rowNumber);
    const plannedFinish = normalizeDate(row.plannedFinish, 'Finish Date', rowNumber);
    const description = normalizeOptionalText(row.description);
    const wbsCode = normalizeOptionalText(row.wbsCode);
    const location = normalizeOptionalText(row.location);
    const plannedQuantity = normalizeNumber(row.plannedQuantity, 'Quantity', rowNumber);
    const unit = normalizeUnit(row.unit);
    const baselineProgress = normalizePercentage(row.baselineProgress ?? 0.0, 'Baseline Progress', rowNumber) ?? 0.0;

    return {
      externalId,
      name,
      plannedStart,
      plannedFinish,
      description,
      wbsCode,
      location,
      plannedQuantity,
      unit,
      baselineProgress
    };
  }

  /**
   * Normalizes an array of canonical import rows into canonical NormalizedScheduleActivity objects.
   * Uses row numbers starting at 2 (assuming row 1 is the header).
   */
  normalizeScheduleRows(
    rows: CanonicalScheduleImportRow[]
  ): NormalizedScheduleActivity[] {
    return rows.map((row, index) => {
      const rowNumber = index + 2;
      return this.normalizeActivityRow(row, rowNumber);
    });
  }
}

export const scheduleNormalizer: ScheduleNormalizer = new DefaultScheduleNormalizer();
