import { describe, it, expect } from 'vitest';
import { goldenExtractionFixtures } from './fixtures/field_progress_golden_fixtures.js';
import { FieldProgressExtractionService } from '../src/ai/services/field-progress-extraction.service.js';
import { DefaultAIService } from '../src/ai/services/ai.service.js';
import { MockAIProvider } from '../src/ai/providers/mock-ai.provider.js';
import { fieldProgressExtractionSchema } from '../src/ai/contracts/field-progress-extraction.contract.js';

describe('FieldProgress Golden Extraction Fixtures', () => {
  it('Case A — explicit percentage: extracts percentage without inventing activity IDs', async () => {
    const fixture = goldenExtractionFixtures.caseA_explicitPercentage;
    const mockProvider = new MockAIProvider({
      mockStructuredResponse: fixture.expectedExtraction
    });
    const service = new FieldProgressExtractionService(new DefaultAIService(mockProvider));

    const result = await service.extractFromReport(fixture.rawText);

    // Validate against contract
    expect(fieldProgressExtractionSchema.safeParse(result).success).toBe(true);

    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    expect(item.reference.toLowerCase()).toContain('foundation');
    expect(item.location).toBe('Block B');
    expect(item.progress_percent).toBe(60);
    expect(item.status).toBe('in_progress');
    // Ensure no activity ID was created
    expect(item.reference).not.toMatch(/^ACT-\d+/i);
    expect(item.reference).not.toMatch(/^WBS-/i);
  });

  it('Case B — no percentage: preserves null progress_percent when no number is given', async () => {
    const fixture = goldenExtractionFixtures.caseB_noPercentage;
    const mockProvider = new MockAIProvider({
      mockStructuredResponse: fixture.expectedExtraction
    });
    const service = new FieldProgressExtractionService(new DefaultAIService(mockProvider));

    const result = await service.extractFromReport(fixture.rawText);

    expect(fieldProgressExtractionSchema.safeParse(result).success).toBe(true);
    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    expect(item.reference.toLowerCase()).toContain('excavation');
    expect(item.location).toBe('Pier P12');
    expect(item.progress_percent).toBeNull();
    expect(item.status).toBe('in_progress');
  });

  it('Case C — ambiguous progress: does NOT fabricate percentage from subjective phrases', async () => {
    const fixture = goldenExtractionFixtures.caseC_ambiguousProgress;
    const mockProvider = new MockAIProvider({
      mockStructuredResponse: fixture.expectedExtraction
    });
    const service = new FieldProgressExtractionService(new DefaultAIService(mockProvider));

    const result = await service.extractFromReport(fixture.rawText);

    expect(fieldProgressExtractionSchema.safeParse(result).success).toBe(true);
    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    expect(item.location).toBe('Block C');
    // Critical: Must NOT fabricate a number like 70% or 50% from "moving well"
    expect(item.progress_percent).toBeNull();
  });

  it('Case D — completed work: infers completed status without fabricating progress percentage', async () => {
    const fixture = goldenExtractionFixtures.caseD_completedWork;
    const mockProvider = new MockAIProvider({
      mockStructuredResponse: fixture.expectedExtraction
    });
    const service = new FieldProgressExtractionService(new DefaultAIService(mockProvider));

    const result = await service.extractFromReport(fixture.rawText);

    expect(fieldProgressExtractionSchema.safeParse(result).success).toBe(true);
    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    expect(item.reference.toLowerCase()).toContain('rebar');
    expect(item.location).toBe('Column C14');
    expect(item.status).toBe('completed');
    expect(item.progress_percent).toBeNull();
  });
});
