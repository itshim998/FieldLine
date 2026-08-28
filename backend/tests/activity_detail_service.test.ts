import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DefaultActivityDetailService } from '../src/services/activity-detail/activity-detail.service.js';
import { ProjectRepository } from '../src/repositories/project.repository.js';
import { ActivityRepository } from '../src/repositories/activity.repository.js';
import { ActivityProgressRepository } from '../src/repositories/activity-progress.repository.js';
import { ProgressUpdateRepository } from '../src/repositories/progress-update.repository.js';
import { ActivityMatchRepository } from '../src/repositories/activity-match.repository.js';
import { EvidenceRepository } from '../src/repositories/evidence.repository.js';
import { ProgressSnapshotService } from '../src/services/snapshot/progress-snapshot.types.js';
import { RiskClassificationService } from '../src/services/risk/risk-classification.types.js';
import { NotFoundError, ValidationError } from '../src/errors/AppError.js';
import {
  Project,
  Activity,
  ActivityProgress,
  ProgressUpdate,
  ActivityMatch,
  Evidence
} from '../src/models/domain.types.js';

describe('ActivityDetailService (Pass 21 Composition Layer)', () => {
  const projectId = 'proj-foundation-101';
  const otherProjectId = 'proj-other-202';
  const activityId = 'act-foundation-block-b';
  const otherActivityId = 'act-other-cross-project';

  const mockProject: Project = {
    id: projectId,
    name: 'Foundation Development Project',
    code: 'FDP-01',
    description: 'Structural foundation works',
    status: 'active',
    startDate: '2026-08-01',
    targetEndDate: '2026-12-31',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z'
  };

  const mockActivity: Activity = {
    id: activityId,
    projectId,
    scheduleId: 'sch-001',
    externalId: 'ACT-1042',
    name: 'Foundation — Block B',
    description: 'Concrete pouring and curing for Block B sub-structure',
    wbsCode: '03.02',
    location: 'East Wing',
    plannedStart: '2026-08-20',
    plannedFinish: '2026-08-30',
    plannedQuantity: 500,
    unit: 'm3',
    baselineProgress: 0,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z'
  };

  const mockSnapshotItem = {
    activityId,
    externalId: 'ACT-1042',
    name: 'Foundation — Block B',
    wbsCode: '03.02',
    location: 'East Wing',
    plannedStart: '2026-08-20',
    plannedFinish: '2026-08-30',
    plannedDurationDays: 10,
    actualStart: '2026-08-22',
    actualFinish: null,
    plannedProgress: 75,
    actualProgress: 60,
    progressVariance: -15,
    varianceState: 'behind' as const,
    status: 'in_progress' as const,
    overdue: false
  };

  const mockRiskItem = {
    activityId,
    externalId: 'ACT-1042',
    name: 'Foundation — Block B',
    classification: 'AT_RISK' as const,
    reasons: [
      {
        code: 'strong_negative_variance' as const,
        message: 'Strong negative variance (-15.00% <= -10%)'
      }
    ]
  };

  const mockObservations: ActivityProgress[] = [
    {
      id: 'prog-01',
      projectId,
      activityId,
      progressUpdateId: 'upd-01',
      actualPercent: 0,
      actualQuantity: 0,
      actualStart: '2026-08-22',
      actualFinish: null,
      status: 'started',
      asOfDate: '2026-08-22',
      notes: 'Excavation complete and rebar placed',
      createdAt: '2026-08-22T08:00:00.000Z',
      updatedAt: '2026-08-22T08:00:00.000Z'
    },
    {
      id: 'prog-02',
      projectId,
      activityId,
      progressUpdateId: 'upd-02',
      actualPercent: 35,
      actualQuantity: 175,
      actualStart: '2026-08-22',
      actualFinish: null,
      status: 'in_progress',
      asOfDate: '2026-08-23',
      notes: 'Initial concrete pour completed',
      createdAt: '2026-08-23T14:30:00.000Z',
      updatedAt: '2026-08-23T14:30:00.000Z'
    },
    {
      id: 'prog-03',
      projectId,
      activityId,
      progressUpdateId: 'upd-03',
      actualPercent: 60,
      actualQuantity: 300,
      actualStart: '2026-08-22',
      actualFinish: null,
      status: 'in_progress',
      asOfDate: '2026-08-24',
      notes: 'Second pour done',
      createdAt: '2026-08-24T17:00:00.000Z',
      updatedAt: '2026-08-24T17:00:00.000Z'
    }
  ];

  const mockUpdates: ProgressUpdate[] = [
    {
      id: 'upd-01',
      projectId,
      reportDate: '2026-08-22',
      reporterName: 'John Site Engineer',
      reporterRole: 'Site Engineer',
      sourceType: 'manual',
      rawText: 'Started foundation block B rebar work',
      status: 'processed',
      createdAt: '2026-08-22T08:00:00.000Z',
      updatedAt: '2026-08-22T08:00:00.000Z'
    },
    {
      id: 'upd-02',
      projectId,
      reportDate: '2026-08-23',
      reporterName: 'Sarah Q/A Lead',
      reporterRole: 'QA Manager',
      sourceType: 'xlsx',
      rawText: 'Daily report with 35% pour verified',
      status: 'processed',
      createdAt: '2026-08-23T14:30:00.000Z',
      updatedAt: '2026-08-23T14:30:00.000Z'
    },
    {
      id: 'upd-03',
      projectId,
      reportDate: '2026-08-24',
      reporterName: 'Dave Foreman',
      reporterRole: 'General Foreman',
      sourceType: 'pdf',
      rawText: 'Field inspection PDF confirming 60% completion',
      status: 'reviewed',
      createdAt: '2026-08-24T17:00:00.000Z',
      updatedAt: '2026-08-24T17:00:00.000Z'
    }
  ];

  const mockMatches: ActivityMatch[] = [
    {
      id: 'match-01',
      projectId,
      progressUpdateId: 'upd-03',
      evidenceId: 'ev-02',
      activityId,
      confidenceScore: 0.98,
      matchMethod: 'exact_id',
      matchedText: 'ACT-1042 Foundation Block B',
      rationale: 'Exact external ID match',
      status: 'confirmed',
      confidenceTier: 'high',
      reviewState: 'resolved',
      reviewedBy: 'Dave Foreman',
      reviewedAt: '2026-08-24T17:05:00.000Z',
      createdAt: '2026-08-24T17:00:00.000Z',
      updatedAt: '2026-08-24T17:05:00.000Z'
    },
    {
      id: 'match-02',
      projectId,
      progressUpdateId: 'upd-02',
      evidenceId: 'ev-01',
      activityId,
      confidenceScore: 0.85,
      matchMethod: 'text_similarity',
      matchedText: 'Foundation B pour',
      rationale: 'High text similarity',
      status: 'confirmed',
      confidenceTier: 'medium',
      reviewState: 'resolved',
      reviewedBy: 'system',
      reviewedAt: '2026-08-23T14:31:00.000Z',
      createdAt: '2026-08-23T14:30:00.000Z',
      updatedAt: '2026-08-23T14:31:00.000Z'
    },
    {
      id: 'match-03',
      projectId,
      progressUpdateId: 'upd-01',
      evidenceId: null,
      activityId,
      confidenceScore: 0.45,
      matchMethod: 'llm_assisted',
      matchedText: 'Rebar setup east wing',
      rationale: 'Location overlap candidate',
      status: 'suggested',
      confidenceTier: 'low',
      reviewState: 'awaiting_review',
      reviewedBy: null,
      reviewedAt: null,
      createdAt: '2026-08-22T08:00:00.000Z',
      updatedAt: '2026-08-22T08:00:00.000Z'
    }
  ];

  const mockEvidence: Evidence[] = [
    {
      id: 'ev-02',
      projectId,
      progressUpdateId: 'upd-03',
      fileName: 'Report-004.pdf',
      filePath: 'C:\\storage\\secret\\Report-004.pdf',
      fileType: 'pdf',
      fileSizeBytes: 204800,
      mimeType: 'application/pdf',
      metadataJson: null,
      contentSha256: 'sha256-004',
      uploadedAt: '2026-08-24T17:00:00.000Z',
      createdAt: '2026-08-24T17:00:00.000Z'
    },
    {
      id: 'ev-01',
      projectId,
      progressUpdateId: 'upd-02',
      fileName: 'Report-003.xlsx',
      filePath: 'C:\\storage\\secret\\Report-003.xlsx',
      fileType: 'xlsx',
      fileSizeBytes: 102400,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      metadataJson: null,
      contentSha256: 'sha256-003',
      uploadedAt: '2026-08-23T14:30:00.000Z',
      createdAt: '2026-08-23T14:30:00.000Z'
    }
  ];

  let mockProjectRepo: ProjectRepository;
  let mockActivityRepo: ActivityRepository;
  let mockActivityProgressRepo: ActivityProgressRepository;
  let mockProgressUpdateRepo: ProgressUpdateRepository;
  let mockActivityMatchRepo: ActivityMatchRepository;
  let mockEvidenceRepo: EvidenceRepository;
  let mockSnapshotService: ProgressSnapshotService;
  let mockRiskService: RiskClassificationService;
  let service: DefaultActivityDetailService;

  beforeEach(() => {
    mockProjectRepo = {
      create: vi.fn(),
      getById: vi.fn((id: string) => (id === projectId ? mockProject : null)),
      getByCode: vi.fn(),
      list: vi.fn(),
      update: vi.fn(),
      delete: vi.fn()
    };

    mockActivityRepo = {
      create: vi.fn(),
      createMany: vi.fn(),
      getById: vi.fn((id: string) => (id === activityId ? mockActivity : null)),
      getByIdAndProjectId: vi.fn((id: string, pId: string) =>
        id === activityId && pId === projectId ? mockActivity : null
      ),
      listByScheduleId: vi.fn(),
      listByProjectId: vi.fn(() => [mockActivity]),
      countByScheduleId: vi.fn(),
      countByProjectId: vi.fn()
    };

    mockActivityProgressRepo = {
      create: vi.fn(),
      createWithEvent: vi.fn(),
      getById: vi.fn(),
      getByIdAndProjectId: vi.fn(),
      listByActivityId: vi.fn((actId: string, pId?: string) =>
        actId === activityId && (!pId || pId === projectId) ? mockObservations : []
      ),
      listByProgressUpdateId: vi.fn(),
      listByProgressUpdateIds: vi.fn(),
      listByProjectId: vi.fn(),
      getLatestByActivityId: vi.fn(),
      getLatestByActivityIdAsOfDate: vi.fn(),
      findExistingObservation: vi.fn(),
      delete: vi.fn()
    };

    mockProgressUpdateRepo = {
      create: vi.fn(),
      commitDocumentIngestionTransaction: vi.fn(),
      getById: vi.fn(),
      getByIdAndProjectId: vi.fn((id: string, pId: string) =>
        mockUpdates.find((u) => u.id === id && u.projectId === pId) || null
      ),
      listByIds: vi.fn((ids: string[], pId: string) =>
        mockUpdates.filter((u) => ids.includes(u.id) && u.projectId === pId)
      ),
      listByProjectId: vi.fn(),
      countByProjectId: vi.fn(),
      delete: vi.fn(),
      deleteByIdAndProjectId: vi.fn()
    };

    mockActivityMatchRepo = {
      create: vi.fn(),
      createMany: vi.fn(),
      getById: vi.fn(),
      getByIdAndProjectId: vi.fn(),
      listByProgressUpdateId: vi.fn(),
      listByProgressUpdateIds: vi.fn(),
      listByActivityId: vi.fn((actId: string, pId: string) =>
        actId === activityId && pId === projectId ? mockMatches : []
      ),
      listByProjectId: vi.fn(),
      updateMatchReview: vi.fn(),
      confirmMatchAtomically: vi.fn(),
      rejectMatchAtomically: vi.fn(),
      resolveMatchAtomically: vi.fn(),
      persistMatchesAndEventsAtomically: vi.fn(),
      delete: vi.fn(),
      deleteByProgressUpdateId: vi.fn(),
      deleteSuggestedByProgressUpdateId: vi.fn()
    };

    mockEvidenceRepo = {
      create: vi.fn(),
      createWithEvent: vi.fn(),
      getById: vi.fn(),
      getByIdAndProjectId: vi.fn(),
      findByProjectIdAndHash: vi.fn(),
      updateContentSha256: vi.fn(),
      listUnreconciledLegacyEvidence: vi.fn(),
      listByProjectId: vi.fn(),
      listByProgressUpdateId: vi.fn(),
      listByProgressUpdateIds: vi.fn(),
      listByActivityId: vi.fn((actId: string, pId: string) =>
        actId === activityId && pId === projectId ? mockEvidence : []
      ),
      countByProjectId: vi.fn(),
      attachToProgressUpdate: vi.fn(),
      delete: vi.fn(),
      deleteByIdAndProjectId: vi.fn()
    };

    mockSnapshotService = {
      getProgressSnapshot: vi.fn((_pId: string, asOfDate?: string) => ({
        projectId,
        asOfDate: asOfDate || '2026-08-24',
        generatedAt: '2026-08-24T18:00:00.000Z',
        activities: [mockSnapshotItem],
        summary: {
          totalActivities: 1,
          notStarted: 0,
          started: 0,
          inProgress: 1,
          completed: 0,
          delayed: 0,
          overdue: 0,
          ahead: 0,
          onPlan: 0,
          behind: 1,
          overallActualProgress: 60,
          overallPlannedProgress: 75,
          progressVariance: -15,
          varianceState: 'behind'
        },
        overallActualProgress: 60,
        overallPlannedProgress: 75,
        progressVariance: -15,
        varianceState: 'behind'
      }))
    };

    mockRiskService = {
      getProjectRiskStatus: vi.fn((_pId: string, asOfDate?: string) => ({
        projectId,
        asOfDate: asOfDate || '2026-08-24',
        generatedAt: '2026-08-24T18:00:00.000Z',
        activities: [mockRiskItem],
        summary: {
          totalActivities: 1,
          completed: 0,
          delayed: 0,
          atRisk: 1,
          ahead: 0,
          onTrack: 0,
          overdueCount: 0
        }
      }))
    };

    service = new DefaultActivityDetailService({
      projectRepo: mockProjectRepo,
      activityRepo: mockActivityRepo,
      activityProgressRepo: mockActivityProgressRepo,
      progressUpdateRepo: mockProgressUpdateRepo,
      activityMatchRepo: mockActivityMatchRepo,
      evidenceRepo: mockEvidenceRepo,
      progressSnapshotService: mockSnapshotService,
      riskClassificationService: mockRiskService
    });
  });

  describe('Activity existence and project isolation', () => {
    it('should throw NotFoundError if project does not exist', () => {
      expect(() =>
        service.getActivityDetail('invalid-project-id', activityId)
      ).toThrow(NotFoundError);
    });

    it('should throw NotFoundError if activity does not exist', () => {
      expect(() =>
        service.getActivityDetail(projectId, 'non-existent-activity')
      ).toThrow(NotFoundError);
    });

    it('should reject cross-project activity access with NotFoundError', () => {
      expect(() =>
        service.getActivityDetail(otherProjectId, activityId)
      ).toThrow(NotFoundError);
    });
  });

  describe('Canonical Current State Composition', () => {
    it('should compose current state matching canonical snapshot and risk services', () => {
      const detail = service.getActivityDetail(projectId, activityId, { asOfDate: '2026-08-24' });

      expect(detail.activity).toEqual({
        activityId: mockActivity.id,
        externalId: mockActivity.externalId,
        name: mockActivity.name,
        description: mockActivity.description,
        wbsCode: mockActivity.wbsCode,
        location: mockActivity.location,
        scheduleId: mockActivity.scheduleId,
        plannedStart: mockActivity.plannedStart,
        plannedFinish: mockActivity.plannedFinish,
        plannedQuantity: mockActivity.plannedQuantity,
        unit: mockActivity.unit,
        baselineProgress: mockActivity.baselineProgress
      });

      expect(detail.current).toEqual({
        plannedProgress: 75,
        actualProgress: 60,
        progressVariance: -15,
        varianceState: 'behind',
        status: 'in_progress',
        overdue: false,
        riskClassification: 'AT_RISK',
        riskReasons: [
          {
            code: 'strong_negative_variance',
            message: 'Strong negative variance (-15.00% <= -10%)'
          }
        ],
        actualStart: '2026-08-22',
        actualFinish: null,
        asOfDate: '2026-08-24'
      });
    });

    it('should validate asOfDate and reject invalid date formats with ValidationError', () => {
      expect(() =>
        service.getActivityDetail(projectId, activityId, { asOfDate: 'invalid-date' })
      ).toThrow(ValidationError);

      expect(() =>
        service.getActivityDetail(projectId, activityId, { asOfDate: '2026-13-01' })
      ).toThrow(ValidationError);
    });
  });

  describe('Deterministic Chronological Timeline & Historical Boundary', () => {
    it('should return complete progress timeline sorted deterministically', () => {
      const detail = service.getActivityDetail(projectId, activityId, { asOfDate: '2026-08-24' });

      expect(detail.timeline).toHaveLength(3);
      expect(detail.timeline[0]).toMatchObject({
        progressId: 'prog-01',
        date: '2026-08-22',
        actualPercent: 0,
        status: 'started',
        source: 'manual'
      });
      expect(detail.timeline[1]).toMatchObject({
        progressId: 'prog-02',
        date: '2026-08-23',
        actualPercent: 35,
        status: 'in_progress',
        source: 'xlsx'
      });
      expect(detail.timeline[2]).toMatchObject({
        progressId: 'prog-03',
        date: '2026-08-24',
        actualPercent: 60,
        status: 'in_progress',
        source: 'pdf'
      });
    });

    it('should strictly exclude future observations when querying with historical asOfDate', () => {
      const detail = service.getActivityDetail(projectId, activityId, { asOfDate: '2026-08-23' });

      // Aug 24 observation must NOT appear in Aug 23 view
      expect(detail.timeline).toHaveLength(2);
      expect(detail.timeline.map((t) => t.date)).toEqual(['2026-08-22', '2026-08-23']);
      expect(detail.timeline.some((t) => t.progressId === 'prog-03')).toBe(false);
    });
  });

  describe('Progress Update Provenance and Batch Lookup', () => {
    it('should batch lookup progress updates without issuing N+1 queries', () => {
      const detail = service.getActivityDetail(projectId, activityId, { asOfDate: '2026-08-24' });

      expect(mockProgressUpdateRepo.listByIds).toHaveBeenCalledTimes(1);
      expect(mockProgressUpdateRepo.listByIds).toHaveBeenCalledWith(
        expect.arrayContaining(['upd-01', 'upd-02', 'upd-03']),
        projectId
      );

      expect(detail.progressUpdates).toHaveLength(3);
      expect(detail.progressUpdates[0]).toMatchObject({
        progressUpdateId: 'upd-01',
        reporterName: 'John Site Engineer',
        sourceType: 'manual'
      });
    });
  });

  describe('Activity Match Review Context and Canonical Protection', () => {
    it('should return matches and mark confirmed ones as canonicalProgressEligible', () => {
      const detail = service.getActivityDetail(projectId, activityId, { asOfDate: '2026-08-24' });

      expect(detail.matches).toHaveLength(3);

      const confirmedMatch = detail.matches.find((m) => m.matchId === 'match-01');
      expect(confirmedMatch).toBeDefined();
      expect(confirmedMatch?.status).toBe('confirmed');
      expect(confirmedMatch?.canonicalProgressEligible).toBe(true);

      const suggestedMatch = detail.matches.find((m) => m.matchId === 'match-03');
      expect(suggestedMatch).toBeDefined();
      expect(suggestedMatch?.status).toBe('suggested');
      expect(suggestedMatch?.canonicalProgressEligible).toBe(false);
    });
  });

  describe('Evidence Provenance & Security', () => {
    it('should return deduplicated evidence and NEVER expose raw filesystem paths', () => {
      const detail = service.getActivityDetail(projectId, activityId, { asOfDate: '2026-08-24' });

      expect(detail.evidence).toHaveLength(2);
      expect(detail.evidence[0]).toEqual({
        evidenceId: 'ev-02',
        fileName: 'Report-004.pdf',
        fileType: 'pdf',
        fileSizeBytes: 204800,
        uploadedAt: '2026-08-24T17:00:00.000Z',
        progressUpdateId: 'upd-03'
      });
      expect(detail.evidence[1]).toEqual({
        evidenceId: 'ev-01',
        fileName: 'Report-003.xlsx',
        fileType: 'xlsx',
        fileSizeBytes: 102400,
        uploadedAt: '2026-08-23T14:30:00.000Z',
        progressUpdateId: 'upd-02'
      });

      // Assert that filePath property does NOT exist on any evidence item
      for (const ev of detail.evidence) {
        expect((ev as any).filePath).toBeUndefined();
      }
    });
  });
});
