import { describe, it, expect } from 'vitest';
import {
  DefaultScheduleNormalizer,
  scheduleNormalizer
} from '../src/services/normalization/schedule-normalizer.js';
import { CanonicalScheduleImportRow } from '../src/models/domain.types.js';
import { NormalizationError } from '../src/services/normalization/normalizationError.js';

describe('Schedule Normalizer', () => {
  const normalizer = new DefaultScheduleNormalizer();

  it('should normalize a valid canonical row into a NormalizedScheduleActivity', () => {
    const rawRow: CanonicalScheduleImportRow = {
      externalId: '  ACT-101  ',
      name: '  Earthworks   &   Excavation  ',
      plannedStart: '2026-04-01',
      plannedFinish: '2026-04-30',
      description: '  Deep   foundation excavation  ',
      wbsCode: '  1.1  ',
      location: '  Sector   A  ',
      plannedQuantity: '1,250.50',
      unit: '  m3  ',
      baselineProgress: '0%'
    };

    const normalized = normalizer.normalizeActivityRow(rawRow, 2);

    expect(normalized).toEqual({
      externalId: 'ACT-101',
      name: 'Earthworks & Excavation',
      plannedStart: '2026-04-01',
      plannedFinish: '2026-04-30',
      description: 'Deep foundation excavation',
      wbsCode: '1.1',
      location: 'Sector A',
      plannedQuantity: 1250.5,
      unit: 'm3',
      baselineProgress: 0.0
    });
  });

  it('should handle missing optional fields cleanly converting them to null', () => {
    const rawRow: CanonicalScheduleImportRow = {
      externalId: 'ACT-202',
      name: 'Piling Works',
      plannedStart: '2026-05-01',
      plannedFinish: '2026-05-15',
      description: '   ',
      wbsCode: '',
      location: null,
      plannedQuantity: null,
      unit: '   '
    };

    const normalized = normalizer.normalizeActivityRow(rawRow, 3);

    expect(normalized.description).toBeNull();
    expect(normalized.wbsCode).toBeNull();
    expect(normalized.location).toBeNull();
    expect(normalized.plannedQuantity).toBeNull();
    expect(normalized.unit).toBeNull();
    expect(normalized.baselineProgress).toBe(0.0);
  });

  it('should normalize an array of rows with row index in errors', () => {
    const rows: CanonicalScheduleImportRow[] = [
      {
        externalId: 'ACT-01',
        name: 'Task 1',
        plannedStart: '2026-01-01',
        plannedFinish: '2026-01-10'
      },
      {
        externalId: 'ACT-02',
        name: 'Task 2',
        plannedStart: '31/31/2026', // invalid date
        plannedFinish: '2026-02-15'
      }
    ];

    expect(() => normalizer.normalizeScheduleRows(rows)).toThrow(NormalizationError);
    expect(() => normalizer.normalizeScheduleRows(rows)).toThrow(/Row 3: Could not normalize Start Date '31\/31\/2026'/);
  });

  it('should export singleton scheduleNormalizer instance', () => {
    expect(scheduleNormalizer).toBeInstanceOf(DefaultScheduleNormalizer);
  });
});
