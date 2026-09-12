import { describe, it, expect, vi } from 'vitest';
import {
  DeterministicActivityResolver,
  stemConstructionToken,
  normalizeConstructionWord,
  normalizeActivityText
} from '../src/services/assistant/activity-resolver.js';
import { ActivityRepository } from '../src/repositories/activity.repository.js';
import { Activity } from '../src/models/domain.types.js';

describe('DeterministicActivityResolver (Pass 18 + Morphology Resolution)', () => {
  const project1Id = '11111111-1111-1111-1111-111111111111';
  const project2Id = '22222222-2222-2222-2222-222222222222';

  const mockProject1Activities: Activity[] = [
    {
      id: 'act-1',
      projectId: project1Id,
      scheduleId: 'sched-1',
      externalId: 'ACT-001',
      name: 'Foundation B - Concrete Pouring',
      description: null,
      wbsCode: '1.1',
      location: 'Block B',
      plannedStart: '2026-08-01',
      plannedFinish: '2026-08-15',
      plannedQuantity: 100,
      unit: 'm3',
      baselineProgress: 0,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z'
    },
    {
      id: 'act-2',
      projectId: project1Id,
      scheduleId: 'sched-1',
      externalId: 'ACT-002',
      name: 'Pier 12 Excavation',
      description: null,
      wbsCode: '1.2',
      location: 'North Sector',
      plannedStart: '2026-08-05',
      plannedFinish: '2026-08-20',
      plannedQuantity: 50,
      unit: 'm3',
      baselineProgress: 0,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z'
    },
    {
      id: 'act-3',
      projectId: project1Id,
      scheduleId: 'sched-1',
      externalId: 'ACT-003',
      name: 'Pier 12 Reinforcement',
      description: null,
      wbsCode: '1.3',
      location: 'North Sector',
      plannedStart: '2026-08-10',
      plannedFinish: '2026-08-25',
      plannedQuantity: 30,
      unit: 'tons',
      baselineProgress: 0,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z'
    },
    {
      id: 'act-b02',
      projectId: project1Id,
      scheduleId: 'sched-1',
      externalId: 'ACT-B02',
      name: 'Crude Pump Foundation Piling Works',
      description: null,
      wbsCode: 'WBS-02.02',
      location: 'Area B',
      plannedStart: '2026-08-10',
      plannedFinish: '2026-08-24',
      plannedQuantity: 180,
      unit: 'piles',
      baselineProgress: 0,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z'
    },
    {
      id: 'act-b05',
      projectId: project1Id,
      scheduleId: 'sched-1',
      externalId: 'ACT-B05',
      name: 'Foundation Piling Inspection Sign-Off',
      description: null,
      wbsCode: 'WBS-02.05',
      location: 'Area B',
      plannedStart: '2026-09-02',
      plannedFinish: '2026-09-02',
      plannedQuantity: 1,
      unit: 'ea',
      baselineProgress: 0,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z'
    },
    {
      id: 'act-c01',
      projectId: project1Id,
      scheduleId: 'sched-1',
      externalId: 'ACT-C01',
      name: 'Pipe Rack PR-07 Structural Steel Erection',
      description: null,
      wbsCode: 'WBS-03.01',
      location: 'Area C',
      plannedStart: '2026-08-10',
      plannedFinish: '2026-08-29',
      plannedQuantity: 320,
      unit: 'ton',
      baselineProgress: 0,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z'
    },
    {
      id: 'act-c02',
      projectId: project1Id,
      scheduleId: 'sched-1',
      externalId: 'ACT-C02',
      name: 'Pipe Rack PR-08 Structural Steel Erection',
      description: null,
      wbsCode: 'WBS-03.02',
      location: 'Area C',
      plannedStart: '2026-08-12',
      plannedFinish: '2026-08-30',
      plannedQuantity: 280,
      unit: 'ton',
      baselineProgress: 0,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z'
    }
  ];

  const mockProject2Activities: Activity[] = [
    {
      id: 'act-p2-1',
      projectId: project2Id,
      scheduleId: 'sched-2',
      externalId: 'ACT-001',
      name: 'Project 2 Bridge Foundation',
      description: null,
      wbsCode: '1.1',
      location: 'Zone 5',
      plannedStart: '2026-08-01',
      plannedFinish: '2026-08-15',
      plannedQuantity: 200,
      unit: 'm3',
      baselineProgress: 0,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z'
    }
  ];

  const fakeRepo: ActivityRepository = {
    create: vi.fn(),
    createMany: vi.fn(),
    getById: vi.fn(),
    getByIdAndProjectId: vi.fn(),
    listByScheduleId: vi.fn(),
    listByProjectId: vi.fn().mockImplementation((pId: string) => {
      if (pId === project1Id) return mockProject1Activities;
      if (pId === project2Id) return mockProject2Activities;
      return [];
    }),
    countByScheduleId: vi.fn(),
    countByProjectId: vi.fn()
  };

  const resolver = new DeterministicActivityResolver(fakeRepo);

  describe('Existing Precedence Baseline', () => {
    it('should resolve exact externalId match (Precedence 1)', () => {
      const res = resolver.resolve(project1Id, 'ACT-001');
      expect(res.status).toBe('resolved');
      expect(res.activity?.id).toBe('act-1');
      expect(res.activity?.externalId).toBe('ACT-001');
    });

    it('should resolve exact case-insensitive normalized activity name (Precedence 2)', () => {
      const res = resolver.resolve(project1Id, 'foundation b - concrete pouring');
      expect(res.status).toBe('resolved');
      expect(res.activity?.id).toBe('act-1');
      expect(res.activity?.name).toBe('Foundation B - Concrete Pouring');
    });

    it('should resolve exact name + location match (Precedence 3)', () => {
      const res = resolver.resolve(project1Id, 'Foundation B - Concrete Pouring Block B');
      expect(res.status).toBe('resolved');
      expect(res.activity?.id).toBe('act-1');
    });

    it('should resolve unique deterministic textual match (Precedence 4)', () => {
      const res = resolver.resolve(project1Id, 'Foundation B');
      expect(res.status).toBe('resolved');
      expect(res.activity?.id).toBe('act-1');
    });

    it('should return not_found if no activity matches the query in the project', () => {
      const res = resolver.resolve(project1Id, 'Nonexistent Highway Tunnel');
      expect(res.status).toBe('not_found');
      expect(res.activity).toBeNull();
      expect(res.candidates).toEqual([]);
    });

    it('should return ambiguous if multiple activities match without single candidate', () => {
      // Both 'Pier 12 Excavation' and 'Pier 12 Reinforcement' match 'Pier 12'
      const res = resolver.resolve(project1Id, 'Pier 12');
      expect(res.status).toBe('ambiguous');
      expect(res.activity).toBeNull();
      expect(res.candidates.length).toBe(2);
      expect(res.candidates.map((c) => c.id)).toContain('act-2');
      expect(res.candidates.map((c) => c.id)).toContain('act-3');
    });

    it('should enforce strict project isolation (cannot resolve activities from Project B)', () => {
      const res = resolver.resolve(project1Id, 'Project 2 Bridge Foundation');
      expect(res.status).toBe('not_found');
    });
  });

  describe('Morphology Lexical Normalization Unit Tests', () => {
    it('canonicalizes piling and pile variants to pile', () => {
      expect(stemConstructionToken('piles')).toBe('pile');
      expect(stemConstructionToken('pile')).toBe('pile');
      expect(stemConstructionToken('piling')).toBe('pile');
      expect(stemConstructionToken('pilings')).toBe('pile');
      expect(normalizeConstructionWord('piles')).toBe('pile');
    });

    it('canonicalizes install/erect/weld/excavate/foundation/construct/complete variants', () => {
      expect(stemConstructionToken('install')).toBe('install');
      expect(stemConstructionToken('installed')).toBe('install');
      expect(stemConstructionToken('installation')).toBe('install');

      expect(stemConstructionToken('erect')).toBe('erect');
      expect(stemConstructionToken('erected')).toBe('erect');
      expect(stemConstructionToken('erection')).toBe('erect');

      expect(stemConstructionToken('weld')).toBe('weld');
      expect(stemConstructionToken('welds')).toBe('weld');
      expect(stemConstructionToken('welding')).toBe('weld');

      expect(stemConstructionToken('excavate')).toBe('excavate');
      expect(stemConstructionToken('excavation')).toBe('excavate');

      expect(stemConstructionToken('foundation')).toBe('foundation');
      expect(stemConstructionToken('foundations')).toBe('foundation');

      expect(stemConstructionToken('construct')).toBe('construct');
      expect(stemConstructionToken('construction')).toBe('construct');

      expect(stemConstructionToken('complete')).toBe('complete');
      expect(stemConstructionToken('completed')).toBe('complete');
      expect(stemConstructionToken('completion')).toBe('complete');
    });

    it('does NOT over-stem technical identifiers', () => {
      expect(stemConstructionToken('ACT-B02')).toBe('act-b02');
      expect(stemConstructionToken('PR-07')).toBe('pr-07');
      expect(stemConstructionToken('WBS-02.02')).toBe('wbs-02.02');
      expect(stemConstructionToken('1.1')).toBe('1.1');
    });
  });

  describe('Mandatory Activity Resolver Test Cases (Section 11)', () => {
    // A. Query: "Pump foundation piles" -> Expected: ACT-B02
    it('A. resolves "Pump foundation piles" to ACT-B02', () => {
      const res = resolver.resolve(project1Id, 'Pump foundation piles');
      expect(res.status).toBe('resolved');
      expect(res.activity?.externalId).toBe('ACT-B02');
      expect(res.activity?.name).toBe('Crude Pump Foundation Piling Works');
      expect(res.activity?.location).toBe('Area B');
    });

    // B. Full Golden Demo text: "Pump foundation piles completed to 65% at Area B crude pump bay." -> Expected: ACT-B02
    it('B. resolves full Golden Demo query "Pump foundation piles completed to 65% at Area B crude pump bay." to ACT-B02', () => {
      const res = resolver.resolve(
        project1Id,
        'Pump foundation piles completed to 65% at Area B crude pump bay.'
      );
      expect(res.status).toBe('resolved');
      expect(res.activity?.externalId).toBe('ACT-B02');
      expect(res.activity?.name).toBe('Crude Pump Foundation Piling Works');
    });

    // C. Query: "Crude pump piling" -> Expected: ACT-B02
    it('C. resolves "Crude pump piling" to ACT-B02', () => {
      const res = resolver.resolve(project1Id, 'Crude pump piling');
      expect(res.status).toBe('resolved');
      expect(res.activity?.externalId).toBe('ACT-B02');
    });

    // D. Query: "Foundation piling Area B" -> Expected: ACT-B02
    it('D. resolves "Foundation piling Area B" to ACT-B02 (preferring physical work over sign-off milestone)', () => {
      const res = resolver.resolve(project1Id, 'Foundation piling Area B');
      expect(res.status).toBe('resolved');
      expect(res.activity?.externalId).toBe('ACT-B02');
    });

    // E. Exact: "Crude Pump Foundation Piling Works" -> Expected: ACT-B02
    it('E. resolves exact name "Crude Pump Foundation Piling Works" to ACT-B02', () => {
      const res = resolver.resolve(project1Id, 'Crude Pump Foundation Piling Works');
      expect(res.status).toBe('resolved');
      expect(res.activity?.externalId).toBe('ACT-B02');
    });

    // F. Exact identifier: "ACT-B02" -> Expected: ACT-B02
    it('F. resolves exact identifier "ACT-B02" to ACT-B02', () => {
      const res = resolver.resolve(project1Id, 'ACT-B02');
      expect(res.status).toBe('resolved');
      expect(res.activity?.externalId).toBe('ACT-B02');
    });

    // G. Pipe Rack exact identifier: "PR-07" -> Expected: ACT-C01
    it('G. resolves "PR-07" to ACT-C01', () => {
      const res = resolver.resolve(project1Id, 'PR-07');
      expect(res.status).toBe('resolved');
      expect(res.activity?.externalId).toBe('ACT-C01');
      expect(res.activity?.name).toBe('Pipe Rack PR-07 Structural Steel Erection');
    });

    // H. Ambiguous query: "Pipe Rack structural steel erection" -> Expected: ambiguous (PR-07 / PR-08)
    it('H. returns ambiguous for "Pipe Rack structural steel erection" when siblings PR-07 and PR-08 are present', () => {
      const res = resolver.resolve(project1Id, 'Pipe Rack structural steel erection');
      expect(res.status).toBe('ambiguous');
      expect(res.activity).toBeNull();
      expect(res.candidates.length).toBe(2);
      const extIds = res.candidates.map((c) => c.externalId);
      expect(extIds).toContain('ACT-C01');
      expect(extIds).toContain('ACT-C02');
    });

    // I. Project isolation: Project A query MUST NOT resolve an activity belonging only to Project B
    it('I. enforces project isolation: cannot resolve Project 2 activity from Project 1 context', () => {
      const res = resolver.resolve(project1Id, 'Project 2 Bridge Foundation');
      expect(res.status).toBe('not_found');
      expect(res.activity).toBeNull();
    });

    // J. Negative case: genuinely unrelated query must return not_found
    it('J. returns not_found for genuinely unrelated query', () => {
      const res = resolver.resolve(project1Id, 'Turbine Substation Cable Splicing');
      expect(res.status).toBe('not_found');
      expect(res.activity).toBeNull();
      expect(res.candidates).toEqual([]);
    });
  });
});
