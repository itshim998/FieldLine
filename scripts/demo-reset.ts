import fs from 'node:fs';
import path from 'node:path';
import { getValidatedEnv } from '../backend/src/config/env.js';
import { initDatabase, closeDatabase, isDatabaseHealthy } from '../backend/src/database/db.js';
import { getAppliedMigrations } from '../backend/src/database/migrator.js';
import { seedGoldenDemo } from '../demo/golden-demo-seeder.js';
import { verifyGoldenDemoEnvironment } from './demo-verify.js';

async function resetDemoEnvironment(): Promise<void> {
  console.log('====================================================');
  console.log('🔄 Resetting FieldLine Golden Demo Environment');
  console.log('====================================================');

  const rootDir = process.cwd();
  const env = getValidatedEnv();

  // 1. Close existing DB if open
  closeDatabase();

  // 2. Remove SQLite database files
  const dbFullPath = path.resolve(rootDir, env.DATABASE_PATH);
  const dbFiles = [
    dbFullPath,
    `${dbFullPath}-wal`,
    `${dbFullPath}-shm`,
    `${dbFullPath}-journal`
  ];

  for (const file of dbFiles) {
    if (fs.existsSync(file)) {
      try {
        fs.unlinkSync(file);
        console.log(`🗑️ Removed runtime database file: ${path.relative(rootDir, file)}`);
      } catch (err) {
        console.warn(`⚠️ Could not remove ${file}:`, err);
      }
    }
  }

  // 3. Clean runtime files in uploads (preserve .gitkeep and essential directory structure)
  const cleanDirectory = (dirPath: string) => {
    if (!fs.existsSync(dirPath)) return;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.gitkeep') continue;
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        cleanDirectory(fullPath);
        const remaining = fs.readdirSync(fullPath);
        if (remaining.length === 0) {
          fs.rmdirSync(fullPath);
        }
      } else {
        fs.unlinkSync(fullPath);
        console.log(`🗑️ Removed runtime upload file: ${path.relative(rootDir, fullPath)}`);
      }
    }
  };

  cleanDirectory(path.resolve(rootDir, env.UPLOAD_DIR));

  // 4. Reinitialize fresh SQLite database with authoritative migrations
  console.log(`📦 Re-initializing clean SQLite database at: ${env.DATABASE_PATH}`);
  const db = initDatabase();

  const applied = getAppliedMigrations(db);
  console.log(`✅ SQLite migrations applied on fresh database: ${applied.join(', ')}`);

  if (!isDatabaseHealthy()) {
    console.error('❌ Failed to re-initialize SQLite database during reset');
    process.exit(1);
  }

  // 5. Seed Golden Demo Dataset
  console.log('🌱 Seeding deterministic SIH Golden Demo dataset...');
  const seedResult = await seedGoldenDemo();

  console.log('----------------------------------------------------');
  console.log(`📋 Seed Summary:`);
  console.log(`   - Project: [${seedResult.projectCode}] ${seedResult.projectName}`);
  console.log(`   - Activities: ${seedResult.activitiesCount} across 6 EPC Areas`);
  console.log(`   - Evidence Files: ${seedResult.evidenceCount}`);
  console.log(`   - Field Reports: ${seedResult.progressReportsCount}`);
  console.log(`   - Canonical Progress Observations: ${seedResult.canonicalObservationsCount}`);
  console.log(`   - Reference As-Of Date: ${seedResult.asOfDate}`);
  console.log('----------------------------------------------------');

  // 6. Run Golden Demo Verification
  console.log('🧪 Verifying golden demo environment invariants...');
  const verification = await verifyGoldenDemoEnvironment();

  if (!verification.passed) {
    console.error('❌ Golden demo verification failed after reset:');
    for (const failure of verification.failures) {
      console.error(`   ${failure}`);
    }
    process.exit(1);
  }

  console.log('====================================================');
  console.log('✨ FieldLine Golden Demo Environment is ready!');
  console.log('Run `npm run dev` to start backend and frontend.');
  console.log('The web dashboard will automatically open into Refinery Expansion — Unit 4.');
  console.log('====================================================');
}

resetDemoEnvironment().catch((err) => {
  console.error('❌ Demo reset failed with error:', err);
  process.exit(1);
});
