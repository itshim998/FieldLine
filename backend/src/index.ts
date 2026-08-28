import { createApp } from './app.js';
import { env } from './config/env.js';
import { initDatabase, closeDatabase } from './database/db.js';
import { jobRepository } from './jobs/job.repository.js';
import { workerRunner } from './jobs/worker-runner.js';
import { reconcileLegacyEvidenceHashes } from './services/evidence/legacy-hash-reconciler.js';

async function startServer(): Promise<void> {
  try {
    console.log('⚡ Starting FieldLine Local Monolith...');
    
    // Initialize SQLite database
    initDatabase();
    console.log(`📦 Local SQLite initialized at: ${env.DATABASE_PATH}`);

    // Reconcile any legacy evidence rows without content hashes
    const reconciliation = reconcileLegacyEvidenceHashes();
    if (reconciliation.reconciledCount > 0) {
      console.log(`🔍 Reconciled ${reconciliation.reconciledCount} legacy evidence content hashes.`);
    }

    // Recover any abandoned/stale processing jobs from a previous crash/restart
    const recoveredCount = jobRepository.requeueStaleProcessingJobs(5 * 60 * 1000);
    if (recoveredCount > 0) {
      console.log(`🔄 Recovered ${recoveredCount} stale processing jobs to queued state.`);
    }

    // Start single in-process background worker
    workerRunner.start();
    console.log('👷 In-process background job worker started.');

    const app = createApp();
    const port = env.PORT;

    const server = app.listen(port, () => {
      console.log(`🚀 FieldLine Backend running locally on http://localhost:${port}`);
      console.log(`🩺 Health check available at: http://localhost:${port}/api/health`);
    });

    // Graceful shutdown handlers
    let isShuttingDown = false;
    const handleShutdown = async (signal: string) => {
      if (isShuttingDown) return;
      isShuttingDown = true;

      console.log(`\n🛑 Received ${signal}. Shutting down FieldLine server gracefully...`);

      // 1. Stop background worker and wait for current job to settle
      workerRunner.stop();
      await workerRunner.waitForCurrentJob(5000);
      console.log('👷 Background worker stopped cleanly.');

      // 2. Close HTTP server
      server.close(() => {
        // 3. Close database connection
        closeDatabase();
        console.log('🔒 Database connection closed. Server exited cleanly.');
        process.exit(0);
      });
    };

    process.on('SIGINT', () => handleShutdown('SIGINT'));
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  } catch (error) {
    console.error('❌ Failed to start FieldLine backend:', error);
    process.exit(1);
  }
}

// Start server when executed directly
startServer();

