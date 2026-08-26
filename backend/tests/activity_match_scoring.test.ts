import { describe, it, expect } from 'vitest';
import { scoreActivityCandidate } from '../src/services/matching/activity-match-scoring.js';
import { Activity } from '../src/models/domain.types.js';
import { FieldProgressItem } from '../src/ai/contracts/field-progress-extraction.contract.js';

function createMockActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: 'act-uuid-1',
    projectId: 'proj-uuid-1',
    scheduleId: 'sched-uuid-1',
    externalId: 'ACT-101',
    name: 'Foundation Excavation',
    description: 'Bulk excavation for foundation footings',
    wbsCode: '3.1',
    location: 'Block B',
    plannedStart: '2026-09-01',
    plannedFinish: '2026-09-15',
    plannedQuantity: 500,
    unit: 'm3',
    baselineProgress: 0,
    createdAt: '2026-08-26T00:00:00Z',
    updatedAt: '2026-08-26T00:00:00Z',
    ...overrides
  };
}

describe('Activity Match Scoring Engine', () => {
  describe('Layer 1: Exact ID Matching', () => {
    it('should assign exact_id method and near 1.0 confidence when reference is an exact external ID', () => {
      const activity = createMockActivity({ externalId: 'ACT-101' });
      const fact: FieldProgressItem = {
        reference: 'ACT-101',
        location: null,
        progress_percent: 50,
        status: 'in_progress'
      };

      const result = scoreActivityCandidate(fact, activity);

      expect(result.matchMethod).toBe('exact_id');
      expect(result.confidenceScore).toBeGreaterThanOrEqual(0.98);
      expect(result.rationale).toContain("Exact match with activity external ID 'ACT-101'");
    });

    it('should match case-insensitively for external IDs with hyphens or slashes', () => {
      const activity = createMockActivity({ externalId: 'ACT-001/A' });
      const fact: FieldProgressItem = {
        reference: 'act-001/a',
        location: null,
        progress_percent: 100,
        status: 'completed'
      };

      const result = scoreActivityCandidate(fact, activity);

      expect(result.matchMethod).toBe('exact_id');
      expect(result.confidenceScore).toBeGreaterThanOrEqual(0.98);
    });

    it('should NOT classify ordinary descriptive text as exact_id', () => {
      const activity = createMockActivity({
        externalId: 'ACT-101',
        name: 'Foundation Excavation'
      });
      const fact: FieldProgressItem = {
        reference: 'foundation excavation work',
        location: 'Block B',
        progress_percent: 60,
        status: 'in_progress'
      };

      const result = scoreActivityCandidate(fact, activity);

      expect(result.matchMethod).not.toBe('exact_id');
    });
  });

  describe('Layer 2: Strong Text Matching', () => {
    it('should score high confidence on strong text match with activity name', () => {
      const activity = createMockActivity({
        name: 'Foundation Excavation at Block B'
      });
      const fact: FieldProgressItem = {
        reference: 'foundation excavation',
        location: null,
        progress_percent: 60,
        status: 'in_progress'
      };

      const result = scoreActivityCandidate(fact, activity);

      expect(result.confidenceScore).toBeGreaterThanOrEqual(0.75);
      expect(result.rationale).toContain('Foundation Excavation at Block B');
    });

    it('should match against activity description when description has strong overlap', () => {
      const activity = createMockActivity({
        name: 'Civil Package Substructure',
        description: 'Underground pipeline trench excavation and bedding'
      });
      const fact: FieldProgressItem = {
        reference: 'pipeline trench excavation',
        location: null,
        progress_percent: 40,
        status: 'in_progress'
      };

      const result = scoreActivityCandidate(fact, activity);

      expect(result.confidenceScore).toBeGreaterThanOrEqual(0.60);
      expect(result.rationale).toContain('description');
    });
  });

  describe('Layer 3: Location and WBS Metadata Signals', () => {
    it('should score higher when field report location matches activity location', () => {
      const actSameLoc = createMockActivity({
        name: 'Foundation Excavation',
        location: 'Block B'
      });
      const actDiffLoc = createMockActivity({
        name: 'Foundation Excavation',
        location: 'Block C'
      });

      const factWithLoc: FieldProgressItem = {
        reference: 'foundation excavation',
        location: 'Block B',
        progress_percent: 60,
        status: 'in_progress'
      };

      const scoreSameLoc = scoreActivityCandidate(factWithLoc, actSameLoc);
      const scoreDiffLoc = scoreActivityCandidate(factWithLoc, actDiffLoc);

      expect(scoreSameLoc.confidenceScore).toBeGreaterThan(scoreDiffLoc.confidenceScore);
      expect(scoreSameLoc.matchMethod).toBe('wbs_location');
      expect(scoreSameLoc.rationale).toContain("Location 'Block B' aligns");
      expect(scoreDiffLoc.rationale).toContain("Location mismatch: reported 'Block B', activity specifies 'Block C'");
    });

    it('should not penalize an activity if field fact location is null/omitted', () => {
      const activity = createMockActivity({
        name: 'Foundation Excavation',
        location: 'Block B'
      });

      const factNoLoc: FieldProgressItem = {
        reference: 'foundation excavation',
        location: null,
        progress_percent: 60,
        status: 'in_progress'
      };

      const result = scoreActivityCandidate(factNoLoc, activity);

      expect(result.confidenceScore).toBeGreaterThanOrEqual(0.70);
      expect(result.rationale).not.toContain('mismatch');
    });

    it('should boost score when reference mentions WBS code', () => {
      const actWbs = createMockActivity({
        name: 'Foundation Excavation',
        wbsCode: '3.1',
        location: 'Block B'
      });

      const factWithWbs: FieldProgressItem = {
        reference: 'foundation excavation WBS 3.1',
        location: 'Block B',
        progress_percent: 60,
        status: 'in_progress'
      };

      const result = scoreActivityCandidate(factWithWbs, actWbs);

      expect(result.confidenceScore).toBeGreaterThanOrEqual(0.85);
      expect(result.rationale).toContain("WBS code '3.1'");
    });
  });

  describe('Ambiguity and Alternatives Ranking', () => {
    it('should distinguish and rank ambiguous activities logically', () => {
      const act1 = createMockActivity({
        id: '1',
        externalId: 'ACT-101',
        name: 'Foundation Excavation',
        location: 'Block B'
      });
      const act2 = createMockActivity({
        id: '2',
        externalId: 'ACT-102',
        name: 'Foundation Concrete',
        location: 'Block B'
      });
      const act3 = createMockActivity({
        id: '3',
        externalId: 'ACT-103',
        name: 'Column Rebar Installation',
        location: 'Block C'
      });

      const fact: FieldProgressItem = {
        reference: 'foundation excavation work',
        location: 'Block B',
        progress_percent: 75,
        status: 'in_progress'
      };

      const score1 = scoreActivityCandidate(fact, act1);
      const score2 = scoreActivityCandidate(fact, act2);
      const score3 = scoreActivityCandidate(fact, act3);

      expect(score1.confidenceScore).toBeGreaterThan(score2.confidenceScore);
      expect(score2.confidenceScore).toBeGreaterThan(score3.confidenceScore);
      expect(score1.confidenceScore).toBeGreaterThanOrEqual(0.80);
    });
  });

  describe('Low-confidence behavior', () => {
    it('should produce low score for generic or unrelated chatter', () => {
      const activity = createMockActivity({
        name: 'Pier P12 Pier Cap Concrete Pour',
        location: 'Pier P12'
      });

      const vagueFact: FieldProgressItem = {
        reference: 'Some general site cleaning and material shifting occurred today near gate 2',
        location: 'Gate 2',
        progress_percent: null,
        status: 'in_progress'
      };

      const result = scoreActivityCandidate(vagueFact, activity);

      expect(result.confidenceScore).toBeLessThan(0.40);
    });
  });
});
