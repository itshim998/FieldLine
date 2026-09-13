import { createApp, attachLiveSessionWebSocket } from './app.js';
import { createLiveToolExecutor } from './ai/live/live-tool-handlers.js';
import { env } from './config/env.js';
import { initDatabase, closeDatabase } from './database/db.js';
import { projectRepository } from './repositories/project.repository.js';
import { jobRepository } from './jobs/job.repository.js';
import { workerRunner } from './jobs/worker-runner.js';
import { notificationOutboxRepository } from './repositories/notification-outbox.repository.js';
import { notificationWorkerRunner } from './jobs/notification-worker-runner.js';
import { reconcileLegacyEvidenceHashes } from './services/evidence/legacy-hash-reconciler.js';
import { seedGoldenDemo } from '../../demo/golden-demo-seeder.js';

async function startServer(): Promise<void> {
  try {
    console.log('⚡ Starting FieldLine Server...');
    
    // Initialize SQLite database
    initDatabase();
    console.log(`📦 SQLite database initialized at: ${env.DATABASE_PATH}`);

    // Auto-seed golden demo dataset if requested and database is empty
    if (env.AUTO_SEED_DEMO) {
      const projectCount = projectRepository.count();
      if (projectCount === 0) {
        console.log('🌱 Fresh/empty database detected. Auto-seeding Golden Demo Dataset...');
        try {
          const seedResult = await seedGoldenDemo();
          console.log(`✨ Golden Demo seeded successfully: [${seedResult.projectCode}] ${seedResult.projectName} (${seedResult.activitiesCount} activities, ${seedResult.evidenceCount} evidence files)`);
        } catch (seedErr) {
          console.error('⚠️ Auto-seeding Golden Demo encountered an error:', seedErr);
        }
      } else {
        console.log(`ℹ️ Existing data preserved: ${projectCount} project(s) found in database.`);
      }
    }

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

    // Recover any abandoned/stale notification leases from a previous crash/restart
    const recoveredNotifs = notificationOutboxRepository.requeueStaleProcessing(
      env.NOTIFICATION_LEASE_TIMEOUT_MS ?? 5 * 60 * 1000
    );
    if (recoveredNotifs > 0) {
      console.log(`🔄 Recovered ${recoveredNotifs} stale notification leases.`);
    }

    // Start in-process background workers
    workerRunner.start();
    console.log('👷 In-process background job worker started.');
    notificationWorkerRunner.start();
    console.log('📬 In-process anomaly notification worker started.');

    const app = createApp();
    const port = env.PORT;

    const server = app.listen(port, () => {
      console.log(`🚀 FieldLine Backend running locally on http://localhost:${port}`);
      console.log(`🩺 Health check available at: http://localhost:${port}/api/health`);
      console.log(`🎙️ Gemini Live WebSocket gateway running at: ws://localhost:${port}/ws/live-session`);
    });

    // Attach Gemini Live WebSocket gateway on /ws/live-session
    const { wss: liveWss, gateway: liveGateway } = attachLiveSessionWebSocket(server, {
      toolExecutor: createLiveToolExecutor()
    });

    // Graceful shutdown handlers
    let isShuttingDown = false;
    const handleShutdown = async (signal: string) => {
      if (isShuttingDown) return;
      isShuttingDown = true;

      console.log(`\n🛑 Received ${signal}. Shutting down FieldLine server gracefully...`);

      // 1. Close all active live sessions and WebSocket server
      liveGateway.closeAllSessions();
      liveWss.close(() => {
        console.log('🎙️ Live session WebSocket server closed cleanly.');
      });

      // 2. Stop background workers and wait for current jobs to settle
      workerRunner.stop();
      notificationWorkerRunner.stop();
      await Promise.all([
        workerRunner.waitForCurrentJob(5000),
        notificationWorkerRunner.waitForCurrentProcessing(5000)
      ]);
      console.log('👷 Background workers stopped cleanly.');

      // 3. Close HTTP server
      server.close(() => {
        // 4. Close database connection
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

