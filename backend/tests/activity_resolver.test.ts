import { describe, it, expect, vi } from 'vitest';
import { DeterministicActivityResolver } from '../src/services/assistant/activity-resolver.js';
import { ActivityRepository } from '../src/repositories/activity.repository.js';
import { Activity } from '../src/models/domain.types.js';

describe('DeterministicActivityResolver (Pass 18)', () => {
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
