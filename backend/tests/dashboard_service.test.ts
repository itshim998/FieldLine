import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DefaultProjectDashboardService } from '../src/services/dashboard/project-dashboard.service.js';
import { ProjectRepository } from '../src/repositories/project.repository.js';
import { ActivityRepository } from '../src/repositories/activity.repository.js';
import { ProgressUpdateRepository } from '../src/repositories/progress-update.repository.js';
import { ActivityMatchRepository } from '../src/repositories/activity-match.repository.js';
import { ActivityProgressRepository } from '../src/repositories/activity-progress.repository.js';
import { EvidenceRepository } from '../src/repositories/evidence.repository.js';
import { ProgressSnapshotService } from '../src/services/snapshot/progress-snapshot.types.js';
import { RiskClassificationService } from '../src/services/risk/risk-classification.types.js';
import { ProjectIntelligenceService } from '../src/services/intelligence/project-intelligence.types.js';
import { NotFoundError, ValidationError } from '../src/errors/AppError.js';
import { Project, Activity, ProgressUpdate, ActivityMatch, Evidence, ActivityProgress } from '../src/models/domain.types.js';

describe('ProjectDashboardService (Pass 20 Backend Composition)', () => {
  const projectId = 'proj-100';
  const otherProjectId = 'proj-200';

  const mockProject: Project = {
    id: projectId,
    name: 'Metro Line Corridor',
    code: 'MLC-01',
    description: 'Urban rapid transit project',
    status: 'active',
    startDate: '2026-01-01',
    targetEndDate: '2026-12-31',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  };

  const mockActivities: Activity[] = [
    {
      id: 'act-1',
      projectId,
      scheduleId: 'sch-1',
      externalId: 'FOUND-101',
      name: 'Foundation Piling',
      description: null,
      wbsCode: '1.1',
      location: 'Pier 1',
      plannedStart: '2026-08-01',
      plannedFinish: '2026-08-20',
      plannedQuantity: 100,
      unit: 'm3',
      baselineProgress: 0,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z'
    },
    {
      id: 'act-2',
      projectId,
      scheduleId: 'sch-1',
      externalId: 'STRUC-201',
      name: 'Superstructure Deck',
      description: null,
      wbsCode: '1.2',
      location: 'Span 1',
      plannedStart: '2026-08-10',
      plannedFinish: '2026-08-30',
      plannedQuantity: 50,
      unit: 'm',
      baselineProgress: 0,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z'
    },
    {
      id: 'act-ms-1',
      projectId,
      scheduleId: 'sch-1',
      externalId: 'MS-START',
      name: 'Project Groundbreaking Milestone',
      description: null,
      wbsCode: '0.1',
      location: null,
      plannedStart: '2026-08-01',
      plannedFinish: '2026-08-01',
      plannedQuantity: null,
      unit: null,
      baselineProgress: 0,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z'
    },
    {
      id: 'act-ms-2',
      projectId,
      scheduleId: 'sch-1',
      externalId: 'MS-DECK',
      name: 'Deck Handover Milestone',
      description: null,
      wbsCode: '1.3',
      location: null,
      plannedStart: '2026-08-28',
      plannedFinish: '2026-08-28',
      plannedQuantity: null,
      unit: null,
      baselineProgress: 0,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z'
    }
  ];

  let fakeProjectRepo: ProjectRepository;
  let fakeActivityRepo: ActivityRepository;
  let fakeProgressUpdateRepo: ProgressUpdateRepository;
  let fakeActivityMatchRepo: ActivityMatchRepository;
  let fakeActivityProgressRepo: ActivityProgressRepository;
  let fakeEvidenceRepo: EvidenceRepository;
  let fakeSnapshotService: ProgressSnapshotService;
  let fakeRiskService: RiskClassificationService;
  let fakeIntelligenceService: ProjectIntelligenceService;
  let service: DefaultProjectDashboardService;

  beforeEach(() => {
    fakeProjectRepo = {
      getById: vi.fn().mockImplementation((id: string) => (id === projectId ? mockProject : null)),
      create: vi.fn(),
      getByCode: vi.fn(),
      listAll: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn()
    };

    fakeActivityRepo = {
      listByProjectId: vi.fn().mockImplementation((pId: string) => (pId === projectId ? mockActivities : [])),
      getById: vi.fn().mockImplementation((id: string) => mockActivities.find((a) => a.id === id) || null),
      create: vi.fn(),
      createMany: vi.fn(),
      getByIdAndProjectId: vi.fn(),
      getByExternalId: vi.fn(),
      listByScheduleId: vi.fn(),
      delete: vi.fn(),
      deleteByScheduleId: vi.fn(),
      countByProjectId: vi.fn()
    };

    fakeProgressUpdateRepo = {
      listByProjectId: vi.fn().mockImplementation((pId: string) => {
        if (pId !== projectId) return [];
        return [
          {
            id: 'upd-1',
            projectId,
            reportDate: '2026-08-28',
            reporterName: 'Suresh Site Eng',
            reporterRole: 'Site Engineer',
            sourceType: 'manual',
            rawText: 'Foundation piling finished 100%, deck progress 40%',
            status: 'received',
            createdAt: '2026-08-28T09:00:00.000Z',
            updatedAt: '2026-08-28T09:00:00.000Z'
          },
          {
            id: 'upd-2',
            projectId,
            reportDate: '2026-08-27',
            reporterName: 'PDF Ingest Job',
            reporterRole: null,
            sourceType: 'pdf',
            rawText: 'Daily structural log extract',
            status: 'processed',
            createdAt: '2026-08-27T18:00:00.000Z',
            updatedAt: '2026-08-27T18:00:00.000Z'
          }
        ] as ProgressUpdate[];
      }),
      create: vi.fn(),
      commitDocumentIngestionTransaction: vi.fn(),
      getById: vi.fn(),
      getByIdAndProjectId: vi.fn(),
      countByProjectId: vi.fn(),
      delete: vi.fn(),
      deleteByIdAndProjectId: vi.fn()
    };

    fakeActivityMatchRepo = {
      listByProjectId: vi.fn().mockImplementation((pId: string) => {
        if (pId !== projectId) return [];
        return [
          {
            id: 'match-1',
            projectId,
            progressUpdateId: 'upd-1',
            evidenceId: null,
            activityId: 'act-1',
            confidenceScore: 0.95,
            matchMethod: 'exact_id',
            matchedText: 'FOUND-101',
            rationale: 'Direct identifier match',
            status: 'confirmed',
            confidenceTier: 'high',
            reviewState: 'resolved',
            reviewedBy: 'system',
            reviewedAt: '2026-08-28T09:00:00.000Z',
            createdAt: '2026-08-28T09:00:00.000Z',
            updatedAt: '2026-08-28T09:00:00.000Z'
          },
          {
            id: 'match-2',
            projectId,
            progressUpdateId: 'upd-1',
            evidenceId: null,
            activityId: 'act-2',
            confidenceScore: 0.65,
            matchMethod: 'text_similarity',
            matchedText: 'deck progress',
            rationale: 'Partial semantic match',
            status: 'suggested',
            confidenceTier: 'medium',
            reviewState: 'unresolved',
            reviewedBy: null,
            reviewedAt: null,
            createdAt: '2026-08-28T09:00:00.000Z',
            updatedAt: '2026-08-28T09:00:00.000Z'
          }
        ] as ActivityMatch[];
      }),
      listByProgressUpdateId: vi.fn().mockReturnValue([]),
      listByProgressUpdateIds: vi.fn().mockImplementation((updIds: string[], pId: string) => {
        if (pId !== projectId) return [];
        const matches: ActivityMatch[] = [];
        if (updIds.includes('upd-1')) {
          matches.push(
            {
              id: 'match-1',
              projectId,
              progressUpdateId: 'upd-1',
              evidenceId: null,
              activityId: 'act-1',
              confidenceScore: 0.95,
              matchMethod: 'exact_id',
              matchedText: 'FOUND-101',
              rationale: 'Direct identifier match',
              status: 'confirmed',
              confidenceTier: 'high',
              reviewState: 'resolved',
              reviewedBy: 'system',
              reviewedAt: '2026-08-28T09:00:00.000Z',
              createdAt: '2026-08-28T09:00:00.000Z',
              updatedAt: '2026-08-28T09:00:00.000Z'
            },
            {
              id: 'match-2',
              projectId,
              progressUpdateId: 'upd-1',
              evidenceId: null,
              activityId: 'act-2',
              confidenceScore: 0.65,
              matchMethod: 'text_similarity',
              matchedText: 'deck progress',
              rationale: 'Partial semantic match',
              status: 'suggested',
              confidenceTier: 'medium',
              reviewState: 'unresolved',
              reviewedBy: null,
              reviewedAt: null,
              createdAt: '2026-08-28T09:00:00.000Z',
              updatedAt: '2026-08-28T09:00:00.000Z'
            }
          );
        }
        return matches;
      }),
      create: vi.fn(),
      createMany: vi.fn(),
      getById: vi.fn(),
      getByIdAndProjectId: vi.fn(),
      updateMatchReview: vi.fn(),
      confirmMatchAtomically: vi.fn(),
      rejectMatchAtomically: vi.fn(),
      resolveMatchAtomically: vi.fn(),
      persistMatchesAndEventsAtomically: vi.fn(),
      delete: vi.fn(),
      deleteByProgressUpdateId: vi.fn(),
      deleteSuggestedByProgressUpdateId: vi.fn()
    };

    fakeActivityProgressRepo = {
      listByProgressUpdateId: vi.fn().mockReturnValue([]),
      listByProgressUpdateIds: vi.fn().mockImplementation((updIds: string[], pId: string) => {
        if (pId !== projectId) return [];
        if (updIds.includes('upd-1')) {
          return [
            {
              id: 'obs-1',
              projectId,
              activityId: 'act-1',
              progressUpdateId: 'upd-1',
              actualPercent: 100,
              actualQuantity: 100,
              actualStart: '2026-08-01',
              actualFinish: '2026-08-20',
              status: 'completed',
              asOfDate: '2026-08-28',
              notes: 'Foundation confirmed',
              createdAt: '2026-08-28T09:00:00.000Z',
              updatedAt: '2026-08-28T09:00:00.000Z'
            }
          ] as ActivityProgress[];
        }
        return [];
      }),
      listByActivityId: vi.fn().mockReturnValue([]),
      getLatestByActivityIdAsOfDate: vi.fn().mockReturnValue(null),
      getLatestByActivityId: vi.fn().mockReturnValue(null),
      create: vi.fn(),
      createWithEvent: vi.fn(),
      findExistingObservation: vi.fn().mockReturnValue(null),
      delete: vi.fn()
    };

    fakeEvidenceRepo = {
      listByProjectId: vi.fn().mockImplementation((pId: string) => (pId === projectId ? [] : [])),
      listByProgressUpdateId: vi.fn().mockReturnValue([]),
      listByProgressUpdateIds: vi.fn().mockImplementation((updIds: string[], pId: string) => {
        if (pId !== projectId) return [];
        if (updIds.includes('upd-2')) {
          return [
            {
              id: 'ev-1',
              projectId,
              progressUpdateId: 'upd-2',
              fileName: 'daily_report_27aug.pdf',
              filePath: '/var/storage/internal/daily_report_27aug.pdf', // sensitive path should not leak to DTO
              fileType: 'pdf',
              fileSizeBytes: 1048576,
              mimeType: 'application/pdf',
              metadataJson: null,
              contentSha256: 'abc123sha',
              uploadedAt: '2026-08-27T18:00:00.000Z',
              createdAt: '2026-08-27T18:00:00.000Z'
            }
          ] as Evidence[];
        }
        return [];
      }),
      create: vi.fn(),
      getById: vi.fn(),
      getByIdAndProjectId: vi.fn(),
      findBySha256AndProject: vi.fn(),
      countByProjectId: vi.fn(),
      delete: vi.fn(),
      deleteByIdAndProjectId: vi.fn(),
      listByActivityId: vi.fn().mockReturnValue([]),
      listUnreconciledLegacyEvidence: vi.fn().mockReturnValue([]),
      updateContentSha256: vi.fn().mockReturnValue(true),
      attachToProgressUpdate: vi.fn().mockReturnValue(true)
    };

    fakeSnapshotService = {
      getProgressSnapshot: vi.fn().mockReturnValue({
        projectId,
        asOfDate: '2026-08-28',
        generatedAt: '2026-08-28T10:00:00.000Z',
        overallActualProgress: 57.5,
        overallPlannedProgress: 97.5,
        progressVariance: -40,
        varianceState: 'behind',
        activities: [
          {
            activityId: 'act-1',
            externalId: 'FOUND-101',
            name: 'Foundation Piling',
            plannedStart: '2026-08-01',
            plannedFinish: '2026-08-20',
            plannedDurationDays: 19,
            actualStart: '2026-08-01',
            actualFinish: '2026-08-20',
            plannedProgress: 100,
            actualProgress: 100,
            progressVariance: 0,
            varianceState: 'on_plan',
            status: 'completed',
            overdue: false
          },
          {
            activityId: 'act-2',
            externalId: 'STRUC-201',
            name: 'Superstructure Deck',
            plannedStart: '2026-08-10',
            plannedFinish: '2026-08-30',
            plannedDurationDays: 20,
            actualStart: '2026-08-10',
            actualFinish: null,
            plannedProgress: 90,
            actualProgress: 30,
            progressVariance: -60,
            varianceState: 'behind',
            status: 'in_progress',
            overdue: false
          },
          {
            activityId: 'act-ms-1',
            externalId: 'MS-START',
            name: 'Project Groundbreaking Milestone',
            plannedStart: '2026-08-01',
            plannedFinish: '2026-08-01',
            plannedDurationDays: 0,
            actualStart: '2026-08-01',
            actualFinish: '2026-08-01',
            plannedProgress: 100,
            actualProgress: 100,
            progressVariance: 0,
            varianceState: 'on_plan',
            status: 'completed',
            overdue: false
          },
          {
            activityId: 'act-ms-2',
            externalId: 'MS-DECK',
            name: 'Deck Handover Milestone',
            plannedStart: '2026-08-28',
            plannedFinish: '2026-08-28',
            plannedDurationDays: 0,
            actualStart: null,
            actualFinish: null,
            plannedProgress: 100,
            actualProgress: 0,
            progressVariance: -100,
            varianceState: 'behind',
            status: 'not_started',
            overdue: false
          }
        ],
        summary: {
          totalActivities: 4,
          notStarted: 1,
          started: 0,
          inProgress: 1,
          completed: 2,
          delayed: 0,
          overdue: 0,
          ahead: 0,
          onPlan: 2,
          behind: 2,
          overallActualProgress: 57.5,
          overallPlannedProgress: 97.5,
          progressVariance: -40,
          varianceState: 'behind'
        }
      })
    };

    fakeRiskService = {
      getProjectRiskStatus: vi.fn().mockReturnValue({
        projectId,
        asOfDate: '2026-08-28',
        generatedAt: '2026-08-28T10:00:00.000Z',
        activities: [
          {
            activityId: 'act-1',
            externalId: 'FOUND-101',
            name: 'Foundation Piling',
            classification: 'COMPLETED',
            reasons: [{ code: 'completed', message: 'Activity execution status is completed.' }]
          },
          {
            activityId: 'act-2',
            externalId: 'STRUC-201',
            name: 'Superstructure Deck',
            classification: 'AT_RISK',
            reasons: [{ code: 'strong_negative_variance', message: 'Actual progress is 60 points behind planned progress.' }]
          },
          {
            activityId: 'act-ms-1',
            externalId: 'MS-START',
            name: 'Project Groundbreaking Milestone',
            classification: 'COMPLETED',
            reasons: [{ code: 'completed', message: 'Milestone reached.' }]
          },
          {
            activityId: 'act-ms-2',
            externalId: 'MS-DECK',
            name: 'Deck Handover Milestone',
            classification: 'AT_RISK',
            reasons: [{ code: 'near_finish_and_behind', message: 'Milestone date reached with 0% progress.' }]
          }
        ],
        summary: {
          totalActivities: 4,
          completed: 2,
          delayed: 0,
          atRisk: 2,
          ahead: 0,
          onTrack: 0,
          overdueCount: 0
        }
      })
    };

    fakeIntelligenceService = {
      getIntelligence: vi.fn().mockReturnValue({
        projectId,
        asOfDate: '2026-08-28',
        generatedAt: '2026-08-28T10:00:00.000Z',
        delayed: [],
        atRisk: [
          {
            activityId: 'act-2',
            externalId: 'STRUC-201',
            name: 'Superstructure Deck',
            classification: 'AT_RISK',
            reasons: [{ code: 'strong_negative_variance', message: 'Behind by 60 points' }],
            plannedFinish: '2026-08-30',
            actualProgress: 30,
            progressVariance: -60
          }
        ],
        completedToday: [],
        behindSchedule: [],
        approachingMilestones: [
          {
            activityId: 'act-ms-2',
            externalId: 'MS-DECK',
            name: 'Deck Handover Milestone',
            milestoneDate: '2026-08-28',
            daysUntil: 0,
            status: 'not_started',
            actualProgress: 0
          }
        ],
        staleActivities: [
          {
            activityId: 'act-2',
            externalId: 'STRUC-201',
            name: 'Superstructure Deck',
            latestUpdateDate: '2026-08-10',
            daysSinceUpdate: 18,
            hasAnyUpdate: true
          }
        ],
        recentChanges: []
      })
    };

    service = new DefaultProjectDashboardService({
      projectRepo: fakeProjectRepo,
      activityRepo: fakeActivityRepo,
      progressUpdateRepo: fakeProgressUpdateRepo,
      activityMatchRepo: fakeActivityMatchRepo,
      activityProgressRepo: fakeActivityProgressRepo,
      evidenceRepo: fakeEvidenceRepo,
      progressSnapshotService: fakeSnapshotService,
      riskClassificationService: fakeRiskService,
      projectIntelligenceService: fakeIntelligenceService
    });
  });

  describe('Project Validation and Isolation', () => {
    it('throws NotFoundError if project does not exist', () => {
      expect(() => service.getDashboard('non-existent-project')).toThrow(NotFoundError);
    });

    it('validates asOfDate format and throws ValidationError on invalid date', () => {
      expect(() => service.getDashboard(projectId, { asOfDate: 'invalid-date' })).toThrow(ValidationError);
    });

    it('maintains strict project isolation by passing projectId to all repositories and services', () => {
      service.getDashboard(projectId, { asOfDate: '2026-08-28' });

      expect(fakeProjectRepo.getById).toHaveBeenCalledWith(projectId);
      expect(fakeSnapshotService.getProgressSnapshot).toHaveBeenCalledWith(projectId, '2026-08-28');
      expect(fakeRiskService.getProjectRiskStatus).toHaveBeenCalledWith(projectId, '2026-08-28');
      expect(fakeIntelligenceService.getIntelligence).toHaveBeenCalledWith(projectId, expect.objectContaining({ asOfDate: '2026-08-28' }));
      expect(fakeActivityRepo.listByProjectId).toHaveBeenCalledWith(projectId);
      expect(fakeProgressUpdateRepo.listByProjectId).toHaveBeenCalledWith(projectId);
      expect(fakeActivityMatchRepo.listByProjectId).toHaveBeenCalledWith(projectId);
    });
  });

  describe('Project Health and Activity Status Composition', () => {
    it('computes overall actual, planned, variance, and overall risk classification deterministically', () => {
      const dashboard = service.getDashboard(projectId, { asOfDate: '2026-08-28' });

      expect(dashboard.project.id).toBe(projectId);
      expect(dashboard.project.name).toBe('Metro Line Corridor');
      expect(dashboard.project.code).toBe('MLC-01');

      // (100 + 30 + 100 + 0) / 4 = 230 / 4 = 57.5%
      expect(dashboard.health.overallActualProgress).toBe(57.5);
      // (100 + 90 + 100 + 100) / 4 = 390 / 4 = 97.5%
      expect(dashboard.health.overallPlannedProgress).toBe(97.5);
      // 57.5 - 97.5 = -40 points
      expect(dashboard.health.progressVariance).toBe(-40);
      expect(dashboard.health.varianceState).toBe('behind');
      // AT_RISK because atRisk > 0 and delayed === 0
      expect(dashboard.health.overallRiskClassification).toBe('AT_RISK');
      expect(dashboard.health.asOfDate).toBe('2026-08-28');

      // Activity status summary
      expect(dashboard.activityStatus.totalActivities).toBe(4);
      expect(dashboard.activityStatus.completed).toBe(2);
      expect(dashboard.activityStatus.atRisk).toBe(2);
      expect(dashboard.activityStatus.delayed).toBe(0);
      expect(dashboard.activityStatus.onTrack).toBe(0);
      expect(dashboard.activityStatus.ahead).toBe(0);
    });

    it('directly consumes canonical snapshot aggregate progress without recomputing from activities', () => {
      fakeSnapshotService.getProgressSnapshot = vi.fn().mockReturnValue({
        projectId,
        asOfDate: '2026-08-28',
        generatedAt: '2026-08-28T10:00:00.000Z',
        overallActualProgress: 88.5,
        overallPlannedProgress: 92.0,
        progressVariance: -3.5,
        varianceState: 'behind',
        activities: [], // Empty activities: if dashboard recalculated by averaging, it would yield 0
        summary: {
          totalActivities: 0,
          notStarted: 0,
          started: 0,
          inProgress: 0,
          completed: 0,
          delayed: 0,
          overdue: 0,
          ahead: 0,
          onPlan: 0,
          behind: 0,
          overallActualProgress: 88.5,
          overallPlannedProgress: 92.0,
          progressVariance: -3.5,
          varianceState: 'behind'
        }
      });

      const dashboard = service.getDashboard(projectId, { asOfDate: '2026-08-28' });

      expect(dashboard.health.overallActualProgress).toBe(88.5);
      expect(dashboard.health.overallPlannedProgress).toBe(92.0);
      expect(dashboard.health.progressVariance).toBe(-3.5);
      expect(dashboard.health.varianceState).toBe('behind');
    });
  });

  describe('Needs Attention Summary', () => {
    it('aggregates delayed, at-risk, stale, and unresolved match counts with items', () => {
      const dashboard = service.getDashboard(projectId, { asOfDate: '2026-08-28' });

      expect(dashboard.attention.delayedCount).toBe(0);
      expect(dashboard.attention.atRiskCount).toBe(1);
      expect(dashboard.attention.atRisk[0].externalId).toBe('STRUC-201');

      expect(dashboard.attention.staleCount).toBe(1);
      expect(dashboard.attention.stale[0].externalId).toBe('STRUC-201');

      // Unresolved suggested matches
      expect(dashboard.attention.unresolvedMatchesCount).toBe(1);
      expect(dashboard.attention.unresolvedMatches[0].matchId).toBe('match-2');
      expect(dashboard.attention.unresolvedMatches[0].activityExternalId).toBe('STRUC-201');
      expect(dashboard.attention.unresolvedMatches[0].reviewState).toBe('unresolved');
    });
  });

  describe('Milestones Section', () => {
    it('classifies upcoming, completed, and late zero-duration milestones', () => {
      const dashboard = service.getDashboard(projectId, { asOfDate: '2026-08-28' });

      // Upcoming
      expect(dashboard.milestones.upcoming.length).toBe(1);
      expect(dashboard.milestones.upcoming[0].externalId).toBe('MS-DECK');
      expect(dashboard.milestones.upcoming[0].isCompleted).toBe(false);

      // Completed
      expect(dashboard.milestones.completed.length).toBe(1);
      expect(dashboard.milestones.completed[0].externalId).toBe('MS-START');
      expect(dashboard.milestones.completed[0].isCompleted).toBe(true);
    });
  });

  describe('Recent Updates and Evidence Provenance', () => {
    it('composes bounded recent updates with matches, observations, and evidence', () => {
      const dashboard = service.getDashboard(projectId, { asOfDate: '2026-08-28', recentLimit: 10 });

      expect(dashboard.recentUpdates.length).toBe(2);

      // Update 1
      const upd1 = dashboard.recentUpdates[0];
      expect(upd1.id).toBe('upd-1');
      expect(upd1.sourceType).toBe('manual');
      expect(upd1.reporterName).toBe('Suresh Site Eng');
      expect(upd1.matches.length).toBe(2);
      expect(upd1.matches[0].status).toBe('confirmed');
      expect(upd1.matches[1].status).toBe('suggested');
      expect(upd1.canonicalObservations.length).toBe(1);
      expect(upd1.canonicalObservations[0].actualPercent).toBe(100);

      // Update 2 (PDF with evidence)
      const upd2 = dashboard.recentUpdates[1];
      expect(upd2.id).toBe('upd-2');
      expect(upd2.sourceType).toBe('pdf');
      expect(upd2.evidenceList.length).toBe(1);
      expect(upd2.evidenceList[0].fileName).toBe('daily_report_27aug.pdf');
      // Ensure raw server filesystem path is not exposed
      expect((upd2.evidenceList[0] as any).filePath).toBeUndefined();
    });

    it('executes single bounded batch queries for matches, observations, and evidence across recent updates', () => {
      service.getDashboard(projectId, { asOfDate: '2026-08-28', recentLimit: 10 });

      // Verifying batch query methods were called exactly once with bounded update IDs
      expect(fakeActivityMatchRepo.listByProgressUpdateIds).toHaveBeenCalledTimes(1);
      expect(fakeActivityMatchRepo.listByProgressUpdateIds).toHaveBeenCalledWith(['upd-1', 'upd-2'], projectId);

      expect(fakeActivityProgressRepo.listByProgressUpdateIds).toHaveBeenCalledTimes(1);
      expect(fakeActivityProgressRepo.listByProgressUpdateIds).toHaveBeenCalledWith(['upd-1', 'upd-2'], projectId);

      expect(fakeEvidenceRepo.listByProgressUpdateIds).toHaveBeenCalledTimes(1);
      expect(fakeEvidenceRepo.listByProgressUpdateIds).toHaveBeenCalledWith(['upd-1', 'upd-2'], projectId);

      // Verifying per-update queries are NOT executed in the loop
      expect(fakeActivityMatchRepo.listByProgressUpdateId).not.toHaveBeenCalled();
      expect(fakeActivityProgressRepo.listByProgressUpdateId).not.toHaveBeenCalled();
      expect(fakeEvidenceRepo.listByProgressUpdateId).not.toHaveBeenCalled();
    });
  });
});
