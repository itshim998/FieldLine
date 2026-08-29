import { execSync } from 'node:child_process';

interface Step {
  name: string;
  command: string;
  description: string;
}

const steps: Step[] = [
  {
    name: '1. Production Build',
    command: 'npm run build',
    description: 'Compile backend TypeScript and package frontend bundle via Vite'
  },
  {
    name: '2. Complete Vitest Suite',
    command: 'npm test',
    description: 'Execute full 93-file regression & evaluation test suite'
  },
  {
    name: '3. Golden Demo Environment Reset',
    command: 'npm run demo:reset',
    description: 'Clean database & uploads, run migrations, and seed golden dataset'
  },
  {
    name: '4. Golden Demo Invariant Verification',
    command: 'npm run demo:verify',
    description: 'Verify 53 machine-checkable demo invariants across all subsystems'
  }
];

async function runReleaseVerification(): Promise<void> {
  const startTime = Date.now();
  console.log('================================================================');
  console.log('🚀 FieldLine Release Verification Suite (Pass 26)');
  console.log('Orchestrating Build + Test + Demo Reset + Demo Verification');
  console.log('================================================================\n');

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepStart = Date.now();
    console.log(`[Step ${i + 1}/${steps.length}] ${step.name}`);
    console.log(`Command: ${step.command}`);
    console.log(`Purpose: ${step.description}`);
    console.log('----------------------------------------------------------------');

    try {
      execSync(step.command, {
        stdio: 'inherit',
        env: { ...process.env, NODE_ENV: 'test' }
      });
      const stepDuration = ((Date.now() - stepStart) / 1000).toFixed(1);
      console.log(`\n✅ Step ${i + 1} PASSED (${stepDuration}s)\n`);
    } catch (err: unknown) {
      console.error(`\n❌ Step ${i + 1} FAILED: ${step.name}`);
      console.error(`Command failed: ${step.command}`);
      process.exit(1);
    }
  }

  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('================================================================');
  console.log('🎉 ALL RELEASE VERIFICATION STEPS PASSED SUCCESSFULLY!');
  console.log(`Total Execution Time: ${totalDuration}s`);
  console.log('FieldLine is fully verified, hardened, and presentation-ready.');
  console.log('================================================================');
}

runReleaseVerification().catch((err) => {
  console.error('❌ Release verification runner crashed:', err);
  process.exit(1);
});
