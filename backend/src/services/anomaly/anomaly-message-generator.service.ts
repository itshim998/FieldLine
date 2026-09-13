import { AIService, aiService as defaultAiService } from '../../ai/services/ai.service.js';
import { logger } from '../../config/logger.js';
import { ValidationError } from '../../errors/AppError.js';
import {
  AnomalyAlertMessage,
  AnomalyMessageGeneratorService,
  GenerateAnomalyMessageInput,
  anomalyAlertPayloadSchema
} from './anomaly-message.types.js';

/**
 * Builds an explicit, deterministic prompt instructing Groq to produce
 * a professional, strictly grounded natural-language alert from structured anomaly facts.
 */
export function buildAnomalyMessagePrompt(input: GenerateAnomalyMessageInput): string {
  const previousText =
    input.previousPercent !== null && input.previousPercent !== undefined
      ? `${input.previousPercent}%`
      : 'None recorded (initial canonical observation; do NOT state or imply an increase from a prior percentage)';

  const locationText = input.activityLocation || 'Unspecified (do not invent a location)';
  const reporterText = input.reporterName || 'Unspecified (do not invent a reporter)';
  const scorePercent = Math.round(input.anomalyScore * 100);

  const reasonsText =
    input.anomalyReasons && input.anomalyReasons.length > 0
      ? input.anomalyReasons.map((r, i) => `  ${i + 1}. ${r}`).join('\n')
      : '  1. Progression rate deviates substantially from the learned statistical baseline.';

  return [
    'You are the FieldLine Operational Anomaly Communication Assistant.',
    'Your role is to translate an already-evaluated statistical progression anomaly into a concise, professional, grounded alert message for project administrators.',
    '',
    'CRITICAL OPERATIONAL & ETHICAL BOUNDARIES:',
    '1. STRICT GROUNDING: Use ONLY the supplied facts below. Do NOT invent, assume, or hallucinate information such as causes, weather, supply chain issues, photos, sensor readings, CCTV footage, or schedule milestones not provided.',
    '2. NO ACCUSATIONS: NEVER accuse workers or contractors of fraud, dishonesty, lying, fabrication, or negligence. Avoid accusatory words (e.g. "fake", "fraudulent", "fabricated", "dishonest", "suspicious", "negligent").',
    '3. STATISTICAL NATURE: The anomaly score (e.g. 91% or 0.91) indicates the mathematical degree of statistical deviation from the learned progression baseline. It does NOT represent a probability of fraud, dishonesty, lying, theft, negligence, or report fabrication. NEVER state or imply that there is a "probability of fraud" or "chance of false reporting".',
    '4. ACTIVITY IDENTITY IS INDEPENDENT & TRUSTED: The activity match is verified and confirmed. The anomaly concerns the reported progress velocity/increment relative to historical shift pacing, NOT whether the activity was correctly identified. Do NOT question whether the activity is correct or suggest re-identifying the activity.',
    '5. OBJECTIVE TONE: Frame the message as an objective operational heads-up recommending human verification in the field.',
    '6. ABSENT DATA INTEGRITY: If previous progress, reporter, or location is unspecified, gracefully omit them or state that they are unrecorded. NEVER assume or hallucinate unprovided context (e.g. weather conditions, equipment breakdowns, material supply delays, worker conversations, site photos, or CCTV footage).',
    '',
    'SUPPLIED ANOMALY FACTS:',
    `- Project: ${input.projectName}`,
    `- Activity External ID: ${input.activityExternalId}`,
    `- Activity Name: ${input.activityName}`,
    `- Activity Location: ${locationText}`,
    `- Report Date: ${input.reportDate}`,
    `- Reported By: ${reporterText}`,
    `- Previous Canonical Progress: ${previousText}`,
    `- Reported Progress: ${input.reportedPercent}%`,
    `- Anomaly Severity: ${input.anomalySeverity.toUpperCase()}`,
    `- Anomaly Score: ${scorePercent}% (${input.anomalyScore.toFixed(2)})`,
    `- Statistical Reasons:`,
    reasonsText,
    '',
    'REQUIRED OUTPUT SCHEMA (Respond with a valid JSON object):',
    '{',
    '  "title": "Concise alert headline (e.g. [FieldLine Alert] HIGH: Piping Installation (ACT-PIPE-02) Progress Deviation)",',
    '  "summary": "1-2 sentence executive summary of the flagged progress report and its operational context.",',
    '  "details": "Factual breakdown detailing the reported progress vs previous progress and the specific statistical anomalies detected.",',
    '  "recommendedAction": "Actionable, professional recommendation for supervisor verification in the field.",',
    '  "fullMessage": "Cohesive, complete alert notification text combining headline, summary, details, and next steps ready for administrator review."',
    '}'
  ].join('\n');
}

/**
 * Deterministic fallback message generator.
 * Produces a high-fidelity, grounded operational alert message without AI invocation
 * when Groq is unavailable, rate-limited, timed out, or returns malformed output.
 */
export function generateDeterministicFallbackMessage(
  input: GenerateAnomalyMessageInput,
  failureReason?: string
): AnomalyAlertMessage {
  const sevLabel = input.anomalySeverity === 'high' ? 'HIGH' : 'REVIEW';
  const title = `[FieldLine Alert] ${sevLabel}: ${input.activityName} (${input.activityExternalId}) Progress Deviation`;

  const locText = input.activityLocation ? ` at ${input.activityLocation}` : '';
  const reporterText = input.reporterName ? ` by ${input.reporterName}` : '';
  const scorePercent = Math.round(input.anomalyScore * 100);

  const summary =
    input.anomalySeverity === 'high'
      ? `A reported progress of ${input.reportedPercent}% for ${input.activityName} (${input.activityExternalId})${locText}${reporterText} has been flagged with HIGH statistical deviation from historical progression baselines.`
      : `A progress report of ${input.reportedPercent}% for ${input.activityName} (${input.activityExternalId})${locText}${reporterText} shows elevated statistical deviation requiring supervisor review.`;

  const formattedReasons =
    input.anomalyReasons && input.anomalyReasons.length > 0
      ? input.anomalyReasons.map((r) => `• ${r}`).join('\n')
      : '• Reported progression increment is significantly outside the learned baseline pattern.';

  const progressionTrajectory =
    input.previousPercent !== null && input.previousPercent !== undefined
      ? `Progress shifted from ${input.previousPercent}% to ${input.reportedPercent}% (net increment: ${input.reportedPercent - input.previousPercent}%).`
      : `Initial recorded progress observation of ${input.reportedPercent}% (no prior canonical progress recorded).`;

  const detailLines: string[] = [
    `Project: ${input.projectName}`,
    `Activity: ${input.activityName} (${input.activityExternalId})`,
    input.activityLocation ? `Location: ${input.activityLocation}` : null,
    input.reporterName ? `Reported By: ${input.reporterName}` : null,
    `Report Date: ${input.reportDate}`,
    input.previousPercent !== null && input.previousPercent !== undefined
      ? `Previous Canonical Progress: ${input.previousPercent}%`
      : 'Previous Canonical Progress: None recorded (baseline pace evaluation)',
    `Reported Progress: ${input.reportedPercent}%`,
    `Progression Trajectory: ${progressionTrajectory}`,
    `Statistical Anomaly Score: ${scorePercent}% deviation from learned baseline (${sevLabel})`,
    'Statistical Observations:',
    formattedReasons
  ].filter(Boolean) as string[];

  const details = detailLines.join('\n');

  const recommendedAction =
    input.anomalySeverity === 'high'
      ? 'Conduct an immediate on-site physical inspection to verify actual installation progress and review supporting field documentation before canonical sign-off.'
      : 'Review reported progress against recent field logs and verify completion status with the site supervisor before confirming.';

  const fullMessage = [
    title,
    '',
    summary,
    '',
    'Details:',
    details,
    '',
    'Recommended Action:',
    recommendedAction
  ].join('\n');

  return {
    title,
    summary,
    details,
    recommendedAction,
    fullMessage,
    activityMatchId: input.activityMatchId ?? null,
    projectName: input.projectName,
    activityExternalId: input.activityExternalId,
    activityName: input.activityName,
    activityLocation: input.activityLocation ?? null,
    reportDate: input.reportDate,
    reporterName: input.reporterName ?? null,
    previousPercent: input.previousPercent ?? null,
    reportedPercent: input.reportedPercent,
    severity: input.anomalySeverity,
    anomalyScore: input.anomalyScore,
    anomalyReasons: [...input.anomalyReasons],
    generatedBy: 'deterministic_fallback',
    ...(failureReason ? { fallbackReason: failureReason } : {}),
    generatedAt: new Date().toISOString()
  };
}

/**
 * Service implementation for converting evaluated FieldLine anomalies into
 * grounded, channel-neutral administrator alert messages via Groq with deterministic fallback.
 */
export class DefaultAnomalyMessageGeneratorService implements AnomalyMessageGeneratorService {
  private aiService: AIService;

  constructor(aiServiceInstance: AIService = defaultAiService) {
    this.aiService = aiServiceInstance;
  }

  async generateAnomalyMessage(input: GenerateAnomalyMessageInput): Promise<AnomalyAlertMessage> {
    // 1. Rigorous input validation
    this.validateInput(input);

    // 2. Build explicit, grounded prompt
    const prompt = buildAnomalyMessagePrompt(input);

    try {
      logger.debug(
        `AnomalyMessageGeneratorService: Requesting structured alert for activity '${input.activityExternalId}' (severity: ${input.anomalySeverity})`
      );

      const payload = await this.aiService.extractStructured(prompt, anomalyAlertPayloadSchema, {
        temperature: 0.1
      });

      return {
        ...payload,
        activityMatchId: input.activityMatchId ?? null,
        projectName: input.projectName,
        activityExternalId: input.activityExternalId,
        activityName: input.activityName,
        activityLocation: input.activityLocation ?? null,
        reportDate: input.reportDate,
        reporterName: input.reporterName ?? null,
        previousPercent: input.previousPercent ?? null,
        reportedPercent: input.reportedPercent,
        severity: input.anomalySeverity,
        anomalyScore: input.anomalyScore,
        anomalyReasons: [...input.anomalyReasons],
        generatedBy: 'groq',
        generatedAt: new Date().toISOString()
      };
    } catch (error: any) {
      logger.warn(
        `AnomalyMessageGeneratorService: Groq message generation failed for activity '${input.activityExternalId}'. Falling back to deterministic alert: ${error?.message || error}`
      );
      return generateDeterministicFallbackMessage(input, error?.message || String(error));
    }
  }

  private validateInput(input: GenerateAnomalyMessageInput): void {
    if (!input) {
      throw new ValidationError('GenerateAnomalyMessageInput cannot be null or undefined');
    }

    if (!input.projectName || typeof input.projectName !== 'string' || input.projectName.trim().length === 0) {
      throw new ValidationError('Project name is required for anomaly message generation');
    }

    if (
      !input.activityExternalId ||
      typeof input.activityExternalId !== 'string' ||
      input.activityExternalId.trim().length === 0
    ) {
      throw new ValidationError('Activity external ID is required for anomaly message generation');
    }

    if (!input.activityName || typeof input.activityName !== 'string' || input.activityName.trim().length === 0) {
      throw new ValidationError('Activity name is required for anomaly message generation');
    }

    if (!input.reportDate || typeof input.reportDate !== 'string' || input.reportDate.trim().length === 0) {
      throw new ValidationError('Report date is required for anomaly message generation');
    }

    if (
      input.reportedPercent === null ||
      input.reportedPercent === undefined ||
      typeof input.reportedPercent !== 'number' ||
      !Number.isFinite(input.reportedPercent) ||
      input.reportedPercent < 0 ||
      input.reportedPercent > 100
    ) {
      throw new ValidationError('Reported percent must be a finite number between 0 and 100');
    }

    if (
      input.anomalyScore === null ||
      input.anomalyScore === undefined ||
      typeof input.anomalyScore !== 'number' ||
      !Number.isFinite(input.anomalyScore) ||
      input.anomalyScore < 0 ||
      input.anomalyScore > 1
    ) {
      throw new ValidationError('Anomaly score must be a finite number between 0.0 and 1.0');
    }

    // Strict Anomaly Invariant: Reject normal or cold-start observations
    const sev = (input.anomalySeverity as string) || '';
    if (sev === 'normal' || input.anomalyScore <= 0) {
      throw new ValidationError(
        "Cannot generate anomaly alert for normal or cold-start observation. Severity must be 'review' or 'high' and anomaly score must be greater than 0."
      );
    }

    if (sev !== 'review' && sev !== 'high') {
      throw new ValidationError(
        `Invalid anomaly severity '${sev}'. Must be strictly 'review' or 'high'.`
      );
    }
  }
}

export const defaultAnomalyMessageGeneratorService = new DefaultAnomalyMessageGeneratorService();
