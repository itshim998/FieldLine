import fs from 'node:fs';
import path from 'node:path';
import { getValidatedEnv } from '../backend/src/config/env.js';
import { initDatabase, closeDatabase, isDatabaseHealthy, getDatabase } from '../backend/src/database/db.js';
import { getAppliedMigrations } from '../backend/src/database/migrator.js';

async function runSetup(): Promise<void> {
  console.log('====================================================');
  console.log('🚀 Initializing FieldLine Local Environment (Pass 2)');
  console.log('====================================================');

  const rootDir = process.cwd();

  // 1. Check & copy .env if missing
  const envPath = path.join(rootDir, '.env');
  const envExamplePath = path.join(rootDir, '.env.example');

  if (!fs.existsSync(envPath)) {
    if (fs.existsSync(envExamplePath)) {
      fs.copyFileSync(envExamplePath, envPath);
      console.log('✅ Created .env from .env.example with safe local defaults');
    } else {
      console.warn('⚠️ .env.example not found, skipping .env copy');
    }
  } else {
    console.log('ℹ️  Existing .env found; preserving current config');
  }

  // 2. Validate environment configuration
  const env = getValidatedEnv();
  console.log(`✅ Environment validated (NODE_ENV=${env.NODE_ENV}, PORT=${env.PORT})`);

  // 3. Ensure required directories exist
  const requiredDirs = [
    path.dirname(path.resolve(rootDir, env.DATABASE_PATH)),
    path.resolve(rootDir, env.UPLOAD_DIR),
    path.resolve(rootDir, env.UPLOAD_DIR, 'evidence'),
    path.resolve(rootDir, 'demo'),
    path.resolve(rootDir, 'dist')
  ];

  for (const dir of requiredDirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`📁 Created directory: ${path.relative(rootDir, dir)}`);
    } else {
      console.log(`📁 Verified directory: ${path.relative(rootDir, dir)}`);
    }
  }

  // 4. Initialize SQLite database, enable foreign keys, WAL mode, and execute migrations
  console.log(`📦 Initializing SQLite database at: ${env.DATABASE_PATH}`);
  const db = initDatabase();

  const applied = getAppliedMigrations(db);
  console.log(`✅ SQLite migrations applied (${applied.length} total): ${applied.join(', ')}`);

  if (isDatabaseHealthy()) {
    console.log('✅ SQLite database verified healthy and fully migrated');
  } else {
    console.error('❌ Database health check failed during setup');
    process.exit(1);
  }

  closeDatabase();

  console.log('====================================================');
  console.log('🎉 FieldLine local environment is ready!');
  console.log('Run `npm run dev` to start backend and frontend.');
  console.log('Run `npm test` to execute test suite.');
  console.log('====================================================');
}

runSetup().catch((err) => {
  console.error('❌ Setup failed with error:', err);
  process.exit(1);
});
