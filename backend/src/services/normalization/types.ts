import { CanonicalScheduleImportRow } from '../../models/domain.types.js';

/**
 * Canonical normalized activity representation.
 * Downstream persistence receives this consistent representation
 * regardless of CSV/XLSX source formatting.
 */
export interface NormalizedScheduleActivity {
  externalId: string;
  name: string;
  plannedStart: string; // Canonical ISO date: YYYY-MM-DD
  plannedFinish: string; // Canonical ISO date: YYYY-MM-DD
  description: string | null;
  wbsCode: string | null;
  location: string | null;
  plannedQuantity: number | null;
  unit: string | null;
  baselineProgress: number; // 0.0 to 100.0 (default 0.0)
}

export interface ScheduleNormalizer {
  normalizeActivityRow(
    row: CanonicalScheduleImportRow,
    rowNumber?: number
  ): NormalizedScheduleActivity;

  normalizeScheduleRows(
    rows: CanonicalScheduleImportRow[]
  ): NormalizedScheduleActivity[];
}
