import { execSync } from 'node:child_process';
import { z } from 'zod';
import { GroqKeyRouter } from '../backend/src/ai/providers/groq-key-router.js';
import { GeminiKeyRouter } from '../backend/src/ai/providers/gemini-key-router.js';
import { MockAIProvider } from '../backend/src/ai/providers/mock-ai.provider.js';

interface BaselineStep {
  name: string;
  action: () => void | Promise<void>;
  description: string;
}

function runShellCommand(command: string): void {
  execSync(command, {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'test' }
  });
}

async function runAIRouterDiagnostics(): Promise<void> {
  console.log('--- Checking MockAIProvider Diagnostics ---');
  const mockProvider = new MockAIProvider();
  const testText = await mockProvider.generateText('Inspection report for Bridge Pier 3 footings');
  if (!testText || typeof testText !== 'string') {
    throw new Error('MockAIProvider failed to return valid text response');
  }

  const dummySchema = z.object({
    intent: z.string().optional(),
    activities: z.array(z.any()).optional()
  });
  const mockStructured = await mockProvider.generateStructured('Inspection report for Bridge Pier 3 footings', dummySchema);
  if (!mockStructured || typeof mockStructured !== 'object') {
    throw new Error('MockAIProvider failed to return valid structured data');
  }
  console.log('✅ MockAIProvider generated valid text and structured responses.');

  console.log('--- Checking GroqKeyRouter Diagnostics ---');
  const sampleGroqKeys = Array.from({ length: 20 }, (_, i) => `gsk_mock_test_key_${String(i + 1).padStart(2, '0')}`);
  const groqRouter = new GroqKeyRouter({ apiKeys: sampleGroqKeys });
  if (groqRouter.keyCount !== 20) {
    throw new Error(`Expected 20 Groq key slots, found ${groqRouter.keyCount}`);
  }
  if (groqRouter.getCurrentSlot() !== '01') {
    throw new Error(`Expected initial Groq slot '01', found ${groqRouter.getCurrentSlot()}`);
  }
  const groqSnapshots = groqRouter.getKeyHealthSnapshots();
  if (groqSnapshots.length !== 20 || (groqSnapshots[0] as any).apiKey !== undefined) {
    throw new Error('GroqKeyRouter health snapshots leaked sensitive key or incorrect length');
  }
  console.log(`✅ GroqKeyRouter initialized 20 slots cleanly with sanitized health snapshots.`);

  console.log('--- Checking GeminiKeyRouter Diagnostics ---');
  const sampleGeminiKeys = Array.from({ length: 5 }, (_, i) => `gemini_mock_key_${i + 1}`);
  const geminiRouter = new GeminiKeyRouter({ apiKeys: sampleGeminiKeys });
  if (geminiRouter.keyCount !== 5) {
    throw new Error(`Expected 5 Gemini key slots, found ${geminiRouter.keyCount}`);
  }
  const geminiSnapshots = geminiRouter.getKeyHealthSnapshots();
  if (geminiSnapshots.length !== 5) {
    throw new Error('GeminiKeyRouter diagnostics failed snapshot verification');
  }
  console.log(`✅ GeminiKeyRouter initialized 5 slots cleanly with sanitized health snapshots.`);
}

const steps: BaselineStep[] = [
  {
    name: '1. Production Build Compilation',
    description: 'Compile backend TypeScript (tsconfig.backend.json) and package frontend bundle via Vite',
    action: () => runShellCommand('npm run build')
  },
  {
    name: '2. Local Database Idempotent Setup',
    description: 'Verify local SQLite database setup and migration idempotency',
    action: () => runShellCommand('npm run setup')
  },
  {
    name: '3. Golden Demo Reset & Invariant Verification',
    description: 'Reset golden demo dataset and verify 53 machine-checkable invariants',
    action: () => {
      runShellCommand('npm run demo:reset');
      runShellCommand('npm run demo:verify');
    }
  },
  {
    name: '4. AI Router & Provider Diagnostics',
    description: 'Validate Mock, Groq, and Gemini multi-slot router diagnostics and key redaction',
    action: async () => await runAIRouterDiagnostics()
  },
  {
    name: '5. Baseline Route Contract Freeze Checkpoint',
    description: 'Execute vitest against frozen unauthenticated API route and DTO contracts',
    action: () => runShellCommand('npx vitest run backend/tests/baseline_contract_freeze.test.ts')
  },
  {
    name: '6. Full Regression Test Suite',
    description: 'Execute complete 102-file test suite to guarantee 100% pass rate and zero regressions',
    action: () => runShellCommand('npm test')
  }
];

async function runBaselineVerification(): Promise<void> {
  const startTime = Date.now();
  console.log('================================================================');
  console.log('🛡️  FieldLine Baseline Contract Freeze Verification (Pass 27)');
  console.log('Asserting Build + Schema + Demo Invariants + AI Routers + Test Suite');
  console.log('================================================================\n');

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepStart = Date.now();
    console.log(`[Step ${i + 1}/${steps.length}] ${step.name}`);
    console.log(`Purpose: ${step.description}`);
    console.log('----------------------------------------------------------------');

    try {
      await step.action();
      const stepDuration = ((Date.now() - stepStart) / 1000).toFixed(1);
      console.log(`\n✅ Step ${i + 1} PASSED (${stepDuration}s)\n`);
    } catch (err: unknown) {
      console.error(`\n❌ Step ${i + 1} FAILED: ${step.name}`);
      console.error(err);
      process.exit(1);
    }
  }

  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('================================================================');
  console.log('🎉 PASS 27 BASELINE VERIFICATION COMPLETED SUCCESSFULLY!');
  console.log(`Total Execution Time: ${totalDuration}s`);
  console.log('The FieldLine baseline is frozen, machine-verified, and ready for Pass 28.');
  console.log('================================================================');
}

runBaselineVerification().catch((err) => {
  console.error('❌ Baseline verification runner crashed:', err);
  process.exit(1);
});
