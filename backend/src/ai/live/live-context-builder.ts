import { Project } from '../../models/domain.types.js';
import {
  ProgressSnapshotService,
  progressSnapshotService as defaultSnapshotService,
  getTodayDateString
} from '../../services/snapshot/progress-snapshot.service.js';
import {
  ProjectIntelligenceService,
  projectIntelligenceService as defaultIntelligenceService
} from '../../services/intelligence/project-intelligence.service.js';

export interface LiveContextBuilderOptions {
  snapshotService?: ProgressSnapshotService;
  intelligenceService?: ProjectIntelligenceService;
  todayDate?: string;
  role?: 'worker' | 'admin';
}

export const PARDON_ME_PROTOCOL = `If any activity code, location, or quantity is phonetically unclear, muffled, or ambiguous, ask back for pardon: "Pardon me, did you mean Section B or D?" Never guess or hallucinate unconfirmed progress.`;

/**
 * Builds a concise, project-grounded systemInstruction text for Gemini Multimodal Live sessions.
 * Injects project metadata, active milestones, high-level schedule progress, and strict "Pardon Me" protocol.
 */
export function buildLiveSystemInstruction(
  project: Project,
  options: LiveContextBuilderOptions = {}
): string {
  const snapshotService = options.snapshotService || defaultSnapshotService;
  const intelligenceService = options.intelligenceService || defaultIntelligenceService;
  const today = options.todayDate || getTodayDateString();

  let overallActualProgress = 0;
  let overallPlannedProgress = 0;
  let totalActivities = 0;
  let varianceState = 'on_plan';
  let projectRiskStatus = 'ON_TRACK';
  let delayedCount = 0;
  let atRiskCount = 0;
  const approachingMilestones: string[] = [];
  const topDelayed: string[] = [];
  const topAtRisk: string[] = [];

  try {
    const snapshot = snapshotService.getProgressSnapshot(project.id, today);
    if (snapshot && snapshot.summary) {
      overallActualProgress = snapshot.summary.overallActualProgress;
      overallPlannedProgress = snapshot.summary.overallPlannedProgress;
      totalActivities = snapshot.summary.totalActivities;
      varianceState = snapshot.summary.varianceState;
    }
  } catch {
    // Graceful fallback if snapshot calculation cannot be completed
  }

  try {
    const intelligence = intelligenceService.getIntelligence(project.id, { asOfDate: today });
    if (intelligence) {
      delayedCount = intelligence.delayed?.length || 0;
      atRiskCount = intelligence.atRisk?.length || 0;
      projectRiskStatus = delayedCount > 0 ? 'DELAYED' : atRiskCount > 0 ? 'AT_RISK' : 'ON_TRACK';
    }

    if (intelligence && Array.isArray(intelligence.approachingMilestones)) {
      for (const m of intelligence.approachingMilestones.slice(0, 3)) {
        approachingMilestones.push(
          `- ${m.name} (${m.externalId}): Scheduled ${m.milestoneDate} (${m.daysUntil} days left, ${m.actualProgress}% completed, status: ${m.status})`
        );
      }
    }

    if (intelligence && Array.isArray(intelligence.delayed)) {
      for (const d of intelligence.delayed.slice(0, 4)) {
        const reasonsStr = d.reasons.map((r) => r.message).join('; ');
        topDelayed.push(
          `- ${d.name} (${d.externalId}): planned finish ${d.plannedFinish}, ${d.progressVariance}% variance (${d.overdue ? 'overdue' : 'behind'}). Reason: ${reasonsStr}`
        );
      }
    }

    if (intelligence && Array.isArray(intelligence.atRisk)) {
      for (const r of intelligence.atRisk.slice(0, 3)) {
        const reasonsStr = r.reasons.map((re) => re.message).join('; ');
        topAtRisk.push(
          `- ${r.name} (${r.externalId}): ${r.progressVariance}% variance. Risk: ${reasonsStr}`
        );
      }
    }
  } catch {
    // Graceful fallback if intelligence cannot be computed
  }

  const milestonesSection =
    approachingMilestones.length > 0
      ? `\nACTIVE / APPROACHING MILESTONES:\n${approachingMilestones.join('\n')}`
      : '\nACTIVE / APPROACHING MILESTONES: None within the upcoming 14-day window.';

  const delayedSection =
    topDelayed.length > 0
      ? `\nKEY DELAYED ACTIVITIES (${delayedCount} total):\n${topDelayed.join('\n')}`
      : '\nKEY DELAYED ACTIVITIES: None currently reported.';

  const atRiskSection =
    topAtRisk.length > 0
      ? `\nKEY AT-RISK ACTIVITIES (${atRiskCount} total):\n${topAtRisk.join('\n')}`
      : '\nKEY AT-RISK ACTIVITIES: None currently flagged.';

  const isWorker = options.role === 'worker';

  if (isWorker) {
    return `You are FieldLine Voice Assistant, an operational execution assistant for field crews and site workers.
You assist workers hands-free on the job site with immediate operational clarity: active tasks, physical location, blockers, safety precautions, and rapid verbal progress capture.

PROJECT CONTEXT SNAPSHOT:
- Project Database ID: ${project.id}
- Project Code: ${project.code}
- Project Name: ${project.name}
- Status: ${project.status}
- Today's Date: ${today}

DATABASE ACCESS & TOOL EXECUTION:
You have direct access to operational tools for this project:
1. 'lookup_activity_status': Fetches verified status, location, and progress percentage for any activity by code or name.
2. 'get_next_recommended_activities': Fetches prioritized active or upcoming tasks, optionally filtered by site location/sector.
3. 'search_project_activities': Searches operational activities in the project database by keyword, status, or location.
4. 'record_field_progress': Captures verbal progress reports to parse, link, and save progress directly to the database.
Note: When calling tools, you can pass either "${project.id}" or "${project.code}" as the projectId, or leave it blank (it automatically defaults to this active project).

CORE OPERATIONAL RULES:
1. AUDIO-FIRST & CONCISE: Speak conversationally, clearly, and concisely. Keep answers under 2 sentences.
2. ACCENT & SITE NOISE ("Pardon Me" Protocol):
   ${PARDON_ME_PROTOCOL}
3. PROGRESS REPORTING: When a worker reports completed or updated work, immediately invoke 'record_field_progress' with their exact verbal statement.
4. OPERATIONAL SCOPE BOUNDARY: If a worker asks for project-wide variance analytics, systemic portfolio delay matrices, or executive management intelligence, politely inform them: "This query requires project control room access."
5. PROFESSIONAL INDUSTRIAL PERSONA: Be helpful, accurate, calm, and safety-conscious.`;
  }

  return `You are FieldLine Voice Assistant, an intelligent speech-to-speech project management assistant for construction and civil infrastructure job sites.
You assist site engineers, foremen, and field workers who interact via hands-free headsets on the job site.

PROJECT CONTEXT SNAPSHOT:
- Project Database ID: ${project.id}
- Project Code: ${project.code}
- Project Name: ${project.name}
- Status: ${project.status}
- Today's Date: ${today}
- Schedule Performance: ${overallActualProgress}% actual vs ${overallPlannedProgress}% planned (${varianceState.replace('_', ' ')}, Overall: ${projectRiskStatus})
- Total Tracked Activities: ${totalActivities}
- Delayed Activities: ${delayedCount}
- At-Risk Activities: ${atRiskCount}${delayedSection}${atRiskSection}${milestonesSection}

DATABASE ACCESS & TOOL EXECUTION:
You have FULL, LIVE ACCESS to the FieldLine SQLite database for this project.
When a worker asks about project progress, status, delays, or tasks, use these live tools:
1. 'get_project_intelligence': Fetches overall schedule health, all delayed activities and reasons, at-risk tasks, approaching milestones, and recent changes.
2. 'lookup_activity_status': Fetches verified actual/planned progress, variance, and delay blockers for any activity by code or name.
3. 'get_next_recommended_activities': Fetches prioritized upcoming or in-progress tasks, optionally filtered by site location/sector.
4. 'search_project_activities': Searches or lists activities in the project database by keyword, status ('not_started', 'in_progress', 'completed', 'all'), or location.
5. 'record_field_progress': Captures verbal progress reports to parse, link, and save progress directly to the database.
6. 'query_project_assistant': Runs verified fact-grounded reasoning over the project database for analytical questions.
Note: When calling tools, you can pass either "${project.id}" or "${project.code}" as the projectId, or leave it blank (it automatically defaults to this active project).

CORE OPERATIONAL RULES:
1. AUDIO-FIRST & CONCISE: Speak conversationally, clearly, and concisely. Keep spoken answers under 2-3 sentences unless detailed technical schedule breakdowns are explicitly requested.
2. ACCENT & SITE NOISE ("Pardon Me" Protocol):
   ${PARDON_ME_PROTOCOL}
3. PROGRESS REPORTING: When a worker reports completed or updated work, immediately invoke the 'record_field_progress' tool with their exact verbal statement. Acknowledge receipt immediately and conversationally (e.g., "Understood, recording that Pier 12 excavation is finished. Logging that now.").
4. TASK LOOKUPS & RECOMMENDATIONS:
   - When a worker asks what to do next or queries next tasks at a location/pier/zone, call 'get_next_recommended_activities'.
   - When a worker asks about the status, progress, delay, or variance of an activity, call 'lookup_activity_status'.
   - When a worker asks what is delayed, what is at risk, or how the project is doing, call 'get_project_intelligence'.
5. PROFESSIONAL INDUSTRIAL PERSONA: Be helpful, accurate, calm, and safety-conscious. Never invent progress numbers or schedule dates.`;
}
