import { describe, it, expect } from 'vitest';
import {
  classifyActivityRisk,
  calculateProjectRiskSummary,
  calculateProjectRiskStatus,
  STRONG_NEGATIVE_VARIANCE_THRESHOLD,
  NEAR_FINISH_WINDOW_DAYS
} from '../src/services/risk/risk-classification.calculator.js';
import {
  ActivityProgressSnapshotItem,
  ProjectProgressSnapshot
} from '../src/services/risk/risk-classification.types.js';

function createSnapshotItem(
  overrides?: Partial<ActivityProgressSnapshotItem>
): ActivityProgressSnapshotItem {
  return {
    activityId: 'act-1',
    externalId: 'ACT-001',
    name: 'Foundation Work',
    wbsCode: '1.1',
    location: 'Zone A',
    plannedStart: '2026-08-01',
    plannedFinish: '2026-08-20',
    plannedDurationDays: 19,
    actualStart: '2026-08-01',
    actualFinish: null,
    plannedProgress: 50,
    actualProgress: 50,
    progressVariance: 0,
    varianceState: 'on_plan',
    status: 'in_progress',
    overdue: false,
    ...overrides
  };
}

describe('Risk Classification Calculator (Pure Engine)', () => {
  const asOfDate = '2026-08-10';

  describe('Rule 1: COMPLETED', () => {
    it('should classify as COMPLETED when status is completed', () => {
      const item = createSnapshotItem({
        status: 'completed',
        actualProgress: 80 // Even if actualProgress is < 100, status === completed triggers COMPLETED
      });

      const result = classifyActivityRisk(item, asOfDate);
      expect(result.classification).toBe('COMPLETED');
      expect(result.reasons).toEqual([
        {
          code: 'completed',
          message: 'Activity execution status is completed.'
        }
      ]);
    });

    it('should classify as COMPLETED when actualProgress is >= 100 even if status is in_progress', () => {
      const item = createSnapshotItem({
        status: 'in_progress',
        actualProgress: 100
      });

      const result = classifyActivityRisk(item, asOfDate);
      expect(result.classification).toBe('COMPLETED');
      expect(result.reasons).toEqual([
        {
          code: 'completed',
          message: 'Actual progress has reached 100%.'
        }
      ]);
    });

    it('should prioritize COMPLETED over positive variance (AHEAD)', () => {
      const item = createSnapshotItem({
        status: 'completed',
        actualProgress: 100,
        plannedProgress: 50,
        progressVariance: 50,
        varianceState: 'ahead'
      });

      const result = classifyActivityRisk(item, asOfDate);
      expect(result.classification).toBe('COMPLETED');
    });

    it('should prioritize COMPLETED over past planned finish (DELAYED / overdue)', () => {
      const item = createSnapshotItem({
        plannedFinish: '2026-08-05', // Passed
        status: 'completed',
        actualProgress: 100,
        overdue: false
      });

      const result = classifyActivityRisk(item, asOfDate);
      expect(result.classification).toBe('COMPLETED');
    });
  });

  describe('Rule 2: DELAYED', () => {
    it('should classify as DELAYED when plannedFinish has passed and actualProgress < 100', () => {
      const item = createSnapshotItem({
        plannedFinish: '2026-08-05',
        actualProgress: 60,
        plannedProgress: 100,
        progressVariance: -40,
        varianceState: 'behind',
        overdue: true
      });

      const result = classifyActivityRisk(item, asOfDate);
      expect(result.classification).toBe('DELAYED');
      expect(result.reasons).toEqual([
        {
          code: 'overdue',
          message: 'Planned finish date has passed while actual progress remains below 100%.'
        }
      ]);
    });

    it('should prioritize DELAYED over AT_RISK signals when overdue', () => {
      const item = createSnapshotItem({
        plannedFinish: '2026-08-05',
        actualProgress: 40,
        plannedProgress: 100,
        progressVariance: -60, // Strong negative variance
        status: 'delayed', // Delayed status
        varianceState: 'behind',
        overdue: true
      });

      const result = classifyActivityRisk(item, asOfDate);
      expect(result.classification).toBe('DELAYED');
    });
  });

  describe('Rule 3: AT_RISK', () => {
    it('Signal A: should classify as AT_RISK on strong negative variance (<= -10.0)', () => {
      const item = createSnapshotItem({
        plannedFinish: '2026-08-25', // 15 days away, not near finish
        plannedProgress: 60,
        actualProgress: 48,
        progressVariance: -12,
        varianceState: 'behind'
      });

      const result = classifyActivityRisk(item, asOfDate);
      expect(result.classification).toBe('AT_RISK');
      expect(result.reasons).toEqual([
        {
          code: 'strong_negative_variance',
          message: 'Actual progress is 12 percentage points behind planned progress.'
        }
      ]);
    });

    it('Signal A: should classify as AT_RISK exactly at the -10.0 boundary', () => {
      const item = createSnapshotItem({
        plannedFinish: '2026-08-25',
        plannedProgress: 50,
        actualProgress: 40,
        progressVariance: STRONG_NEGATIVE_VARIANCE_THRESHOLD, // -10.0
        varianceState: 'behind'
      });

      const result = classifyActivityRisk(item, asOfDate);
      expect(result.classification).toBe('AT_RISK');
    });

    it('Signal B+C: should classify as AT_RISK when near finish (<= 3 days) AND behind plan', () => {
      const item = createSnapshotItem({
        plannedFinish: '2026-08-12', // 2 days away
        plannedProgress: 90,
        actualProgress: 82,
        progressVariance: -8, // Smaller than strong threshold (-10), but near finish
        varianceState: 'behind'
      });

      const result = classifyActivityRisk(item, asOfDate);
      expect(result.classification).toBe('AT_RISK');
      expect(result.reasons).toEqual([
        {
          code: 'near_finish_and_behind',
          message: 'Activity is within 3 days of planned finish and remains behind planned progress.'
        }
      ]);
    });

    it('Signal B+C: should classify as AT_RISK when on the planned finish date (0 days remaining) AND behind plan', () => {
      const item = createSnapshotItem({
        plannedFinish: '2026-08-10', // 0 days remaining (asOfDate === plannedFinish)
        plannedProgress: 100,
        actualProgress: 95,
        progressVariance: -5,
        varianceState: 'behind',
        overdue: false // Not overdue yet because snapshotDate is NOT > plannedFinish
      });

      const result = classifyActivityRisk(item, asOfDate);
      expect(result.classification).toBe('AT_RISK');
    });

    it('Signal B+C: should classify as AT_RISK at exactly 3 days remaining boundary', () => {
      const item = createSnapshotItem({
        plannedFinish: '2026-08-13', // exactly NEAR_FINISH_WINDOW_DAYS (3 days)
        plannedProgress: 75,
        actualProgress: 73,
        progressVariance: -2,
        varianceState: 'behind'
      });

      const result = classifyActivityRisk(item, asOfDate);
      expect(result.classification).toBe('AT_RISK');
    });

    it('Signal D: should classify as AT_RISK when status is delayed before finish date', () => {
      const item = createSnapshotItem({
        plannedFinish: '2026-08-25',
        status: 'delayed',
        plannedProgress: 30,
        actualProgress: 25,
        progressVariance: -5,
        varianceState: 'behind'
      });

      const result = classifyActivityRisk(item, asOfDate);
      expect(result.classification).toBe('AT_RISK');
      expect(result.reasons).toContainEqual({
        code: 'delayed_status',
        message: 'Activity execution status is marked as delayed.'
      });
    });

    it('should aggregate multiple risk reasons if multiple signals apply', () => {
      const item = createSnapshotItem({
        plannedFinish: '2026-08-12', // 2 days away (near finish)
        plannedProgress: 80,
        actualProgress: 65,
        progressVariance: -15, // strong negative variance
        status: 'delayed', // delayed status
        varianceState: 'behind'
      });

      const result = classifyActivityRisk(item, asOfDate);
      expect(result.classification).toBe('AT_RISK');
      expect(result.reasons).toHaveLength(3);
      expect(result.reasons.map(r => r.code)).toEqual([
        'strong_negative_variance',
        'near_finish_and_behind',
        'delayed_status'
      ]);
    });
  });

  describe('Rule 4: AHEAD', () => {
    it('should classify as AHEAD on healthy positive variance', () => {
      const item = createSnapshotItem({
        plannedProgress: 40,
        actualProgress: 55,
        progressVariance: 15,
        varianceState: 'ahead'
      });

      const result = classifyActivityRisk(item, asOfDate);
      expect(result.classification).toBe('AHEAD');
      expect(result.reasons).toEqual([
        {
          code: 'positive_variance',
          message: 'Actual progress is 15 percentage points ahead of planned progress.'
        }
      ]);
    });

    it('should classify as AHEAD near finish when ahead of plan', () => {
      const item = createSnapshotItem({
        plannedFinish: '2026-08-12', // 2 days away
        plannedProgress: 85,
        actualProgress: 90,
        progressVariance: 5,
        varianceState: 'ahead'
      });

      const result = classifyActivityRisk(item, asOfDate);
      expect(result.classification).toBe('AHEAD');
    });
  });

  describe('Rule 5: ON_TRACK', () => {
    it('should classify as ON_TRACK when variance is 0', () => {
      const item = createSnapshotItem({
        plannedProgress: 50,
        actualProgress: 50,
        progressVariance: 0,
        varianceState: 'on_plan'
      });

      const result = classifyActivityRisk(item, asOfDate);
      expect(result.classification).toBe('ON_TRACK');
      expect(result.reasons).toEqual([
        {
          code: 'within_plan',
          message: 'Activity progress is on track with planned schedule.'
        }
      ]);
    });

    it('should NOT trigger risk merely because finish is near if on plan', () => {
      const item = createSnapshotItem({
        plannedFinish: '2026-08-12', // 2 days away
        plannedProgress: 80,
        actualProgress: 80,
        progressVariance: 0,
        varianceState: 'on_plan'
      });

      const result = classifyActivityRisk(item, asOfDate);
      expect(result.classification).toBe('ON_TRACK');
    });

    it('should classify as ON_TRACK when negative variance is small and finish is far away', () => {
      const item = createSnapshotItem({
        plannedFinish: '2026-08-30', // 20 days away (> 3 days)
        plannedProgress: 30,
        actualProgress: 25,
        progressVariance: -5, // > -10 (not strong negative variance)
        varianceState: 'behind',
        status: 'in_progress'
      });

      const result = classifyActivityRisk(item, asOfDate);
      expect(result.classification).toBe('ON_TRACK');
    });
  });

  describe('Zero-Duration Milestone Handling', () => {
    const milestoneDate = '2026-08-15';

    it('before milestone date with 0% actual => ON_TRACK', () => {
      const item = createSnapshotItem({
        plannedStart: milestoneDate,
        plannedFinish: milestoneDate,
        plannedDurationDays: 0,
        plannedProgress: 0,
        actualProgress: 0,
        progressVariance: 0,
        varianceState: 'on_plan',
        status: 'not_started'
      });

      const result = classifyActivityRisk(item, '2026-08-13'); // 2 days before milestone
      expect(result.classification).toBe('ON_TRACK');
    });

    it('on milestone date with 0% actual => AT_RISK (planned 100%, variance -100%)', () => {
      const item = createSnapshotItem({
        plannedStart: milestoneDate,
        plannedFinish: milestoneDate,
        plannedDurationDays: 0,
        plannedProgress: 100,
        actualProgress: 0,
        progressVariance: -100,
        varianceState: 'behind',
        status: 'not_started',
        overdue: false
      });

      const result = classifyActivityRisk(item, '2026-08-15');
      expect(result.classification).toBe('AT_RISK');
    });

    it('after milestone date with < 100% actual => DELAYED (overdue)', () => {
      const item = createSnapshotItem({
        plannedStart: milestoneDate,
        plannedFinish: milestoneDate,
        plannedDurationDays: 0,
        plannedProgress: 100,
        actualProgress: 0,
        progressVariance: -100,
        varianceState: 'behind',
        status: 'not_started',
        overdue: true
      });

      const result = classifyActivityRisk(item, '2026-08-16');
      expect(result.classification).toBe('DELAYED');
    });

    it('on or after milestone date with 100% actual => COMPLETED', () => {
      const item = createSnapshotItem({
        plannedStart: milestoneDate,
        plannedFinish: milestoneDate,
        plannedDurationDays: 0,
        plannedProgress: 100,
        actualProgress: 100,
        progressVariance: 0,
        varianceState: 'on_plan',
        status: 'completed',
        overdue: false
      });

      const result = classifyActivityRisk(item, '2026-08-16');
      expect(result.classification).toBe('COMPLETED');
    });
  });

  describe('calculateProjectRiskSummary & calculateProjectRiskStatus', () => {
    it('should aggregate summary counts correctly across a mixed project', () => {
      const activities: ActivityProgressSnapshotItem[] = [
        createSnapshotItem({ activityId: '1', status: 'completed', actualProgress: 100 }), // COMPLETED
        createSnapshotItem({ activityId: '2', status: 'completed', actualProgress: 100 }), // COMPLETED
        createSnapshotItem({ activityId: '3', overdue: true, actualProgress: 50, plannedFinish: '2026-08-01' }), // DELAYED
        createSnapshotItem({ activityId: '4', progressVariance: -15, varianceState: 'behind' }), // AT_RISK
        createSnapshotItem({ activityId: '5', plannedFinish: '2026-08-12', progressVariance: -5, varianceState: 'behind' }), // AT_RISK
        createSnapshotItem({ activityId: '6', progressVariance: 10, varianceState: 'ahead' }), // AHEAD
        createSnapshotItem({ activityId: '7', progressVariance: 0, varianceState: 'on_plan' }), // ON_TRACK
        createSnapshotItem({ activityId: '8', progressVariance: 0, varianceState: 'on_plan' })  // ON_TRACK
      ];

      const snapshot: ProjectProgressSnapshot = {
        projectId: 'proj-123',
        asOfDate: '2026-08-10',
        generatedAt: '2026-08-10T12:00:00.000Z',
        activities,
        summary: {
          totalActivities: 8,
          notStarted: 0,
          started: 0,
          inProgress: 6,
          completed: 2,
          delayed: 0,
          overdue: 1,
          ahead: 1,
          onPlan: 4,
          behind: 3
        }
      };

      const result = calculateProjectRiskStatus(snapshot);

      expect(result.projectId).toBe('proj-123');
      expect(result.asOfDate).toBe('2026-08-10');
      expect(result.activities).toHaveLength(8);
      expect(result.summary).toEqual({
        totalActivities: 8,
        completed: 2,
        delayed: 1,
        atRisk: 2,
        ahead: 1,
        onTrack: 2,
        overdueCount: 1
      });

      // Invariant: sum of categories === totalActivities
      const sum =
        result.summary.completed +
        result.summary.delayed +
        result.summary.atRisk +
        result.summary.ahead +
        result.summary.onTrack;
      expect(sum).toBe(result.summary.totalActivities);
    });

    it('should be 100% deterministic on repeated runs', () => {
      const item = createSnapshotItem({
        progressVariance: -12,
        varianceState: 'behind'
      });

      const res1 = classifyActivityRisk(item, asOfDate);
      const res2 = classifyActivityRisk(item, asOfDate);

      expect(res1).toEqual(res2);
    });
  });
});
