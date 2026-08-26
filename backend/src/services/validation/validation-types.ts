import { NormalizedScheduleActivity } from '../normalization/types.js';

export type ScheduleValidationIssueCode =
  | 'EMPTY_SCHEDULE'
  | 'REQUIRED_FIELD_MISSING'
  | 'DUPLICATE_ACTIVITY_ID'
  | 'START_AFTER_FINISH'
  | 'INVALID_PERCENTAGE'
  | 'INVALID_QUANTITY';

export interface ScheduleValidationIssue {
  code: ScheduleValidationIssueCode;
  message: string;
  rowNumber?: number;
  field?: string;
  value?: unknown;
}

export interface ScheduleValidationResult {
  isValid: boolean;
  issues: ScheduleValidationIssue[];
}

export interface ScheduleValidator {
  validateSchedule(activities: NormalizedScheduleActivity[]): ScheduleValidationResult;
}
