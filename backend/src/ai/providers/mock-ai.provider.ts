import { z } from 'zod';
import { AIProvider } from './ai-provider.interface.js';
import { AIRequestOptions } from '../contracts/ai.contract.js';

export class MockAIProvider implements AIProvider {
  public readonly name: string = 'mock-ai-provider';
  private mockTextResponse?: string;
  private mockStructuredResponse?: unknown;
  private shouldFail: boolean = false;
  private failureError?: Error;

  constructor(options?: {
    mockTextResponse?: string;
    mockStructuredResponse?: unknown;
    shouldFail?: boolean;
    failureError?: Error;
  }) {
    if (options) {
      this.mockTextResponse = options.mockTextResponse;
      this.mockStructuredResponse = options.mockStructuredResponse;
      this.shouldFail = options.shouldFail ?? false;
      this.failureError = options.failureError;
    }
  }

  setMockTextResponse(response: string): void {
    this.mockTextResponse = response;
  }

  setMockStructuredResponse(response: unknown): void {
    this.mockStructuredResponse = response;
  }

  setFailure(shouldFail: boolean, error?: Error): void {
    this.shouldFail = shouldFail;
    this.failureError = error;
  }

  async generateText(prompt: string, _options?: AIRequestOptions): Promise<string> {
    if (this.shouldFail) {
      throw this.failureError || new Error('Mock AI provider simulated failure');
    }

    return this.mockTextResponse || `Mock completion response for prompt: "${prompt.slice(0, 30)}..."`;
  }

  async generateStructured<T>(_prompt: string, _schema: z.ZodType<T>, _options?: AIRequestOptions): Promise<unknown> {
    if (this.shouldFail) {
      throw this.failureError || new Error('Mock AI provider simulated failure');
    }

    if (this.mockStructuredResponse !== undefined) {
      if (typeof this.mockStructuredResponse === 'function') {
        return (this.mockStructuredResponse as Function)(_prompt, _schema, _options);
      }
      return this.mockStructuredResponse;
    }

    // 1. Dynamic Assistant Intent parsing
    const defaultAssistantIntentPayload = {
      intent: 'delayed',
      activityQuery: null,
      explicitDate: null
    };

    if (_schema.safeParse(defaultAssistantIntentPayload).success) {
      const questionMatch = _prompt.match(/--- MANAGER QUESTION ---\r?\n([\s\S]*?)\r?\n--- END MANAGER QUESTION ---/);
      const questionText = questionMatch ? questionMatch[1].trim() : _prompt;
      const lowerQ = questionText.toLowerCase();

      let detectedIntent = 'delayed';
      let activityQuery: string | null = null;
      let explicitDate: string | null = null;

      const dateMatch = questionText.match(/\b(\d{4}-\d{2}-\d{2})\b/);
      if (dateMatch) {
        explicitDate = dateMatch[1];
      }

      if (lowerQ.includes('milestone')) {
        detectedIntent = 'approaching_milestones';
      } else if (lowerQ.includes('stale') || lowerQ.includes('no recent') || lowerQ.includes('no update')) {
        detectedIntent = 'stale_activities';
      } else if (lowerQ.includes('behind') || lowerQ.includes('variance') || lowerQ.includes('lagging')) {
        detectedIntent = 'behind_schedule';
      } else if (lowerQ.includes('completed today') || lowerQ.includes('finished today') || lowerQ.includes('completed on') || lowerQ.includes('what finished')) {
        detectedIntent = 'completed_today';
      } else if (lowerQ.includes('recent') || lowerQ.includes('what changed') || lowerQ.includes('event')) {
        detectedIntent = 'recent_changes';
      } else if (lowerQ.includes('at risk') || lowerQ.includes('at_risk') || lowerQ.includes('why is') || lowerQ.includes('risk')) {
        detectedIntent = 'at_risk';
      } else if (lowerQ.includes('delayed') || lowerQ.includes('overdue') || lowerQ.includes('late')) {
        detectedIntent = 'delayed';
      } else if (
        lowerQ.includes('tell me about') ||
        lowerQ.includes('status of') ||
        lowerQ.includes('how is') ||
        lowerQ.includes('status') ||
        lowerQ.includes('foundation') ||
        lowerQ.includes('tank') ||
        lowerQ.includes('pump') ||
        lowerQ.includes('pipe') ||
        lowerQ.includes('area')
      ) {
        detectedIntent = 'activity_status';
      }

      // Check if entity mention should be extracted for activity query
      const entityMatch = questionText.match(/(?:status of|about|how is|for)\s+([A-Za-z0-9\s\-]+?)(?:\?|\.|$)/i);
      if (entityMatch && entityMatch[1].trim()) {
        let candidate = entityMatch[1].trim().replace(/^(?:the|a|an)\s+/i, '').trim();
        if (!['what', 'which', 'project', 'schedule'].includes(candidate.toLowerCase())) {
          activityQuery = candidate;
        }
      } else if (lowerQ.includes('tank foundation') || lowerQ.includes('tank')) {
        activityQuery = 'tank';
      } else if (lowerQ.includes('crude pump') || lowerQ.includes('pump')) {
        activityQuery = 'crude pump';
      } else if (lowerQ.includes('area b')) {
        activityQuery = 'Area B';
      } else if (lowerQ.includes('pipe rack')) {
        activityQuery = 'Pipe Rack PR-07';
      }

      return {
        intent: detectedIntent,
        activityQuery,
        explicitDate
      };
    }

    // 2. Dynamic Assistant Grounded Answer parsing from Verified Facts
    const testAssistantPayload = {
      claims: [
        {
          type: 'metric',
          factRef: 'test-ref',
          field: 'actualProgress',
          value: 60,
          text: 'Test claim'
        }
      ]
    };

    if (_schema.safeParse(testAssistantPayload).success) {
      const factBlockMatch = _prompt.match(/--- VERIFIED FACTS ---\r?\n([\s\S]*?)\r?\n--- END VERIFIED FACTS ---/);
      const claims: Array<{
        type: string;
        factRef: string;
        field: string;
        value: unknown;
        text: string;
      }> = [];

      if (factBlockMatch) {
        const factText = factBlockMatch[1];
        const factRegex = /\[FACT\s+\d+\]\s+\(Ref:\s*([^\)]+)\)\r?\n([\s\S]*?)(?=\[FACT|\s*$)/g;
        let match: RegExpExecArray | null;

        while ((match = factRegex.exec(factText)) !== null) {
          const ref = match[1].trim();
          const summary = match[2].trim();

          const progressMatch =
            summary.match(/actual\s+progress\s*(?:is|of|has reached|:)?\s*(\d+(?:\.\d+)?)%/i) ||
            summary.match(/(\d+(?:\.\d+)?)%\s+actual\s+progress/i) ||
            summary.match(/progress:\s*(\d+(?:\.\d+)?)%/i);
          const varianceMatch = summary.match(/progress\s+variance\s+(?:of|is|:)\s+(-?\d+(?:\.\d+)?)%/i);
          const milestoneDateMatch = summary.match(/approaching\s+on\s+(\d{4}-\d{2}-\d{2})/i);
          const nameMatch = summary.match(/Activity\s+"([^"]+)"/i) || summary.match(/Milestone\s+"([^"]+)"/i);

          if (ref.startsWith('delayed:')) {
            const actualVal = progressMatch ? Number(progressMatch[1]) : 40;
            claims.push({
              type: 'metric',
              factRef: ref,
              field: 'actualProgress',
              value: actualVal,
              text: `${nameMatch ? nameMatch[1] : 'Activity'} (${ref.replace('delayed:', '')}) is delayed at ${actualVal}% actual progress.`
            });
          } else if (ref.startsWith('at_risk:')) {
            const actualVal = progressMatch ? Number(progressMatch[1]) : 50;
            claims.push({
              type: 'metric',
              factRef: ref,
              field: 'actualProgress',
              value: actualVal,
              text: `${nameMatch ? nameMatch[1] : 'Activity'} (${ref.replace('at_risk:', '')}) is at risk with ${actualVal}% actual progress.`
            });
          } else if (ref.startsWith('behind_schedule:')) {
            const varianceVal = varianceMatch ? Number(varianceMatch[1]) : -20;
            claims.push({
              type: 'variance',
              factRef: ref,
              field: 'progressVariance',
              value: varianceVal,
              text: `${nameMatch ? nameMatch[1] : 'Activity'} is behind schedule with variance ${varianceVal}%.`
            });
          } else if (ref.startsWith('completed:')) {
            const actualVal = progressMatch ? Number(progressMatch[1]) : 100;
            claims.push({
              type: 'metric',
              factRef: ref,
              field: 'actualPercent',
              value: actualVal,
              text: `${nameMatch ? nameMatch[1] : 'Activity'} completed with ${actualVal}% progress.`
            });
          } else if (ref.startsWith('milestone:')) {
            const mDate = milestoneDateMatch ? milestoneDateMatch[1] : '2026-08-30';
            claims.push({
              type: 'date',
              factRef: ref,
              field: 'milestoneDate',
              value: mDate,
              text: `${nameMatch ? nameMatch[1] : 'Milestone'} is approaching on ${mDate}.`
            });
          } else if (ref.startsWith('stale:')) {
            const nameVal = nameMatch ? nameMatch[1] : ref.replace('stale:', '');
            claims.push({
              type: 'activity_identity',
              factRef: ref,
              field: 'name',
              value: nameVal,
              text: `Activity "${nameVal}" has no recent progress updates.`
            });
          } else if (ref.startsWith('activity_status:')) {
            const actualVal = progressMatch ? Number(progressMatch[1]) : 65;
            claims.push({
              type: 'metric',
              factRef: ref,
              field: 'actualProgress',
              value: actualVal,
              text: `${nameMatch ? nameMatch[1] : 'Activity'} is currently at ${actualVal}% actual progress.`
            });
          } else if (ref.startsWith('event:')) {
            claims.push({
              type: 'reason',
              factRef: ref,
              field: 'eventType',
              value: 'progress_recorded',
              text: summary
            });
          }
        }
      }

      if (claims.length === 0) {
        claims.push({
          type: 'metric',
          factRef: 'mock-ref',
          field: 'actualProgress',
          value: 60,
          text: 'Mock grounded assistant answer.'
        });
      }

      const answerText = claims.map((c) => c.text).join(' ');
      return {
        answer: answerText,
        claims
      };
    }

    // 3. Dynamic Field Progress Extraction
    const defaultFieldProgressPayload = {
      items: [
        {
          reference: 'foundation work',
          location: 'Block B',
          progress_percent: 60,
          status: 'in_progress'
        }
      ]
    };

    if (_schema.safeParse(defaultFieldProgressPayload).success) {
      // Check if raw field report has items
      const rawReportMatch = _prompt.match(/--- RAW FIELD REPORT ---\r?\n([\s\S]*?)\r?\n--- END RAW FIELD REPORT ---/);
      if (rawReportMatch) {
        const rawText = rawReportMatch[1];
        const items: Array<{
          reference: string;
          location: string | null;
          progress_percent: number | null;
          status: 'unknown' | 'not_started' | 'in_progress' | 'completed' | 'delayed';
        }> = [];

        const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        for (const line of lines) {
          const itemMatch = line.match(/^(?:\d+[\.\)]|\-|\*)\s*(.+)$/);
          const content = itemMatch ? itemMatch[1].trim() : line;

          const pctMatch = content.match(/(\d+(?:\.\d+)?)%/);
          const percent = pctMatch ? Number(pctMatch[1]) : null;

          let status: 'unknown' | 'not_started' | 'in_progress' | 'completed' | 'delayed' = 'in_progress';
          if (percent === 100 || content.toLowerCase().includes('completed') || content.toLowerCase().includes('finished')) {
            status = 'completed';
          } else if (content.toLowerCase().includes('delayed') || content.toLowerCase().includes('overdue')) {
            status = 'delayed';
          } else if (percent === 0 || content.toLowerCase().includes('not started')) {
            status = 'not_started';
          }

          let location: string | null = null;
          const locMatch = content.match(/\b(Area\s+[A-Z]|Sector\s+\d+|Zone\s+[A-Z]|Block\s+[A-Z0-9]+|Pier\s+\d+|Main Site)\b/i);
          if (locMatch) {
            location = locMatch[1];
          }

          // Clean reference
          let ref = content
            .replace(/\s+at\s+(Area\s+[A-Z]|Sector\s+\d+|Zone\s+[A-Z]|Block\s+[A-Z0-9]+|Pier\s+\d+)/gi, '')
            .replace(/\s+is\s+\d+%.*$/i, '')
            .replace(/:\s*\d+%.*$/i, '')
            .replace(/\s+has reached\s+\d+%.*$/i, '')
            .replace(/\s+progressing at\s+\d+%.*$/i, '')
            .replace(/\s+roughly\s+\d+%.*$/i, '')
            .trim();

          if (ref.length > 2) {
            items.push({
              reference: ref.slice(0, 100),
              location,
              progress_percent: percent,
              status
            });
          }
        }

        if (items.length > 0) {
          return { items: items.slice(0, 20) };
        }
      }

      return defaultFieldProgressPayload;
    }

    // Default valid generic mock extraction contract
    return {
      summary: 'Mock extracted summary of field progress',
      confidenceScore: 0.95,
      entities: [
        { name: 'foundation_concrete', value: '75%', confidence: 0.92 }
      ],
      notes: 'Generated by deterministic MockAIProvider'
    };
  }
}
