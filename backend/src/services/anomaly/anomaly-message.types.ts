import { z } from 'zod';
import type { AnomalyPrediction } from '../../ml/types.js';

export type AnomalyAlertSeverity = 'review' | 'high';

/**
 * Narrow, explicit factual input contract for anomaly message generation.
 * Contains only trusted server-owned facts needed to communicate the anomaly.
 */
export interface GenerateAnomalyMessageInput {
  projectName: string;
  activityExternalId: string;
  activityName: string;
  activityLocation?: string | null;
  reportDate: string;
  reporterName?: string | null;
  previousPercent?: number | null;
  reportedPercent: number;
  anomalyScore: number;
  anomalySeverity: AnomalyAlertSeverity;
  anomalyReasons: string[];
  activityMatchId?: string | null;
}

/**
 * Contextual options for adapting a trusted Phase 1 AnomalyPrediction
 * into a Phase 2 GenerateAnomalyMessageInput.
 */
export interface AdaptAnomalyEvaluationOptions {
  projectId?: string | null;
  projectName: string;
  activityExternalId: string;
  activityName: string;
  activityLocation?: string | null;
  reportDate: string;
  reporterName?: string | null;
  previousPercent?: number | null;
  reportedPercent: number;
  activityMatchId?: string | null;
}

/**
 * Predicate determining whether an AnomalyPrediction represents an anomalous state
 * eligible for natural-language alert message generation.
 *
 * Invariant: 'normal' severity observations and non-positive scores (cold starts)
 * are NEVER eligible for anomaly message generation.
 */
export function isEligibleForAnomalyAlert(
  prediction: AnomalyPrediction | null | undefined
): boolean {
  if (!prediction) return false;
  if (prediction.severity === 'normal') return false;
  if (prediction.anomalyScore <= 0) return false;
  return prediction.severity === 'review' || prediction.severity === 'high';
}

/**
 * Adapts a trusted Phase 1 AnomalyPrediction and activity context into a
 * validated GenerateAnomalyMessageInput without recalculating or modifying anomaly facts.
 *
 * Returns null if the prediction is not an actionable anomaly ('normal' or cold-start).
 */
export function toAnomalyMessageInput(
  prediction: AnomalyPrediction | null | undefined,
  context: AdaptAnomalyEvaluationOptions
): GenerateAnomalyMessageInput | null {
  if (!isEligibleForAnomalyAlert(prediction)) {
    return null;
  }

  return {
    projectName: context.projectName,
    activityExternalId: context.activityExternalId,
    activityName: context.activityName,
    activityLocation: context.activityLocation ?? null,
    reportDate: context.reportDate,
    reporterName: context.reporterName ?? null,
    previousPercent: context.previousPercent ?? null,
    reportedPercent: context.reportedPercent,
    anomalyScore: prediction!.anomalyScore,
    anomalySeverity: prediction!.severity as AnomalyAlertSeverity,
    anomalyReasons: prediction!.reasons,
    activityMatchId: context.activityMatchId ?? null
  };
}

/**
 * Zod schema for structured LLM response output validation.
 * The LLM is ONLY permitted to generate these 5 textual communication fields.
 * It is strictly forbidden from authoring or overriding server-owned metadata.
 */
export const anomalyAlertPayloadSchema = z.object({
  title: z
    .string()
    .trim()
    .min(5, 'Title must be at least 5 characters')
    .max(200, 'Title must not exceed 200 characters'),
  summary: z
    .string()
    .trim()
    .min(10, 'Summary must be at least 10 characters')
    .max(500, 'Summary must not exceed 500 characters'),
  details: z
    .string()
    .trim()
    .min(10, 'Details must be at least 10 characters')
    .max(2000, 'Details must not exceed 2000 characters'),
  recommendedAction: z
    .string()
    .trim()
    .min(10, 'Recommended action must be at least 10 characters')
    .max(500, 'Recommended action must not exceed 500 characters'),
  fullMessage: z
    .string()
    .trim()
    .min(20, 'Full message must be at least 20 characters')
    .max(4000, 'Full message must not exceed 4000 characters')
});

export type AnomalyAlertPayload = z.infer<typeof anomalyAlertPayloadSchema>;

/**
 * Authoritative output contract for FieldLine Anomaly Alerts.
 * Combines LLM-generated communication text with immutable, server-owned metadata
 * for deterministic future correlation (Phase 4) and multi-channel delivery (Phases 3 & 5).
 */
export interface AnomalyAlertMessage extends AnomalyAlertPayload {
  // Server-owned correlation and domain context
  activityMatchId: string | null;
  projectName: string;
  activityExternalId: string;
  activityName: string;
  activityLocation: string | null;
  reportDate: string;
  reporterName: string | null;
  previousPercent: number | null;
  reportedPercent: number;

  // Server-owned anomaly detection truth (from Phase 1)
  severity: AnomalyAlertSeverity;
  anomalyScore: number;
  anomalyReasons: string[];

  // Generation origin and diagnostics
  generatedBy: 'groq' | 'deterministic_fallback';
  fallbackReason?: string;
  generatedAt: string;
}

export interface AnomalyMessageGeneratorService {
  /**
   * Generates a concise, grounded natural-language alert from structured anomaly facts.
   * Uses Groq structured output with deterministic fallback on failure.
   * Throws ValidationError if invoked for normal observations or cold-starts.
   */
  generateAnomalyMessage(input: GenerateAnomalyMessageInput): Promise<AnomalyAlertMessage>;
}
