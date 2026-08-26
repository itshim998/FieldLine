import { describe, it, expect } from 'vitest';
import {
  diffInCalendarDays,
  calculatePlannedProgress,
  calculateVariance,
  isOverdue,
  calculateActivitySnapshot,
  calculateSnapshotSummary,
  calculateProjectSnapshot
} from '../src/services/snapshot/progress-snapshot.calculator.js';
import { Activity, ActivityProgress } from '../src/models/domain.types.js';
import { ValidationError } from '../src/errors/AppError.js';

describe('Progress Snapshot Calculator (Pure Engine)', () => {
  describe('diffInCalendarDays', () => {
    it('should calculate standard whole calendar day difference', () => {
      expect(diffInCalendarDays('2026-08-01', '2026-08-11')).toBe(10);
      expect(diffInCalendarDays('2026-08-01', '2026-08-01')).toBe(0);
      expect(diffInCalendarDays('2026-08-11', '2026-08-01')).toBe(-10);
    });

    it('should calculate across month and year boundaries correctly', () => {
      expect(diffInCalendarDays('2026-01-31', '2026-02-01')).toBe(1);
      expect(diffInCalendarDays('2026-12-31', '2027-01-01')).toBe(1);
      // Leap year 2024
      expect(diffInCalendarDays('2024-02-28', '2024-03-01')).toBe(2);
      // Non-leap year 2026
      expect(diffInCalendarDays('2026-02-28', '2026-03-01')).toBe(1);
    });

    it('should throw ValidationError on malformed dates', () => {
      expect(() => diffInCalendarDays('invalid', '2026-08-11')).toThrow(ValidationError);
      expect(() => diffInCalendarDays('2026-08-01', '08-11-2026')).toThrow(ValidationError);
    });
  });

  describe('calculatePlannedProgress', () => {
    const plannedStart = '2026-08-01';
    const plannedFinish = '2026-08-11'; // 10 days duration

    it('should return 0% before planned start', () => {
      const res = calculatePlannedProgress(plannedStart, plannedFinish, '2026-07-31');
      expect(res.plannedDurationDays).toBe(10);
      expect(res.plannedProgress).toBe(0);
    });

    it('should return 0% on planned start date (elapsed = 0)', () => {
      const res = calculatePlannedProgress(plannedStart, plannedFinish, '2026-08-01');
      expect(res.plannedDurationDays).toBe(10);
      expect(res.plannedProgress).toBe(0);
    });

    it('should return 50% at midpoint (5 elapsed / 10 days)', () => {
      const res = calculatePlannedProgress(plannedStart, plannedFinish, '2026-08-06');
      expect(res.plannedDurationDays).toBe(10);
      expect(res.plannedProgress).toBe(50);
    });

    it('should return 100% on planned finish date', () => {
      const res = calculatePlannedProgress(plannedStart, plannedFinish, '2026-08-11');
      expect(res.plannedDurationDays).toBe(10);
      expect(res.plannedProgress).toBe(100);
    });

    it('should return 100% after planned finish date', () => {
      const res = calculatePlannedProgress(plannedStart, plannedFinish, '2026-08-20');
      expect(res.plannedDurationDays).toBe(10);
      expect(res.plannedProgress).toBe(100);
    });

    it('should handle zero duration milestones (start === finish)', () => {
      const milestone = '2026-08-15';
      const before = calculatePlannedProgress(milestone, milestone, '2026-08-14');
      expect(before.plannedDurationDays).toBe(0);
      expect(before.plannedProgress).toBe(0);

      const onDate = calculatePlannedProgress(milestone, milestone, '2026-08-15');
      expect(onDate.plannedDurationDays).toBe(0);
      expect(onDate.plannedProgress).toBe(100);

      const afterDate = calculatePlannedProgress(milestone, milestone, '2026-08-16');
      expect(afterDate.plannedDurationDays).toBe(0);
      expect(afterDate.plannedProgress).toBe(100);
    });

    it('should throw ValidationError if plannedFinish < plannedStart', () => {
      expect(() =>
        calculatePlannedProgress('2026-08-15', '2026-08-10', '2026-08-12', 'ACT-INVALID')
      ).toThrow(ValidationError);
    });
  });

  describe('calculateVariance', () => {
    it('should calculate negative variance (behind plan)', () => {
      const res = calculateVariance(40, 60);
      expect(res.progressVariance).toBe(-20);
      expect(res.varianceState).toBe('behind');
    });

    it('should calculate positive variance (ahead of plan)', () => {
      const res = calculateVariance(60, 40);
      expect(res.progressVariance).toBe(20);
      expect(res.varianceState).toBe('ahead');
    });

    it('should calculate zero variance (on plan)', () => {
      const res = calculateVariance(50, 50);
      expect(res.progressVariance).toBe(0);
      expect(res.varianceState).toBe('on_plan');
    });

    it('should respect tolerance boundaries around +/-0.01', () => {
      // Within +/-0.01 tolerance -> on_plan
      expect(calculateVariance(50.005, 50).varianceState).toBe('on_plan');
      expect(calculateVariance(49.995, 50).varianceState).toBe('on_plan');

      // Beyond tolerance -> ahead / behind
      expect(calculateVariance(50.02, 50).varianceState).toBe('ahead');
      expect(calculateVariance(49.98, 50).varianceState).toBe('behind');
    });
  });

  describe('isOverdue', () => {
    const plannedFinish = '2026-08-20';

    it('should be overdue when snapshot > plannedFinish AND actual < 100', () => {
      expect(isOverdue(plannedFinish, 80, '2026-08-21')).toBe(true);
      expect(isOverdue(plannedFinish, 0, '2026-08-25')).toBe(true);
    });

    it('should NOT be overdue when snapshot > plannedFinish AND actual === 100', () => {
      expect(isOverdue(plannedFinish, 100, '2026-08-21')).toBe(false);
    });

    it('should NOT be overdue when snapshot <= plannedFinish even if behind schedule', () => {
      // Mid-schedule: snapshot is 2026-08-15 (finish is 2026-08-20), actual is only 10%
      expect(isOverdue(plannedFinish, 10, '2026-08-15')).toBe(false);
      // On finish date: snapshot is 2026-08-20
      expect(isOverdue(plannedFinish, 50, '2026-08-20')).toBe(false);
    });
  });

  describe('calculateActivitySnapshot', () => {
    const activity: Activity = {
      id: 'act-1',
      projectId: 'proj-1',
      scheduleId: 'sch-1',
      externalId: 'ACT-101',
      name: 'Excavation',
      description: 'Site excavation',
      wbsCode: '1.1',
      location: 'Zone A',
      plannedStart: '2026-08-01',
      plannedFinish: '2026-08-11',
      plannedQuantity: 500,
      unit: 'm3',
      baselineProgress: 0,
      createdAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-08-01T00:00:00Z'
    };

    it('should build activity snapshot when observation exists', () => {
      const observation: ActivityProgress = {
        id: 'prog-1',
        projectId: 'proj-1',
        activityId: 'act-1',
        progressUpdateId: 'upd-1',
        actualPercent: 40,
        actualQuantity: 200,
        actualStart: '2026-08-02',
        actualFinish: null,
        status: 'in_progress',
        asOfDate: '2026-08-06',
        notes: 'Good progress',
        createdAt: '2026-08-06T10:00:00Z',
        updatedAt: '2026-08-06T10:00:00Z'
      };

      const snapshot = calculateActivitySnapshot(activity, observation, '2026-08-06');

      expect(snapshot.activityId).toBe('act-1');
      expect(snapshot.externalId).toBe('ACT-101');
      expect(snapshot.name).toBe('Excavation');
      expect(snapshot.wbsCode).toBe('1.1');
      expect(snapshot.location).toBe('Zone A');
      expect(snapshot.plannedStart).toBe('2026-08-01');
      expect(snapshot.plannedFinish).toBe('2026-08-11');
      expect(snapshot.plannedDurationDays).toBe(10);
      expect(snapshot.actualStart).toBe('2026-08-02');
      expect(snapshot.actualFinish).toBeNull();
      expect(snapshot.plannedProgress).toBe(50);
      expect(snapshot.actualProgress).toBe(40);
      expect(snapshot.progressVariance).toBe(-10);
      expect(snapshot.varianceState).toBe('behind');
      expect(snapshot.status).toBe('in_progress');
      expect(snapshot.overdue).toBe(false);
    });

    it('should default cleanly when no observation exists', () => {
      const snapshot = calculateActivitySnapshot(activity, null, '2026-08-06');

      expect(snapshot.actualProgress).toBe(0);
      expect(snapshot.actualStart).toBeNull();
      expect(snapshot.actualFinish).toBeNull();
      expect(snapshot.status).toBe('not_started');
      expect(snapshot.plannedProgress).toBe(50);
      expect(snapshot.progressVariance).toBe(-50);
      expect(snapshot.varianceState).toBe('behind');
      expect(snapshot.overdue).toBe(false);
    });
  });

  describe('calculateSnapshotSummary and calculateProjectSnapshot', () => {
    it('should correctly calculate summary metrics across all activities', () => {
      const activities: Activity[] = [
        {
          id: 'act-1',
          projectId: 'proj-1',
          scheduleId: 'sch-1',
          externalId: 'ACT-1',
          name: 'Not Started Item',
          description: null,
          wbsCode: null,
          location: null,
          plannedStart: '2026-09-01',
          plannedFinish: '2026-09-10',
          plannedQuantity: null,
          unit: null,
          baselineProgress: 0,
          createdAt: '',
          updatedAt: ''
        },
        {
          id: 'act-2',
          projectId: 'proj-1',
          scheduleId: 'sch-1',
          externalId: 'ACT-2',
          name: 'Started Ahead',
          description: null,
          wbsCode: null,
          location: null,
          plannedStart: '2026-08-01',
          plannedFinish: '2026-08-31',
          plannedQuantity: null,
          unit: null,
          baselineProgress: 0,
          createdAt: '',
          updatedAt: ''
        },
        {
          id: 'act-3',
          projectId: 'proj-1',
          scheduleId: 'sch-1',
          externalId: 'ACT-3',
          name: 'Overdue Activity',
          description: null,
          wbsCode: null,
          location: null,
          plannedStart: '2026-07-01',
          plannedFinish: '2026-07-31',
          plannedQuantity: null,
          unit: null,
          baselineProgress: 0,
          createdAt: '',
          updatedAt: ''
        },
        {
          id: 'act-4',
          projectId: 'proj-1',
          scheduleId: 'sch-1',
          externalId: 'ACT-4',
          name: 'Completed On Time',
          description: null,
          wbsCode: null,
          location: null,
          plannedStart: '2026-07-01',
          plannedFinish: '2026-07-31',
          plannedQuantity: null,
          unit: null,
          baselineProgress: 0,
          createdAt: '',
          updatedAt: ''
        }
      ];

      const obsMap = new Map<string, ActivityProgress | null>();
      // act-1: no observation -> not_started, planned=0, actual=0 -> on_plan
      obsMap.set('act-1', null);

      // act-2: snapshot at 2026-08-16 (midpoint ~50%), actual=80% -> started, ahead
      obsMap.set('act-2', {
        id: 'obs-2',
        projectId: 'proj-1',
        activityId: 'act-2',
        progressUpdateId: null,
        actualPercent: 80,
        actualQuantity: null,
        actualStart: '2026-08-01',
        actualFinish: null,
        status: 'started',
        asOfDate: '2026-08-15',
        notes: null,
        createdAt: '',
        updatedAt: ''
      });

      // act-3: snapshot 2026-08-16 > finish 2026-07-31, actual=60% -> in_progress, overdue, behind
      obsMap.set('act-3', {
        id: 'obs-3',
        projectId: 'proj-1',
        activityId: 'act-3',
        progressUpdateId: null,
        actualPercent: 60,
        actualQuantity: null,
        actualStart: '2026-07-01',
        actualFinish: null,
        status: 'in_progress',
        asOfDate: '2026-08-15',
        notes: null,
        createdAt: '',
        updatedAt: ''
      });

      // act-4: snapshot 2026-08-16 > finish 2026-07-31, actual=100% -> completed, NOT overdue, on_plan
      obsMap.set('act-4', {
        id: 'obs-4',
        projectId: 'proj-1',
        activityId: 'act-4',
        progressUpdateId: null,
        actualPercent: 100,
        actualQuantity: null,
        actualStart: '2026-07-01',
        actualFinish: '2026-07-30',
        status: 'completed',
        asOfDate: '2026-08-15',
        notes: null,
        createdAt: '',
        updatedAt: ''
      });

      const snapshot = calculateProjectSnapshot(
        'proj-1',
        '2026-08-16',
        activities,
        obsMap,
        '2026-08-16T12:00:00Z'
      );

      expect(snapshot.projectId).toBe('proj-1');
      expect(snapshot.asOfDate).toBe('2026-08-16');
      expect(snapshot.generatedAt).toBe('2026-08-16T12:00:00Z');
      expect(snapshot.activities).toHaveLength(4);

      expect(snapshot.summary.totalActivities).toBe(4);
      expect(snapshot.summary.notStarted).toBe(1);
      expect(snapshot.summary.started).toBe(1);
      expect(snapshot.summary.inProgress).toBe(1);
      expect(snapshot.summary.completed).toBe(1);
      expect(snapshot.summary.delayed).toBe(0);
      expect(snapshot.summary.overdue).toBe(1); // act-3
      expect(snapshot.summary.ahead).toBe(1); // act-2
      expect(snapshot.summary.onPlan).toBe(2); // act-1, act-4
      expect(snapshot.summary.behind).toBe(1); // act-3
    });
  });
});
