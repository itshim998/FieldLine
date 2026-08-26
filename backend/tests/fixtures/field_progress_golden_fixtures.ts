import { FieldProgressExtraction } from '../../src/ai/contracts/field-progress-extraction.contract.js';

export interface GoldenExtractionFixture {
  name: string;
  description: string;
  rawText: string;
  expectedExtraction: FieldProgressExtraction;
}

export const goldenExtractionFixtures: Record<string, GoldenExtractionFixture> = {
  caseA_explicitPercentage: {
    name: 'Case A — Explicit percentage',
    description: 'Report explicitly mentions 60% completion for foundation work at Block B',
    rawText: 'Foundation work at Block B is 60% complete.\nConcrete pouring started today.',
    expectedExtraction: {
      items: [
        {
          reference: 'Foundation work',
          location: 'Block B',
          progress_percent: 60,
          status: 'in_progress'
        }
      ]
    }
  },

  caseB_noPercentage: {
    name: 'Case B — No percentage',
    description: 'Work started without numeric progress; progress_percent must be null',
    rawText: 'Excavation work started at Pier P12 today.',
    expectedExtraction: {
      items: [
        {
          reference: 'Excavation work',
          location: 'Pier P12',
          progress_percent: null,
          status: 'in_progress'
        }
      ]
    }
  },

  caseC_ambiguousProgress: {
    name: 'Case C — Ambiguous progress',
    description: 'Vague progress phrasing ("moving well") must not fabricate numeric percentage',
    rawText: 'Work is moving well at Block C.',
    expectedExtraction: {
      items: [
        {
          reference: 'Work',
          location: 'Block C',
          progress_percent: null,
          status: 'in_progress'
        }
      ]
    }
  },

  caseD_completedWork: {
    name: 'Case D — Completed work',
    description: 'Completion statement sets status to completed without inventing numeric percentage',
    rawText: 'Rebar installation at Column C14 has been completed.',
    expectedExtraction: {
      items: [
        {
          reference: 'Rebar installation',
          location: 'Column C14',
          progress_percent: null,
          status: 'completed'
        }
      ]
    }
  }
};
