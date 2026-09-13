import { describe, it, expect, beforeEach } from 'vitest';
import {
  DefaultAnomalyMessageGeneratorService,
  buildAnomalyMessagePrompt,
  generateDeterministicFallbackMessage
} from '../src/services/anomaly/anomaly-message-generator.service.js';
import {
  GenerateAnomalyMessageInput,
  anomalyAlertPayloadSchema,
  isEligibleForAnomalyAlert,
  toAnomalyMessageInput
} from '../src/services/anomaly/anomaly-message.types.js';
import { AnomalyPrediction } from '../src/ml/types.js';
import { DefaultAIService } from '../src/ai/services/ai.service.js';
import { MockAIProvider } from '../src/ai/providers/mock-ai.provider.js';
import { ValidationError } from '../src/errors/AppError.js';

describe('Groq Anomaly Message Generator — Phase 2 Production Suite', () => {
  let mockProvider: MockAIProvider;
  let aiService: DefaultAIService;
  let generator: DefaultAnomalyMessageGeneratorService;

  const validHighInput: GenerateAnomalyMessageInput = {
    projectName: 'Refinery Construction Unit 4',
    activityExternalId: 'ACT-PIPE-02',
    activityName: 'Cooling Water Underground Piping',
    activityLocation: 'Area B — Utility Trench',
    reportDate: '2026-08-16',
    reporterName: 'Rajesh Kumar',
    previousPercent: 41,
    reportedPercent: 82,
    anomalyScore: 0.91,
    anomalySeverity: 'high',
    anomalyReasons: [
      'Unusually large progression increment compared with historical shift baseline.',
      'Daily progress velocity is well above the learned baseline distribution.'
    ],
    activityMatchId: 'match-act-pipe-02-uuid'
  };

  const validReviewInput: GenerateAnomalyMessageInput = {
    projectName: 'Refinery Construction Unit 4',
    activityExternalId: 'ACT-FOUND-01',
    activityName: 'Foundation Footing Concrete Pour',
    activityLocation: 'Sector 2',
    reportDate: '2026-08-16',
    reporterName: 'Sunita Sharma',
    previousPercent: 30,
    reportedPercent: 55,
    anomalyScore: 0.62,
    anomalySeverity: 'review',
    anomalyReasons: [
      'Daily progress velocity is moderately above learned baseline.'
    ],
    activityMatchId: 'match-act-found-01-uuid'
  };

  beforeEach(() => {
    mockProvider = new MockAIProvider();
    aiService = new DefaultAIService(mockProvider);
    generator = new DefaultAnomalyMessageGeneratorService(aiService);
  });

  describe('1. Trust Boundary: Phase 1 Adapter & Predicate', () => {
    it('toAnomalyMessageInput adapts a trusted Phase 1 AnomalyPrediction into GenerateAnomalyMessageInput', () => {
      const phase1Prediction: AnomalyPrediction = {
        anomalyScore: 0.91,
        severity: 'high',
        reviewRecommended: true,
        reasons: [
          'Unusually large progression increment compared with historical shift baseline.',
          'Daily progress velocity is well above the learned baseline distribution.'
        ]
      };

      const adapted = toAnomalyMessageInput(phase1Prediction, {
        projectName: 'Refinery Construction Unit 4',
        activityExternalId: 'ACT-PIPE-02',
        activityName: 'Cooling Water Underground Piping',
        activityLocation: 'Area B',
        reportDate: '2026-08-16',
        reporterName: 'Rajesh Kumar',
        previousPercent: 41,
        reportedPercent: 82,
        activityMatchId: 'match-pipe-02'
      });

      expect(adapted).not.toBeNull();
      expect(adapted!.projectName).toBe('Refinery Construction Unit 4');
      expect(adapted!.activityExternalId).toBe('ACT-PIPE-02');
      expect(adapted!.reportedPercent).toBe(82);
      expect(adapted!.previousPercent).toBe(41);
      expect(adapted!.anomalyScore).toBe(0.91);
      expect(adapted!.anomalySeverity).toBe('high');
      expect(adapted!.anomalyReasons).toEqual(phase1Prediction.reasons);
      expect(adapted!.activityMatchId).toBe('match-pipe-02');
    });

    it('toAnomalyMessageInput returns null for normal observations (safe boundary)', () => {
      const normalPrediction: AnomalyPrediction = {
        anomalyScore: 0.05,
        severity: 'normal',
        reviewRecommended: false,
        reasons: []
      };

      expect(isEligibleForAnomalyAlert(normalPrediction)).toBe(false);
      expect(
        toAnomalyMessageInput(normalPrediction, {
          projectName: 'Refinery',
          activityExternalId: 'ACT-01',
          activityName: 'Piping',
          reportDate: '2026-08-16',
          reportedPercent: 45
        })
      ).toBeNull();
    });

    it('toAnomalyMessageInput returns null for cold-start observations (score 0.0)', () => {
      const coldStartPrediction: AnomalyPrediction = {
        anomalyScore: 0.0,
        severity: 'normal',
        reviewRecommended: false,
        reasons: []
      };

      expect(isEligibleForAnomalyAlert(coldStartPrediction)).toBe(false);
      expect(
        toAnomalyMessageInput(coldStartPrediction, {
          projectName: 'Refinery',
          activityExternalId: 'ACT-01',
          activityName: 'Piping',
          reportDate: '2026-08-16',
          reportedPercent: 20
        })
      ).toBeNull();
    });
  });

  describe('2. Server-Owned Facts & Correlation Preservation', () => {
    it('preserves all server-owned metadata and correlation IDs through AI generation', async () => {
      const result = await generator.generateAnomalyMessage(validHighInput);

      expect(result.activityMatchId).toBe('match-act-pipe-02-uuid');
      expect(result.projectName).toBe('Refinery Construction Unit 4');
      expect(result.activityExternalId).toBe('ACT-PIPE-02');
      expect(result.activityName).toBe('Cooling Water Underground Piping');
      expect(result.activityLocation).toBe('Area B — Utility Trench');
      expect(result.reportDate).toBe('2026-08-16');
      expect(result.reporterName).toBe('Rajesh Kumar');
      expect(result.previousPercent).toBe(41);
      expect(result.reportedPercent).toBe(82);
      expect(result.severity).toBe('high');
      expect(result.anomalyScore).toBe(0.91);
      expect(result.anomalyReasons).toEqual(validHighInput.anomalyReasons);
      expect(result.generatedBy).toBe('groq');
      expect(result.generatedAt).toBeDefined();
    });

    it('preserves all server-owned metadata through deterministic fallback', () => {
      const fallback = generateDeterministicFallbackMessage(validHighInput, 'Simulated failure');

      expect(fallback.activityMatchId).toBe('match-act-pipe-02-uuid');
      expect(fallback.projectName).toBe('Refinery Construction Unit 4');
      expect(fallback.activityExternalId).toBe('ACT-PIPE-02');
      expect(fallback.activityName).toBe('Cooling Water Underground Piping');
      expect(fallback.activityLocation).toBe('Area B — Utility Trench');
      expect(fallback.reportDate).toBe('2026-08-16');
      expect(fallback.reporterName).toBe('Rajesh Kumar');
      expect(fallback.previousPercent).toBe(41);
      expect(fallback.reportedPercent).toBe(82);
      expect(fallback.severity).toBe('high');
      expect(fallback.anomalyScore).toBe(0.91);
      expect(fallback.generatedBy).toBe('deterministic_fallback');
      expect(fallback.fallbackReason).toBe('Simulated failure');
    });
  });

  describe('3. Case A — High Anomaly Behavioral Invariants', () => {
    it('generates urgent, professional language with physical verification recommendation and no accusations', async () => {
      const result = await generator.generateAnomalyMessage(validHighInput);

      expect(result.severity).toBe('high');
      expect(result.title).toContain('HIGH');
      expect(result.recommendedAction.toLowerCase()).toContain('inspection');
      expect(result.fullMessage).not.toMatch(/fraud|fake|lying|dishonest|negligent|fabricated/i);

      const parsed = anomalyAlertPayloadSchema.safeParse(result);
      expect(parsed.success).toBe(true);
    });
  });

  describe('4. Case B — Review Anomaly Behavioral Invariants', () => {
    it('communicates elevated review urgency without falsely escalating to high severity', async () => {
      const result = await generator.generateAnomalyMessage(validReviewInput);

      expect(result.severity).toBe('review');
      expect(result.title).toContain('REVIEW');
      expect(result.title).not.toContain('HIGH');
      expect(result.summary).toContain('supervisor review');
      expect(result.recommendedAction.toLowerCase()).toContain('review');
    });
  });

  describe('5. Case C — Exact Match + High Anomaly Independence', () => {
    it('treats activity identity as trusted and focuses strictly on progression anomaly', () => {
      const prompt = buildAnomalyMessagePrompt(validHighInput);

      expect(prompt).toContain('ACTIVITY IDENTITY IS INDEPENDENT & TRUSTED: The activity match is verified and confirmed');
      expect(prompt).toContain('Do NOT question whether the activity is correct or suggest re-identifying the activity');
    });
  });

  describe('6. Case D — Cold Start & Normal Rejection', () => {
    it('rejects normal severity with ValidationError', async () => {
      const normalInput: any = {
        ...validHighInput,
        anomalySeverity: 'normal',
        anomalyScore: 0.1
      };

      await expect(generator.generateAnomalyMessage(normalInput)).rejects.toThrow(ValidationError);
      await expect(generator.generateAnomalyMessage(normalInput)).rejects.toThrow(
        /Cannot generate anomaly alert for normal or cold-start observation/
      );
    });

    it('rejects cold start (score 0.0) with ValidationError', async () => {
      const coldStartInput: any = {
        ...validHighInput,
        anomalyScore: 0.0
      };

      await expect(generator.generateAnomalyMessage(coldStartInput)).rejects.toThrow(ValidationError);
    });
  });

  describe('7. Case E — Groq Outage & Fallback Invariants', () => {
    it('falls back safely into deterministic alert when AI provider throws HTTP 429 / 503', async () => {
      mockProvider.setFailure(true, new Error('Groq 503 Service Unavailable: Cluster overloaded'));

      const result = await generator.generateAnomalyMessage(validHighInput);

      expect(result.generatedBy).toBe('deterministic_fallback');
      expect(result.fallbackReason).toContain('Groq 503');
      expect(result.severity).toBe('high');
      expect(result.anomalyScore).toBe(0.91);
      expect(result.title).toContain('[FieldLine Alert] HIGH: Cooling Water Underground Piping');
      expect(result.details).toContain('Previous Canonical Progress: 41%');
      expect(result.details).toContain('Reported Progress: 82%');
      expect(result.details).toContain('Progress shifted from 41% to 82% (net increment: 41%)');

      const parsed = anomalyAlertPayloadSchema.safeParse(result);
      expect(parsed.success).toBe(true);
    });
  });

  describe('8. Case F — Missing Previous Progress (No False Increments)', () => {
    it('does not state or imply an increase when previousPercent is absent', () => {
      const noPrevInput: GenerateAnomalyMessageInput = {
        ...validHighInput,
        previousPercent: null,
        reportedPercent: 82
      };

      const prompt = buildAnomalyMessagePrompt(noPrevInput);
      expect(prompt).toContain('None recorded (initial canonical observation; do NOT state or imply an increase from a prior percentage)');

      const fallback = generateDeterministicFallbackMessage(noPrevInput);
      expect(fallback.details).toContain('Previous Canonical Progress: None recorded (baseline pace evaluation)');
      expect(fallback.details).toContain('Initial recorded progress observation of 82% (no prior canonical progress recorded)');
      expect(fallback.details).not.toContain('Progress shifted from');
      expect(fallback.details).not.toContain('increased from');
    });
  });

  describe('9. Case G — Missing Optional Metadata (Reporter & Location)', () => {
    it('omits absent reporter and location cleanly without fabricating placeholders', () => {
      const sparseInput: GenerateAnomalyMessageInput = {
        ...validHighInput,
        activityLocation: null,
        reporterName: null,
        activityMatchId: null
      };

      const prompt = buildAnomalyMessagePrompt(sparseInput);
      expect(prompt).toContain('Activity Location: Unspecified (do not invent a location)');
      expect(prompt).toContain('Reported By: Unspecified (do not invent a reporter)');

      const fallback = generateDeterministicFallbackMessage(sparseInput);
      expect(fallback.details).not.toContain('Location:');
      expect(fallback.details).not.toContain('Reported By:');
      expect(fallback.summary).not.toContain('at null');
      expect(fallback.summary).not.toContain('by null');
    });
  });

  describe('10. Case H — Hallucination Resistance', () => {
    it('prompt explicitly forbids fabricating weather, material shortages, CCTV, sensors, or causes', () => {
      const prompt = buildAnomalyMessagePrompt(validHighInput);

      expect(prompt).toContain('STRICT GROUNDING: Use ONLY the supplied facts');
      expect(prompt).toContain('NEVER assume or hallucinate unprovided context (e.g. weather conditions, equipment breakdowns, material supply delays, worker conversations, site photos, or CCTV footage)');
    });
  });

  describe('11. Case I — Semantic Integrity of Anomaly Score', () => {
    it('prompt and fallback strictly explain anomaly score as statistical deviation from baseline rather than fraud probability', () => {
      const prompt = buildAnomalyMessagePrompt(validHighInput);

      expect(prompt).toContain('The anomaly score (e.g. 91% or 0.91) indicates the mathematical degree of statistical deviation');
      expect(prompt).toContain('It does NOT represent a probability of fraud, dishonesty, lying, theft, negligence, or report fabrication');
      expect(prompt).toContain('NEVER state or imply that there is a "probability of fraud" or "chance of false reporting"');

      const fallback = generateDeterministicFallbackMessage(validHighInput);
      expect(fallback.details).toContain('Statistical Anomaly Score: 91% deviation from learned baseline (HIGH)');
      expect(fallback.fullMessage).not.toContain('probability of fraud');
      expect(fallback.fullMessage).not.toContain('chance of error');
    });
  });

  describe('12. Malformed AI Output Handling', () => {
    it('falls back safely when AI provider returns malformed schema or invalid types', async () => {
      mockProvider.setMockStructuredResponse({
        title: 'Hi', // too short for schema
        summary: 'Short',
        details: 12345 // invalid type
      });

      const result = await generator.generateAnomalyMessage(validHighInput);

      expect(result.generatedBy).toBe('deterministic_fallback');
      expect(result.fallbackReason).toBeDefined();
      expect(result.title).toContain('[FieldLine Alert] HIGH: Cooling Water Underground Piping');
      expect(result.details).toContain('Reported Progress: 82%');
    });
  });
});
