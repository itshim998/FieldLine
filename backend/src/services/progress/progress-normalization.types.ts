import { Activity, ActivityExecutionStatus } from '../../models/domain.types.js';
import { FieldProgressItem } from '../../ai/contracts/field-progress-extraction.contract.js';

export type PercentDerivationSource =
  | 'quantity_derived'
  | 'reported_percent'
  | 'completed_status'
  | 'unavailable';

export interface NormalizeProgressInput {
  fact: FieldProgressItem;
  activity: Activity;
  actualQuantity?: number | null;
  quantityUnit?: string | null;
  asOfDate?: string | null;
}

export interface ProgressNormalizationResult {
  actualPercent: number | null;
  actualQuantity: number | null;
  status: ActivityExecutionStatus;
  percentSource: PercentDerivationSource;
  quantityUnit: string | null;
  actualStart: string | null;
  actualFinish: string | null;
  asOfDate: string;
  notes: string | null;
  notesProvenance: string[];
}
