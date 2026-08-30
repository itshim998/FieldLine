import dotenv from 'dotenv';
dotenv.config();
import { projectRepository } from '../backend/src/repositories/project.repository.js';
import { assistantService } from '../backend/src/services/assistant/assistant.service.js';
import { aiService } from '../backend/src/ai/services/ai.service.js';

interface TestCase {
  name: string;
  question: string;
  expectedIntent?: string;
  expectedStatus?: string;
  expectedGrounded?: boolean;
  check?: (res: any) => boolean | string;
}

async function runDeepEvaluation(): Promise<void> {
  console.log('================================================================');
  console.log('🔍 FieldLine Assistant Deep Regression & Robustness Evaluation');
  console.log('================================================================\n');

  console.log(`AI Provider configured: ${process.env.AI_PROVIDER}`);
  console.log(`Target Model: ${process.env.GROQ_MODEL || 'openai/gpt-oss-20b'}\n`);

  const projects = projectRepository.listAll();
  if (projects.length === 0) {
    console.error('❌ No projects found in database. Please run setup first.');
    process.exit(1);
  }

  const project = projects[0];
  const projectId = project.id;
  const asOfDate = '2026-08-30';
  console.log(`Testing with Project: "${project.name}" (${projectId}) as-of ${asOfDate}\n`);

  const testCases: TestCase[] = [
    {
      name: '1. Advisory / Open-ended (Unsupported Intent)',
      question: 'How to speed up the work?',
      expectedIntent: 'unsupported',
      expectedStatus: 'unsupported',
      expectedGrounded: false,
      check: (res) => {
        if (!res.answer || res.answer.length === 0) return 'Empty answer string';
        if (!res.answer.toLowerCase().includes('cannot be answered') && !res.answer.toLowerCase().includes('supported queries')) {
          return `Unexpected unsupported message: ${res.answer}`;
        }
        return true;
      }
    },
    {
      name: '2. Out-of-domain Question (Unsupported Intent)',
      question: 'What is the weather in New York today?',
      expectedIntent: 'unsupported',
      expectedStatus: 'unsupported',
      expectedGrounded: false
    },
    {
      name: '3. Delayed Activities Query',
      question: 'What is delayed?',
      expectedIntent: 'delayed',
      expectedStatus: 'success',
      expectedGrounded: true,
      check: (res) => {
        if (res.claims.length === 0) return 'No claims generated';
        if (res.factRefs.length === 0) return 'No facts cited';
        return true;
      }
    },
    {
      name: '4. At-Risk Activities Query',
      question: 'Which activities are at risk?',
      expectedIntent: 'at_risk',
      expectedStatus: 'success',
      expectedGrounded: true,
      check: (res) => {
        if (res.claims.length === 0) return 'No claims generated';
        return true;
      }
    },
    {
      name: '5. Specific Activity Risk Analysis',
      question: 'Why is PR-07 steel erection at risk?',
      expectedStatus: 'success',
      expectedGrounded: true,
      check: (res) => {
        if (!res.resolvedActivity) return 'Activity PR-07 was not resolved';
        if (res.claims.length === 0) return 'No claims generated';
        return true;
      }
    },
    {
      name: '6. Specific Activity Status Query',
      question: 'Tell me about the crude pump foundation',
      expectedIntent: 'activity_status',
      expectedStatus: 'success',
      expectedGrounded: true,
      check: (res) => {
        if (!res.resolvedActivity) return 'Crude pump foundation activity was not resolved';
        return true;
      }
    },
    {
      name: '7. Approaching Milestones Query',
      question: 'Which milestones are approaching?',
      expectedIntent: 'approaching_milestones',
      expectedStatus: 'success',
      expectedGrounded: true
    },
    {
      name: '8. Stale Activities Query',
      question: 'Which activities have no recent updates?',
      expectedIntent: 'stale_activities',
      expectedStatus: 'success',
      expectedGrounded: true
    },
    {
      name: '9. Recent Changes Query',
      question: 'What changed recently?',
      expectedIntent: 'recent_changes',
      expectedStatus: 'success',
      expectedGrounded: true
    },
    {
      name: '10. Ambiguous Entity Query',
      question: 'What is the status of foundation?',
      expectedStatus: 'ambiguous_activity',
      expectedGrounded: false,
      check: (res) => {
        if (!res.ambiguousCandidates || res.ambiguousCandidates.length < 2) {
          return 'Expected multiple ambiguous candidates';
        }
        return true;
      }
    },
    {
      name: '11. Non-existent Entity Query',
      question: 'What is the status of non_existent_super_structure_xyz?',
      expectedStatus: 'activity_not_found',
      expectedGrounded: false
    }
  ];

  let passed = 0;
  let failed = 0;

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    console.log(`[${i + 1}/${testCases.length}] Testing: "${tc.name}"`);
    console.log(`    Query: "${tc.question}"`);

    const startTime = Date.now();
    try {
      const result = await assistantService.answerQuestion(projectId, tc.question, { asOfDate });
      const elapsed = Date.now() - startTime;

      let errorMsg: string | null = null;

      if (tc.expectedIntent && result.intent.intent !== tc.expectedIntent) {
        errorMsg = `Intent mismatch: expected '${tc.expectedIntent}', got '${result.intent.intent}'`;
      } else if (tc.expectedStatus && result.status !== tc.expectedStatus) {
        errorMsg = `Status mismatch: expected '${tc.expectedStatus}', got '${result.status}'`;
      } else if (tc.expectedGrounded !== undefined && result.grounded !== tc.expectedGrounded) {
        errorMsg = `Grounded mismatch: expected ${tc.expectedGrounded}, got ${result.grounded}`;
      } else if (tc.check) {
        const customRes = tc.check(result);
        if (customRes !== true) {
          errorMsg = typeof customRes === 'string' ? customRes : 'Custom assertion failed';
        }
      }

      if (errorMsg) {
        console.error(`    ❌ FAILED in ${elapsed}ms: ${errorMsg}`);
        console.error(`       Response:`, JSON.stringify(result, null, 2).slice(0, 300));
        failed++;
      } else {
        console.log(`    ✅ PASSED in ${elapsed}ms (Intent: ${result.intent.intent}, Grounded: ${result.grounded}, Claims: ${result.claims?.length ?? 0})`);
        console.log(`       Answer: "${result.answer.slice(0, 100)}..."\n`);
        passed++;
      }

      // Small pacing pause between test requests to stay well within token-per-minute limits
      await new Promise((r) => setTimeout(r, 1500));
    } catch (err: any) {
      const elapsed = Date.now() - startTime;
      console.error(`    ❌ EXCEPTION in ${elapsed}ms: ${err.message}`);
      failed++;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  console.log('================================================================');
  console.log(`Deep Evaluation Summary: Total: ${testCases.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runDeepEvaluation().catch((err) => {
  console.error('Fatal evaluation failure:', err);
  process.exit(1);
});
