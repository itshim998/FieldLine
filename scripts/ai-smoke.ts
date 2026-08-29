import dotenv from 'dotenv';
import { z } from 'zod';
import { GroqAIProvider } from '../backend/src/ai/providers/groq-ai.provider.js';
import { DefaultAIService } from '../backend/src/ai/services/ai.service.js';
import { extractGroqApiKeys } from '../backend/src/config/env.js';

dotenv.config();

const smokeTestSchema = z.object({
  status: z.enum(['completed', 'in_progress', 'delayed', 'verified']),
  summary: z.string().min(1),
  confidenceScore: z.number().min(0).max(1),
  metrics: z.object({
    quantityPoured: z.string().optional(),
    location: z.string().optional()
  }).optional()
});

async function runGroqSmokeTest(): Promise<void> {
  console.log('================================================================');
  console.log('⚡ FieldLine Real-Groq Provider Smoke Test (Pass 26)');
  console.log('================================================================\n');

  const { keys, malformed } = extractGroqApiKeys(process.env as Record<string, string | undefined>);
  const model = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';

  if (malformed.length > 0) {
    console.error(`❌ Malformed/empty Groq key configuration detected: ${malformed.join(', ')}`);
    process.exit(1);
  }

  if (keys.length === 0) {
    console.error('❌ No Groq API keys configured.');
    console.error('Please configure at least GROQ_API_KEY_01 in your .env file:');
    console.error('  AI_PROVIDER=groq');
    console.error('  GROQ_MODEL=openai/gpt-oss-20b');
    console.error('  GROQ_API_KEY_01=gsk_...\n');
    process.exit(1);
  }

  console.log(`📡 Provider: Groq (OpenAI-Compatible Endpoint)`);
  console.log(`🤖 Target Model: ${model}`);
  console.log(`🔑 Configured Key Slots: ${keys.length} slot(s) loaded sequentially`);
  console.log(`🛡️  Security Policy: API keys redacted; diagnostics show slot index only\n`);

  const provider = new GroqAIProvider({
    apiKeys: keys,
    defaultModel: model
  });

  const aiService = new DefaultAIService(provider);
  const router = provider.getRouter();

  console.log(`[1/2] Sending Structured Test Extraction Request...`);
  console.log(`Initial Active Slot: Slot ${router.getCurrentSlot()}`);

  const testPrompt = `
Extract structured progress information from the following site inspection log:
"Concrete pour completed for Bridge Pier 3 footings. Total volume placed: 480 m3. Slump and cube compression tests verified. Overall milestone status: completed with 0.97 confidence."

Respond with a JSON object matching this schema:
{
  "status": "completed" | "in_progress" | "delayed" | "verified",
  "summary": string,
  "confidenceScore": number (0.0 to 1.0),
  "metrics": {
    "quantityPoured": string,
    "location": string
  }
}
`;

  const startTime = Date.now();

  try {
    const result = await aiService.extractStructured(testPrompt, smokeTestSchema);
    const durationMs = Date.now() - startTime;

    console.log(`\n✅ Groq Structured Extraction Succeeded in ${durationMs}ms!`);
    console.log(`----------------------------------------------------------------`);
    console.log(`Key Slot Used:     Slot ${router.getCurrentSlot()}`);
    console.log(`Status:            ${result.status}`);
    console.log(`Summary:           ${result.summary}`);
    console.log(`Confidence Score:  ${result.confidenceScore}`);
    if (result.metrics) {
      console.log(`Quantity Poured:   ${result.metrics.quantityPoured ?? 'N/A'}`);
      console.log(`Location:          ${result.metrics.location ?? 'N/A'}`);
    }
    console.log(`----------------------------------------------------------------`);

    console.log(`\n[2/2] Inspecting Router Health State...`);
    const snapshots = router.getKeyHealthSnapshots();
    snapshots.forEach((snap) => {
      console.log(
        `  Slot ${snap.slot}: ${snap.isAvailable ? '🟢 Healthy' : '🔴 Unhealthy'} | Success: ${snap.successCount} | Failures: ${snap.failureCount}`
      );
    });

    console.log('\n================================================================');
    console.log('🎉 REAL-GROQ SMOKE TEST COMPLETED SUCCESSFULLY');
    console.log('Groq openai/gpt-oss-20b is operating reliably with key failover router.');
    console.log('================================================================');
    process.exit(0);
  } catch (err: unknown) {
    const durationMs = Date.now() - startTime;
    console.error(`\n❌ Groq Smoke Test Failed after ${durationMs}ms`);
    console.error(err instanceof Error ? err.message : String(err));

    console.log('\nRouter Key Health Diagnostics:');
    const snapshots = router.getKeyHealthSnapshots();
    snapshots.forEach((snap) => {
      console.log(
        `  Slot ${snap.slot}: ${snap.isAvailable ? '🟢 Available' : '🔴 Unavailable'} | Failures: ${snap.failureCount} | Last Status: ${snap.lastErrorStatus ?? 'N/A'}`
      );
    });

    process.exit(1);
  }
}

runGroqSmokeTest();
