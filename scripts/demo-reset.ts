import fs from 'node:fs';
import path from 'node:path';
import { getValidatedEnv } from '../backend/src/config/env.js';
import { initDatabase, closeDatabase, isDatabaseHealthy } from '../backend/src/database/db.js';
import { getAppliedMigrations } from '../backend/src/database/migrator.js';

async function resetDemoEnvironment(): Promise<void> {
  console.log('====================================================');
  console.log('🔄 Resetting FieldLine Local Runtime Environment (Pass 2)');
  console.log('====================================================');

  const rootDir = process.cwd();
  const env = getValidatedEnv();

  // 1. Close existing DB if open
  closeDatabase();

  // 2. Remove SQLite files if they exist
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

  if (isDatabaseHealthy()) {
    console.log('✅ SQLite database cleanly re-initialized and verified healthy');
  } else {
    console.error('❌ Failed to re-initialize SQLite database during reset');
    process.exit(1);
  }

  closeDatabase();

  console.log('====================================================');
  console.log('✨ FieldLine local demo environment reset complete!');
  console.log('====================================================');
}

resetDemoEnvironment().catch((err) => {
  console.error('❌ Demo reset failed with error:', err);
  process.exit(1);
});
