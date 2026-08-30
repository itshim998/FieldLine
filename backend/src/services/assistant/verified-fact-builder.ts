import {
  ProjectIntelligenceService,
  projectIntelligenceService as defaultIntelligenceService
} from '../intelligence/project-intelligence.service.js';
import {
  ProgressSnapshotService,
  progressSnapshotService as defaultSnapshotService
} from '../snapshot/progress-snapshot.service.js';
import {
  ActivityProgressRepository,
  activityProgressRepository as defaultActivityProgressRepo
} from '../../repositories/activity-progress.repository.js';
import {
  AssistantIntent,
  AssistantIntentType
} from '../../ai/contracts/assistant.contract.js';
import {
  VerifiedFact,
  ResolvedActivityInfo,
  MAX_VERIFIED_FACTS_LIMIT
} from './assistant.types.js';

export class VerifiedFactBuilder {
  private intelligenceService: ProjectIntelligenceService;
  private snapshotService: ProgressSnapshotService;
  private progressRepo: ActivityProgressRepository;

  constructor(
    intelligenceService: ProjectIntelligenceService = defaultIntelligenceService,
    snapshotService: ProgressSnapshotService = defaultSnapshotService,
    progressRepo: ActivityProgressRepository = defaultActivityProgressRepo
  ) {
    this.intelligenceService = intelligenceService;
    this.snapshotService = snapshotService;
    this.progressRepo = progressRepo;
  }

  /**
   * Compiles a verified, deterministic, bounded fact set from the authoritative Project Intelligence layer.
   */
  buildFacts(
    projectId: string,
    intent: AssistantIntent,
    asOfDate: string,
    resolvedActivity: ResolvedActivityInfo | null
  ): VerifiedFact[] {
    const intelligence = this.intelligenceService.getIntelligence(projectId, {
      asOfDate
    });

    // Obtain snapshot to enrich fact data attributes (e.g. status, plannedStart, varianceState)
    let snapshotMap = new Map<string, any>();
    try {
      const snapshot = this.snapshotService.getProgressSnapshot(projectId, asOfDate);
      if (snapshot && Array.isArray(snapshot.activities)) {
        for (const act of snapshot.activities) {
          snapshotMap.set(act.activityId, act);
        }
      }
    } catch {
      // Graceful fallback if snapshot not yet generated
    }

    const facts: VerifiedFact[] = [];

    switch (intent.intent) {
      case 'delayed': {
        const delayedList = resolvedActivity
          ? intelligence.delayed.filter((d) => d.activityId === resolvedActivity.id)
          : intelligence.delayed;

        for (const d of delayedList) {
          const snap = snapshotMap.get(d.activityId);
          facts.push({
            ref: `delayed:${d.externalId}`,
            category: 'delayed',
            activityId: d.activityId,
            externalId: d.externalId,
            activityName: d.name,
            summary: `Activity "${d.name}" (${d.externalId}) is DELAYED/OVERDUE as of ${asOfDate}. Execution status: ${snap?.status || 'in_progress'}. Planned finish date was ${d.plannedFinish}. Actual progress is ${d.actualProgress}%, with progress variance of ${d.progressVariance}%. Overdue: ${d.overdue}. Reasons: ${d.reasons.map((r) => r.message).join('; ')}.`,
            data: {
              ...d,
              status: snap?.status || 'in_progress',
              plannedStart: snap?.plannedStart || null,
              plannedProgress: snap?.plannedProgress ?? null,
              varianceState: snap?.varianceState || 'behind',
              snapshot: snap || null
            }
          });
        }
        break;
      }

      case 'at_risk': {
        const atRiskList = resolvedActivity
          ? intelligence.atRisk.filter((r) => r.activityId === resolvedActivity.id)
          : intelligence.atRisk;

        for (const r of atRiskList) {
          const snap = snapshotMap.get(r.activityId);
          facts.push({
            ref: `at_risk:${r.externalId}`,
            category: 'at_risk',
            activityId: r.activityId,
            externalId: r.externalId,
            activityName: r.name,
            summary: `Activity "${r.name}" (${r.externalId}) is classified AT_RISK as of ${asOfDate}. Execution status: ${snap?.status || 'in_progress'}. Planned finish date is ${r.plannedFinish}. Actual progress is ${r.actualProgress}%, progress variance is ${r.progressVariance}%. Risk signals: ${r.reasons.map((rs) => rs.message).join('; ')}.`,
            data: {
              ...r,
              status: snap?.status || 'in_progress',
              plannedStart: snap?.plannedStart || null,
              plannedProgress: snap?.plannedProgress ?? null,
              overdue: snap?.overdue ?? false,
              varianceState: snap?.varianceState || 'behind',
              snapshot: snap || null
            }
          });
        }

        // If a specific activity was asked about but is not in atRisk, provide its authoritative snapshot status fact
        if (resolvedActivity && atRiskList.length === 0) {
          const snapFact = this.buildActivitySnapshotFact(projectId, resolvedActivity, asOfDate, intelligence);
          if (snapFact) {
            facts.push(snapFact);
          }
        }
        break;
      }

      case 'completed_today': {
        const completedList = resolvedActivity
          ? intelligence.completedToday.filter((c) => c.activityId === resolvedActivity.id)
          : intelligence.completedToday;

        for (const c of completedList) {
          facts.push({
            ref: `completed:${c.externalId}`,
            category: 'completed_today',
            activityId: c.activityId,
            externalId: c.externalId,
            activityName: c.name,
            progressUpdateId: c.progressUpdateId,
            summary: `Activity "${c.name}" (${c.externalId}) completed on ${c.asOfDate} with ${c.actualPercent}% actual progress (status: ${c.status}). Progress Log: ${c.progressUpdateId || 'Direct'}.`,
            data: { ...c }
          });
        }
        break;
      }

      case 'behind_schedule': {
        // Preserves the authoritative deterministic sort order from intelligence.behindSchedule
        const behindList = resolvedActivity
          ? intelligence.behindSchedule.filter((b) => b.activityId === resolvedActivity.id)
          : intelligence.behindSchedule;

        for (const b of behindList) {
          facts.push({
            ref: `behind_schedule:${b.externalId}`,
            category: 'behind_schedule',
            activityId: b.activityId,
            externalId: b.externalId,
            activityName: b.name,
            summary: `Activity "${b.name}" (${b.externalId}) is behind schedule. Progress variance: ${b.progressVariance}% (variance state: ${b.varianceState}). Planned progress: ${b.plannedProgress}%, actual progress: ${b.actualProgress}%, planned finish: ${b.plannedFinish}, execution status: ${b.status}, overdue: ${b.overdue}.`,
            data: { ...b }
          });
        }
        break;
      }

      case 'approaching_milestones': {
        const milestoneList = resolvedActivity
          ? intelligence.approachingMilestones.filter((m) => m.activityId === resolvedActivity.id)
          : intelligence.approachingMilestones;

        for (const m of milestoneList) {
          facts.push({
            ref: `milestone:${m.externalId}`,
            category: 'approaching_milestones',
            activityId: m.activityId,
            externalId: m.externalId,
            activityName: m.name,
            summary: `Milestone "${m.name}" (${m.externalId}) is approaching on ${m.milestoneDate} (${m.daysUntil} days remaining from ${asOfDate}). Progress: ${m.actualProgress}%, execution status: ${m.status}.`,
            data: { ...m }
          });
        }
        break;
      }

      case 'stale_activities': {
        const staleList = resolvedActivity
          ? intelligence.staleActivities.filter((s) => s.activityId === resolvedActivity.id)
          : intelligence.staleActivities;

        for (const s of staleList) {
          const daysElapsed = s.daysSinceUpdate;
          const snap = snapshotMap.get(s.activityId);
          facts.push({
            ref: `stale:${s.externalId}`,
            category: 'stale_activities',
            activityId: s.activityId,
            externalId: s.externalId,
            activityName: s.name,
            summary: `Activity "${s.name}" (${s.externalId}) has no recent updates. Execution status: ${snap?.status || 'in_progress'}. Latest observation date: ${s.latestUpdateDate || 'None recorded'}. Days elapsed since progress entry: ${daysElapsed !== null ? `${daysElapsed} days` : 'Never updated'}. Actual progress: ${snap?.actualProgress ?? 0}%.`,
            data: {
              ...s,
              status: snap?.status || 'in_progress',
              actualProgress: snap?.actualProgress ?? 0,
              plannedProgress: snap?.plannedProgress ?? 0,
              plannedStart: snap?.plannedStart || null,
              plannedFinish: snap?.plannedFinish || null,
              overdue: snap?.overdue ?? false,
              varianceState: snap?.varianceState || 'on_track',
              snapshot: snap || null
            }
          });
        }
        break;
      }

      case 'recent_changes': {
        let events = intelligence.recentChanges;
        if (intent.explicitDate) {
          events = events.filter((e) => e.createdAt.startsWith(intent.explicitDate!));
        }

        // Bounded to 10 most recent events for deterministic prompt payload and low latency
        for (const e of events.slice(0, 10)) {
          const payload = (e.payload || {}) as Record<string, any>;
          facts.push({
            ref: `event:${e.eventId}`,
            category: 'recent_changes',
            summary: `Event at [${e.createdAt}] (${e.eventType}): ${e.summary}.`,
            data: {
              ...e,
              summary: e.summary,
              actualProgress: payload.actualPercent ?? payload.percent ?? payload.actualProgress ?? null,
              actualPercent: payload.actualPercent ?? payload.percent ?? payload.actualProgress ?? null,
              status: payload.status ?? null,
              payload
            }
          });
        }
        break;
      }

      case 'activity_status': {
        if (resolvedActivity) {
          const snapFact = this.buildActivitySnapshotFact(projectId, resolvedActivity, asOfDate, intelligence);
          if (snapFact) {
            facts.push(snapFact);
          }
        }
        break;
      }

      default:
        break;
    }

    // Bounded fact set limit to keep latency and payload deterministic
    return facts.slice(0, MAX_VERIFIED_FACTS_LIMIT);
  }

  private buildActivitySnapshotFact(
    projectId: string,
    resolvedActivity: ResolvedActivityInfo,
    asOfDate: string,
    _intelligence: unknown
  ): VerifiedFact | null {
    try {
      const snapshot = this.snapshotService.getProgressSnapshot(projectId, asOfDate);
      const actSnap = snapshot.activities.find((a: { activityId: string }) => a.activityId === resolvedActivity.id);
      const latestProgress = this.progressRepo.getLatestByActivityId(resolvedActivity.id);

      if (actSnap) {
        return {
          ref: `activity_status:${resolvedActivity.externalId}`,
          category: 'activity_status',
          activityId: resolvedActivity.id,
          externalId: resolvedActivity.externalId,
          activityName: resolvedActivity.name,
          progressUpdateId: latestProgress?.progressUpdateId || null,
          evidenceId: null,
          summary: `Activity "${resolvedActivity.name}" (${resolvedActivity.externalId}) as of ${asOfDate}: Execution status: ${actSnap.status}, Planned progress: ${actSnap.plannedProgress}%, Actual progress: ${actSnap.actualProgress}%, Progress variance: ${actSnap.progressVariance}%, Variance state: ${actSnap.varianceState}, Planned finish: ${actSnap.plannedFinish}, Overdue: ${actSnap.overdue}, Location: ${resolvedActivity.location || 'N/A'}.`,
          data: {
            activityId: resolvedActivity.id,
            externalId: resolvedActivity.externalId,
            name: resolvedActivity.name,
            location: resolvedActivity.location,
            snapshot: actSnap,
            latestProgress
          }
        };
      }
    } catch {
      // Return fallback if snapshot not available
    }

    return {
      ref: `activity_status:${resolvedActivity.externalId}`,
      category: 'activity_status',
      activityId: resolvedActivity.id,
      externalId: resolvedActivity.externalId,
      activityName: resolvedActivity.name,
      summary: `Activity "${resolvedActivity.name}" (${resolvedActivity.externalId}) is registered in project ${projectId}. Location: ${resolvedActivity.location || 'N/A'}.`,
      data: {
        activityId: resolvedActivity.id,
        externalId: resolvedActivity.externalId,
        name: resolvedActivity.name
      }
    };
  }
}

export const verifiedFactBuilder = new VerifiedFactBuilder();
