import {
  JobRepository,
  jobRepository as defaultJobRepo
} from './job.repository.js';
import {
  DocumentIngestionWorker,
  documentIngestionWorker as defaultDocIngestionWorker
} from './document-ingestion.worker.js';
import { logger } from '../config/logger.js';

export interface WorkerRunnerOptions {
  pollingIntervalMs?: number;
}

export class WorkerRunner {
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private jobRepo: JobRepository;
  private docIngestionWorker: DocumentIngestionWorker;
  private pollingIntervalMs: number;

  constructor(
    jobRepo: JobRepository = defaultJobRepo,
    docIngestionWorker: DocumentIngestionWorker = defaultDocIngestionWorker,
    options?: WorkerRunnerOptions
  ) {
    this.jobRepo = jobRepo;
    this.docIngestionWorker = docIngestionWorker;
    this.pollingIntervalMs = options?.pollingIntervalMs ?? 300;
  }

  /**
   * Starts the background worker polling loop.
   */
  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.scheduleNextTick(0);
  }

  /**
   * Stops the background worker polling loop.
   */
  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * Returns whether the worker loop is actively running.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Waits for any currently executing job in the worker to finish before shutting down.
   */
  async waitForCurrentJob(timeoutMs: number = 10000): Promise<void> {
    const startTime = Date.now();
    while (this.isProcessing) {
      if (Date.now() - startTime > timeoutMs) {
        logger.warn('WorkerRunner: Timeout waiting for current job to settle during shutdown');
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  /**
   * Attempts to claim and process a single queued job.
   * Returns true if a job was found and processed, false if queue was empty or worker was busy.
   */
  async processNextJob(): Promise<boolean> {
    if (this.isProcessing) {
      return false;
    }

    this.isProcessing = true;
    try {
      const claimedJob = this.jobRepo.claimNextQueued();
      if (!claimedJob) {
        return false;
      }

      if (claimedJob.jobType === 'document_ingestion') {
        await this.docIngestionWorker.process(claimedJob);
      } else {
        logger.warn(`WorkerRunner: Unrecognized job type '${claimedJob.jobType}' on job ${claimedJob.id}`);
        this.jobRepo.markFailed(claimedJob.id, `Unrecognized job type: ${claimedJob.jobType}`);
      }

      return true;
    } catch (err) {
      logger.error('WorkerRunner: Unexpected error during job processing iteration', err);
      return false;
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Schedules the next polling tick using setTimeout.
   */
  private scheduleNextTick(delayMs: number): void {
    if (!this.running) {
      return;
    }

    this.timer = setTimeout(async () => {
      if (!this.running) {
        return;
      }

      try {
        const hadJob = await this.processNextJob();
        // If a job was processed, immediately check for another job (10ms delay);
        // otherwise wait the configured polling interval.
        const nextDelay = hadJob ? 10 : this.pollingIntervalMs;
        this.scheduleNextTick(nextDelay);
      } catch (err) {
        logger.error('WorkerRunner: Polling tick error', err);
        this.scheduleNextTick(this.pollingIntervalMs);
      }
    }, delayMs);
  }
}

export const workerRunner = new WorkerRunner();
