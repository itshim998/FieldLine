import fs from 'node:fs';
import path from 'node:path';
import { getValidatedEnv } from '../backend/src/config/env.js';
import { initDatabase, closeDatabase } from '../backend/src/database/db.js';
import { initPostgres, closePostgres, isPostgresHealthy } from '../backend/src/database/postgres.js';
import { getAppliedPostgresMigrations } from '../backend/src/database/postgres-migrator.js';

interface TableAudit {
  table: string;
  postgresCount: number;
  sqliteCount: number | null;
  match: boolean;
}

async function verifyPostgresDatabase(): Promise<void> {
  console.log('====================================================');
  console.log('🔍 FieldLine PostgreSQL Database Verification Audit');
  console.log('====================================================');

  const env = getValidatedEnv();
  if (!env.DATABASE_URL) {
    console.error('❌ Error: DATABASE_URL is not configured.');
    process.exit(1);
  }

  const pool = await initPostgres({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_SSL
  });

  // 1. Health check
  const healthy = await isPostgresHealthy();
  if (!healthy) {
    console.error('❌ PostgreSQL connectivity check failed.');
    await closePostgres();
    process.exit(1);
  }
  console.log('✅ PostgreSQL connection verified healthy.');

  // 2. Migrations check
  const appliedMigrations = await getAppliedPostgresMigrations(pool);
  console.log(`✅ Applied PostgreSQL migrations: ${appliedMigrations.length}`);
  for (const m of appliedMigrations) {
    console.log(`   - ${m}`);
  }

  // 3. Optional comparison with SQLite
  const tables = [
    'system_metadata',
    'projects',
    'project_accounts',
    'schedules',
    'activities',
    'evidence',
    'progress_updates',
    'activity_progress',
    'activity_matches',
    'project_events',
    'operational_blockers',
    'notification_outbox',
    'processing_jobs'
  ];

  let sqliteDb: ReturnType<typeof initDatabase> | null = null;
  const sqlitePath = path.resolve(process.cwd(), env.DATABASE_PATH);
  if (fs.existsSync(sqlitePath)) {
    try {
      sqliteDb = initDatabase();
      console.log(`ℹ️ Source SQLite database detected at: ${env.DATABASE_PATH}`);
    } catch {
      sqliteDb = null;
    }
  }

  const audits: TableAudit[] = [];
  let allMatched = true;

  console.log('\n📊 Table Row Count Audit:');
  console.log('----------------------------------------------------------------------');
  console.log(`| ${'Table'.padEnd(25)} | ${'PostgreSQL'.padStart(10)} | ${'SQLite'.padStart(10)} | Status |`);
  console.log('----------------------------------------------------------------------');

  for (const table of tables) {
    const pgRes = await pool.query(`SELECT COUNT(*) as count FROM ${table}`);
    const pgCount = parseInt(pgRes.rows[0].count, 10);

    let sqliteCount: number | null = null;
    if (sqliteDb) {
      try {
        const sqlRow = sqliteDb.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number };
        sqliteCount = sqlRow.count;
      } catch {
        sqliteCount = null;
      }
    }

    const match = sqliteCount === null || pgCount === sqliteCount;
    if (!match) allMatched = false;

    audits.push({
      table,
      postgresCount: pgCount,
      sqliteCount,
      match
    });

    const matchSymbol = sqliteCount === null ? 'ℹ️' : match ? '✅' : '❌';
    console.log(
      `| ${table.padEnd(25)} | ${String(pgCount).padStart(10)} | ${String(sqliteCount ?? 'N/A').padStart(10)} |   ${matchSymbol}   |`
    );
  }
  console.log('----------------------------------------------------------------------');

  // 4. Relational integrity audit on PostgreSQL
  console.log('\n🛡️ Relational Integrity & Invariant Checks:');

  // Invariant A: No orphaned activities
  const orphanedActivities = await pool.query(`
    SELECT COUNT(*) as count 
    FROM activities a 
    LEFT JOIN schedules s ON a.schedule_id = s.id 
    WHERE s.id IS NULL
  `);
  const orphanActCount = parseInt(orphanedActivities.rows[0].count, 10);
  console.log(`   ${orphanActCount === 0 ? '✅' : '❌'} Orphaned activities: ${orphanActCount}`);

  // Invariant B: No orphaned evidence
  const orphanedEvidence = await pool.query(`
    SELECT COUNT(*) as count 
    FROM evidence e 
    LEFT JOIN projects p ON e.project_id = p.id 
    WHERE p.id IS NULL
  `);
  const orphanEvCount = parseInt(orphanedEvidence.rows[0].count, 10);
  console.log(`   ${orphanEvCount === 0 ? '✅' : '❌'} Orphaned evidence: ${orphanEvCount}`);

  // Invariant C: Progress bounds (percent complete between 0 and 100)
  const invalidProgress = await pool.query(`
    SELECT COUNT(*) as count 
    FROM activity_progress 
    WHERE percent_complete < 0 OR percent_complete > 100
  `);
  const invalidProgCount = parseInt(invalidProgress.rows[0].count, 10);
  console.log(`   ${invalidProgCount === 0 ? '✅' : '❌'} Invalid progress bounds: ${invalidProgCount}`);

  // Invariant D: Job status constraints
  const invalidJobs = await pool.query(`
    SELECT COUNT(*) as count 
    FROM processing_jobs 
    WHERE status NOT IN ('queued', 'processing', 'completed', 'failed')
  `);
  const invalidJobCount = parseInt(invalidJobs.rows[0].count, 10);
  console.log(`   ${invalidJobCount === 0 ? '✅' : '❌'} Invalid job status rows: ${invalidJobCount}`);

  // Invariant E: Notification delivery status constraints
  const invalidNotifs = await pool.query(`
    SELECT COUNT(*) as count 
    FROM notification_outbox 
    WHERE delivery_status NOT IN ('pending', 'delivered', 'failed', 'dead_letter')
  `);
  const invalidNotifCount = parseInt(invalidNotifs.rows[0].count, 10);
  console.log(`   ${invalidNotifCount === 0 ? '✅' : '❌'} Invalid notification status rows: ${invalidNotifCount}`);

  const invariantFailures = orphanActCount + orphanEvCount + invalidProgCount + invalidJobCount + invalidNotifCount;

  if (sqliteDb) {
    closeDatabase();
  }
  await closePostgres();

  if (invariantFailures > 0) {
    console.error(`\n❌ Invariant check failed with ${invariantFailures} issue(s).`);
    process.exit(1);
  }

  console.log('\n====================================================');
  console.log('🎉 PostgreSQL Database Verification Audit PASSED!');
  console.log('====================================================');
}

verifyPostgresDatabase().catch(async (err) => {
  console.error('❌ Verification failed:', err);
  await closePostgres();
  process.exit(1);
});
