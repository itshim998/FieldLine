import { getValidatedEnv } from '../backend/src/config/env.js';
import { initPostgres, closePostgres, isPostgresHealthy } from '../backend/src/database/postgres.js';
import { runPostgresMigrations, getAppliedPostgresMigrations } from '../backend/src/database/postgres-migrator.js';

async function main(): Promise<void> {
  console.log('====================================================');
  console.log('🐘 Initializing FieldLine PostgreSQL Database Schema');
  console.log('====================================================');

  const env = getValidatedEnv();
  if (!env.DATABASE_URL && env.DATABASE_PROVIDER !== 'postgres') {
    console.error('❌ Error: DATABASE_URL is not configured.');
    console.error('Please set DATABASE_URL (or DATABASE_PROVIDER=postgres) in your .env file.');
    process.exit(1);
  }

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
  console.log('✅ Connected to PostgreSQL database successfully.');

  console.log('📦 Running authoritative schema migrations...');
  const migrationResult = await runPostgresMigrations(pool);
  console.log(`✨ Applied ${migrationResult.applied.length} new migration(s).`);
  if (migrationResult.alreadyApplied.length > 0) {
    console.log(`ℹ️ ${migrationResult.alreadyApplied.length} migration(s) were previously applied:`);
    for (const m of migrationResult.alreadyApplied) {
      console.log(`   - ${m}`);
    }
  }

  // Verify tables in PostgreSQL
  const tablesRes = await pool.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `);

  const expectedTables = [
    'schema_migrations',
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

  const foundTables = new Set(tablesRes.rows.map((r: { table_name: string }) => r.table_name));
  console.log('\n📊 Database Tables Status:');
  let allFound = true;
  for (const t of expectedTables) {
    const exists = foundTables.has(t);
    console.log(`   ${exists ? '✅' : '❌'} ${t}`);
    if (!exists) allFound = false;
  }

  await closePostgres();

  if (!allFound) {
    console.error('\n❌ One or more required tables are missing from PostgreSQL database.');
    process.exit(1);
  }

  console.log('\n====================================================');
  console.log('🎉 PostgreSQL Database Schema Initialized Successfully!');
  console.log('====================================================');
}

main().catch(async (err) => {
  console.error('❌ Migration failed:', err);
  await closePostgres();
  process.exit(1);
});
