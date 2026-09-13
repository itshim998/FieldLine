import { getValidatedEnv } from '../backend/src/config/env.js';
import { initPostgres, closePostgres, isPostgresHealthy } from '../backend/src/database/postgres.js';
import { runPostgresMigrations } from '../backend/src/database/postgres-migrator.js';
import { execSync } from 'node:child_process';
import path from 'node:path';

async function seedPostgresDemo(): Promise<void> {
  console.log('====================================================');
  console.log('🌱 Seeding Golden Demo into PostgreSQL Database');
  console.log('====================================================');

  const env = getValidatedEnv();
  if (!env.DATABASE_URL) {
    console.error('❌ Error: DATABASE_URL is not configured.');
    console.error('Set DATABASE_URL in your environment or .env file before running pg:seed.');
    process.exit(1);
  }

  // 1. Initialize schema
  console.log('📦 Step 1: Initializing PostgreSQL schema...');
  const pool = await initPostgres({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_SSL
  });

  const healthy = await isPostgresHealthy();
  if (!healthy) {
    console.error('❌ PostgreSQL database connectivity check failed.');
    await closePostgres();
    process.exit(1);
  }

  const migResult = await runPostgresMigrations(pool);
  console.log(`✅ Schema migrations up to date (${migResult.applied.length} applied, ${migResult.alreadyApplied.length} verified).`);
  await closePostgres();

  // 2. Import Golden Demo from SQLite
  console.log('\n📦 Step 2: Running deterministic data import from Golden Demo baseline...');
  const importScript = path.resolve(process.cwd(), 'scripts', 'pg-import.ts');
  execSync(`npx tsx "${importScript}"`, { stdio: 'inherit' });

  // 3. Verify PostgreSQL database
  console.log('\n📦 Step 3: Verifying PostgreSQL database state...');
  const verifyScript = path.resolve(process.cwd(), 'scripts', 'pg-verify.ts');
  execSync(`npx tsx "${verifyScript}"`, { stdio: 'inherit' });

  console.log('\n====================================================');
  console.log('🎉 PostgreSQL Golden Demo Seed Completed Successfully!');
  console.log('====================================================');
}

seedPostgresDemo().catch((err) => {
  console.error('❌ pg:seed failed:', err);
  process.exit(1);
});
