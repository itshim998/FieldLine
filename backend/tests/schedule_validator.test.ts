import { describe, it, expect } from 'vitest';
import { DefaultScheduleValidator, scheduleValidator } from '../src/services/validation/schedule-validator.js';
import { NormalizedScheduleActivity } from '../src/services/normalization/types.js';

describe('ScheduleValidator', () => {
  const validator = new DefaultScheduleValidator();

  const createValidActivity = (overrides?: Partial<NormalizedScheduleActivity>): NormalizedScheduleActivity => ({
    externalId: 'ACT-001',
    name: 'Foundation Concrete Pour',
    plannedStart: '2026-04-01',
    plannedFinish: '2026-04-15',
    description: 'Pouring foundation footings',
    wbsCode: '1.1.2',
    location: 'Sector A',
    plannedQuantity: 450,
    unit: 'm3',
    baselineProgress: 0,
    rowNumber: 2,
    ...overrides
  });

  describe('Empty Schedule Validation', () => {
    it('should reject an empty activity list with EMPTY_SCHEDULE issue', () => {
      const result = validator.validateSchedule([]);
      expect(result.isValid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].code).toBe('EMPTY_SCHEDULE');
      expect(result.issues[0].message).toMatch(/contains no activities/i);
    });
  });

  describe('Required Fields Validation', () => {
    it('should accept activities with all required fields present', () => {
      const activities = [createValidActivity()];
      const result = validator.validateSchedule(activities);
      expect(result.isValid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should reject activity with missing or empty externalId', () => {
      const activities = [
        createValidActivity({ externalId: '', rowNumber: 2 }),
        createValidActivity({ externalId: '   ', rowNumber: 3 })
      ];
      const result = validator.validateSchedule(activities);
      expect(result.isValid).toBe(false);
      const idIssues = result.issues.filter((i) => i.code === 'REQUIRED_FIELD_MISSING' && i.field === 'externalId');
      expect(idIssues).toHaveLength(2);
      expect(idIssues[0].rowNumber).toBe(2);
      expect(idIssues[1].rowNumber).toBe(3);
    });

    it('should reject activity with missing or empty name', () => {
      const activities = [createValidActivity({ name: '   ', rowNumber: 4 })];
      const result = validator.validateSchedule(activities);
      expect(result.isValid).toBe(false);
      const nameIssues = result.issues.filter((i) => i.code === 'REQUIRED_FIELD_MISSING' && i.field === 'name');
      expect(nameIssues).toHaveLength(1);
      expect(nameIssues[0].rowNumber).toBe(4);
    });

    it('should reject activity with missing plannedStart or plannedFinish', () => {
      const activities = [
        createValidActivity({ plannedStart: '', rowNumber: 5 }),
        createValidActivity({ plannedFinish: '', rowNumber: 6 })
      ];
      const result = validator.validateSchedule(activities);
      expect(result.isValid).toBe(false);
      expect(result.issues.some((i) => i.field === 'plannedStart')).toBe(true);
      expect(result.issues.some((i) => i.field === 'plannedFinish')).toBe(true);
    });
  });

  describe('Date Ordering Validation', () => {
    it('should accept activities where plannedStart is strictly before plannedFinish', () => {
      const activities = [
        createValidActivity({ plannedStart: '2026-05-01', plannedFinish: '2026-05-15' })
      ];
      const result = validator.validateSchedule(activities);
      expect(result.isValid).toBe(true);
    });

    it('should accept milestone/same-day activities where plannedStart equals plannedFinish', () => {
      const activities = [
        createValidActivity({ plannedStart: '2026-05-10', plannedFinish: '2026-05-10' })
      ];
      const result = validator.validateSchedule(activities);
      expect(result.isValid).toBe(true);
    });

    it('should reject activity where plannedStart is after plannedFinish', () => {
      const activities = [
        createValidActivity({
          plannedStart: '2026-05-10',
          plannedFinish: '2026-05-01',
          rowNumber: 17
        })
      ];
      const result = validator.validateSchedule(activities);
      expect(result.isValid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]).toMatchObject({
        code: 'START_AFTER_FINISH',
        field: 'plannedFinish',
        rowNumber: 17,
        value: '2026-05-01'
      });
      expect(result.issues[0].message).toContain('Row 17: Start date 2026-05-10 is after finish date 2026-05-01');
    });
  });

  describe('Percentage Validation', () => {
    it('should accept valid boundary and standard baselineProgress values', () => {
      const activities = [
        createValidActivity({ externalId: 'ACT-1', baselineProgress: 0 }),
        createValidActivity({ externalId: 'ACT-2', baselineProgress: 50 }),
        createValidActivity({ externalId: 'ACT-3', baselineProgress: 100 }),
        createValidActivity({ externalId: 'ACT-4', baselineProgress: 33.33 })
      ];
      const result = validator.validateSchedule(activities);
      expect(result.isValid).toBe(true);
    });

    it('should reject negative baselineProgress', () => {
      const activities = [
        createValidActivity({ baselineProgress: -1, rowNumber: 8 })
      ];
      const result = validator.validateSchedule(activities);
      expect(result.isValid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]).toMatchObject({
        code: 'INVALID_PERCENTAGE',
        field: 'baselineProgress',
        rowNumber: 8,
        value: -1
      });
    });

    it('should reject baselineProgress exceeding 100', () => {
      const activities = [
        createValidActivity({ baselineProgress: 101, rowNumber: 9 })
      ];
      const result = validator.validateSchedule(activities);
      expect(result.isValid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].code).toBe('INVALID_PERCENTAGE');
    });

    it('should reject NaN or Infinity for baselineProgress', () => {
      const activities = [
        createValidActivity({ baselineProgress: NaN, rowNumber: 10 }),
        createValidActivity({ externalId: 'ACT-2', baselineProgress: Infinity, rowNumber: 11 })
      ];
      const result = validator.validateSchedule(activities);
      expect(result.isValid).toBe(false);
      expect(result.issues.filter((i) => i.code === 'INVALID_PERCENTAGE')).toHaveLength(2);
    });
  });

  describe('Quantity Validation', () => {
    it('should accept positive quantities and zero', () => {
      const activities = [
        createValidActivity({ externalId: 'ACT-1', plannedQuantity: 100 }),
        createValidActivity({ externalId: 'ACT-2', plannedQuantity: 0 }),
        createValidActivity({ externalId: 'ACT-3', plannedQuantity: 1250.75 }),
        createValidActivity({ externalId: 'ACT-4', plannedQuantity: null })
      ];
      const result = validator.validateSchedule(activities);
      expect(result.isValid).toBe(true);
    });

    it('should reject negative quantities', () => {
      const activities = [
        createValidActivity({ plannedQuantity: -10, rowNumber: 12 })
      ];
      const result = validator.validateSchedule(activities);
      expect(result.isValid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]).toMatchObject({
        code: 'INVALID_QUANTITY',
        field: 'plannedQuantity',
        rowNumber: 12,
        value: -10
      });
      expect(result.issues[0].message).toContain('Planned quantity must be a non-negative finite number');
    });

    it('should reject NaN or Infinity for plannedQuantity', () => {
      const activities = [
        createValidActivity({ plannedQuantity: NaN, rowNumber: 13 }),
        createValidActivity({ externalId: 'ACT-2', plannedQuantity: Infinity, rowNumber: 14 })
      ];
      const result = validator.validateSchedule(activities);
      expect(result.isValid).toBe(false);
      expect(result.issues.filter((i) => i.code === 'INVALID_QUANTITY')).toHaveLength(2);
    });

    it('should allow null unit when plannedQuantity is present', () => {
      const activities = [
        createValidActivity({ plannedQuantity: 500, unit: null })
      ];
      const result = validator.validateSchedule(activities);
      expect(result.isValid).toBe(true);
    });
  });

  describe('Duplicate Activity ID Detection', () => {
    it('should accept schedules with all unique activity IDs', () => {
      const activities = [
        createValidActivity({ externalId: 'ACT-101' }),
        createValidActivity({ externalId: 'ACT-102' }),
        createValidActivity({ externalId: 'ACT-103' })
      ];
      const result = validator.validateSchedule(activities);
      expect(result.isValid).toBe(true);
    });

    it('should reject duplicate activity IDs in the same schedule', () => {
      const activities = [
        createValidActivity({ externalId: 'ACT-001', rowNumber: 2 }),
        createValidActivity({ externalId: 'ACT-002', rowNumber: 3 }),
        createValidActivity({ externalId: 'ACT-001', rowNumber: 4 })
      ];
      const result = validator.validateSchedule(activities);
      expect(result.isValid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]).toMatchObject({
        code: 'DUPLICATE_ACTIVITY_ID',
        field: 'externalId',
        rowNumber: 4,
        value: 'ACT-001'
      });
      expect(result.issues[0].message).toContain('Duplicate activity ID \'ACT-001\'');
      expect(result.issues[0].message).toContain('first defined in Row 2');
    });

    it('should treat activity IDs case-insensitively for duplicate detection', () => {
      const activities = [
        createValidActivity({ externalId: 'ACT-100', rowNumber: 2 }),
        createValidActivity({ externalId: 'act-100', rowNumber: 5 })
      ];
      const result = validator.validateSchedule(activities);
      expect(result.isValid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].code).toBe('DUPLICATE_ACTIVITY_ID');
      expect(result.issues[0].rowNumber).toBe(5);
    });

    it('should not retain state across separate validation invocations', () => {
      const batch1 = [createValidActivity({ externalId: 'ACT-999' })];
      const batch2 = [createValidActivity({ externalId: 'ACT-999' })];

      const res1 = validator.validateSchedule(batch1);
      const res2 = validator.validateSchedule(batch2);

      expect(res1.isValid).toBe(true);
      expect(res2.isValid).toBe(true);
    });
  });

  describe('Multi-Error Aggregation', () => {
    it('should collect and report all distinct errors across multiple rows together', () => {
      const activities: NormalizedScheduleActivity[] = [
        // Row 2: Missing name
        createValidActivity({ externalId: 'ACT-01', name: '', rowNumber: 2 }),
        // Row 3: Duplicate ID (ACT-01) and Start after finish
        createValidActivity({
          externalId: 'ACT-01',
          name: 'Excavation',
          plannedStart: '2026-06-01',
          plannedFinish: '2026-05-01',
          rowNumber: 3
        }),
        // Row 4: Negative quantity
        createValidActivity({
          externalId: 'ACT-02',
          name: 'Grading',
          plannedQuantity: -100,
          rowNumber: 4
        }),
        // Row 5: Invalid percentage
        createValidActivity({
          externalId: 'ACT-03',
          name: 'Paving',
          baselineProgress: 150,
          rowNumber: 5
        })
      ];

      const result = validator.validateSchedule(activities);
      expect(result.isValid).toBe(false);
      expect(result.issues.length).toBeGreaterThanOrEqual(5);

      const codes = result.issues.map((i) => i.code);
      expect(codes).toContain('REQUIRED_FIELD_MISSING');
      expect(codes).toContain('DUPLICATE_ACTIVITY_ID');
      expect(codes).toContain('START_AFTER_FINISH');
      expect(codes).toContain('INVALID_QUANTITY');
      expect(codes).toContain('INVALID_PERCENTAGE');
    });
  });

  describe('Default scheduleValidator Singleton', () => {
    it('should export a working scheduleValidator instance', () => {
      expect(scheduleValidator).toBeDefined();
      const res = scheduleValidator.validateSchedule([createValidActivity()]);
      expect(res.isValid).toBe(true);
    });
  });
});
