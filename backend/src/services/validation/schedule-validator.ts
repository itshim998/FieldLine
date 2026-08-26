import { NormalizedScheduleActivity } from '../normalization/types.js';
import {
  ScheduleValidator,
  ScheduleValidationResult,
  ScheduleValidationIssue
} from './validation-types.js';

export class DefaultScheduleValidator implements ScheduleValidator {
  /**
   * Deterministically validates normalized schedule activities.
   * Collects all validation issues without short-circuiting on the first error.
   */
  validateSchedule(activities: NormalizedScheduleActivity[]): ScheduleValidationResult {
    const issues: ScheduleValidationIssue[] = [];

    // 1. Schedule must not be empty
    if (!activities || activities.length === 0) {
      issues.push({
        code: 'EMPTY_SCHEDULE',
        message: 'Schedule import contains no activities'
      });
      return {
        isValid: false,
        issues
      };
    }

    // 2. Duplicate Activity ID tracking across imported activities (case-insensitive)
    const seenExternalIds = new Map<string, { originalId: string; rowNumber: number }>();

    activities.forEach((activity, index) => {
      const rowNumber = activity.rowNumber ?? index + 2;

      // 3. Required / Critical fields
      const hasId = activity.externalId && activity.externalId.trim().length > 0;
      if (!hasId) {
        issues.push({
          code: 'REQUIRED_FIELD_MISSING',
          field: 'externalId',
          rowNumber,
          value: activity.externalId,
          message: `Row ${rowNumber}: Activity ID is required and cannot be empty`
        });
      } else {
        // Check uniqueness within the import batch
        const idLower = activity.externalId.trim().toLowerCase();
        const existing = seenExternalIds.get(idLower);
        if (existing) {
          issues.push({
            code: 'DUPLICATE_ACTIVITY_ID',
            field: 'externalId',
            rowNumber,
            value: activity.externalId,
            message: `Row ${rowNumber}: Duplicate activity ID '${activity.externalId}' (first defined in Row ${existing.rowNumber})`
          });
        } else {
          seenExternalIds.set(idLower, {
            originalId: activity.externalId,
            rowNumber
          });
        }
      }

      const hasName = activity.name && activity.name.trim().length > 0;
      if (!hasName) {
        issues.push({
          code: 'REQUIRED_FIELD_MISSING',
          field: 'name',
          rowNumber,
          value: activity.name,
          message: `Row ${rowNumber}: Activity Name is required and cannot be empty`
        });
      }

      const hasStart = activity.plannedStart && activity.plannedStart.trim().length > 0;
      if (!hasStart) {
        issues.push({
          code: 'REQUIRED_FIELD_MISSING',
          field: 'plannedStart',
          rowNumber,
          value: activity.plannedStart,
          message: `Row ${rowNumber}: Planned start date is required`
        });
      }

      const hasFinish = activity.plannedFinish && activity.plannedFinish.trim().length > 0;
      if (!hasFinish) {
        issues.push({
          code: 'REQUIRED_FIELD_MISSING',
          field: 'plannedFinish',
          rowNumber,
          value: activity.plannedFinish,
          message: `Row ${rowNumber}: Planned finish date is required`
        });
      }

      // 4. Date Ordering (plannedStart <= plannedFinish)
      if (hasStart && hasFinish) {
        if (activity.plannedStart > activity.plannedFinish) {
          issues.push({
            code: 'START_AFTER_FINISH',
            field: 'plannedFinish',
            rowNumber,
            value: activity.plannedFinish,
            message: `Row ${rowNumber}: Start date ${activity.plannedStart} is after finish date ${activity.plannedFinish}`
          });
        }
      }

      // 5. Percentage Validation (0 <= baselineProgress <= 100)
      if (activity.baselineProgress !== null && activity.baselineProgress !== undefined) {
        const prog = activity.baselineProgress;
        if (typeof prog !== 'number' || isNaN(prog) || !isFinite(prog) || prog < 0 || prog > 100) {
          issues.push({
            code: 'INVALID_PERCENTAGE',
            field: 'baselineProgress',
            rowNumber,
            value: prog,
            message: `Row ${rowNumber}: Baseline progress must be between 0 and 100 (got ${prog})`
          });
        }
      }

      // 6. Quantity Validation (plannedQuantity >= 0, finite)
      if (activity.plannedQuantity !== null && activity.plannedQuantity !== undefined) {
        const qty = activity.plannedQuantity;
        if (typeof qty !== 'number' || isNaN(qty) || !isFinite(qty) || qty < 0) {
          issues.push({
            code: 'INVALID_QUANTITY',
            field: 'plannedQuantity',
            rowNumber,
            value: qty,
            message: `Row ${rowNumber}: Planned quantity must be a non-negative finite number (got ${qty})`
          });
        }
      }
    });

    return {
      isValid: issues.length === 0,
      issues
    };
  }
}

export const scheduleValidator: ScheduleValidator = new DefaultScheduleValidator();
