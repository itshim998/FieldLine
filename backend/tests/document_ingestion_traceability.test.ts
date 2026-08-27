import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { createApp } from '../src/app.js';
import { initDatabase, closeDatabase } from '../src/database/db.js';
import { workerRunner } from '../src/jobs/worker-runner.js';

describe('Document Ingestion End-to-End Traceability & Provenance', () => {
  let app: ReturnType<typeof createApp>;
  let projectId: string;
  let scheduleId: string;
  let activityId: string;

  const testTempDir = path.resolve(process.cwd(), 'test-ingestion-traceability-artifacts');
  const xlsxFile = path.join(testTempDir, 'pier_p1_weekly_log.xlsx');

  beforeEach(async () => {
    initDatabase({ dbPath: ':memory:' });
    app = createApp();

    if (!fs.existsSync(testTempDir)) {
      fs.mkdirSync(testTempDir, { recursive: true });
    }

    // 1. Create realistic XLSX workbook with field observations
    const wb = XLSX.utils.book_new();
    const wsData = [
      ['Date', 'Activity Description', 'Location', 'Quantity', 'Status'],
      ['2026-08-25', 'foundation work', 'Block A', '100 m3', 'in_progress']
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, 'Daily Log');
    XLSX.writeFile(wb, xlsxFile);

    // 2. Create Project
    const pRes = await request(app)
      .post('/api/projects')
      .send({ name: 'Mumbai Trans Harbour Link Package 2', code: 'MTHL-P2' });
    projectId = pRes.body.project.id;

    // 3. Import baseline schedule
    const sRes = await request(app)
      .post(`/api/projects/${projectId}/schedules/import`)
      .attach(
        'file',
        Buffer.from(
          'Activity ID,Activity Name,WBS,Location,Planned Start,Planned Finish,Planned Quantity,Unit\nACT-001,foundation work,WBS-01,Block A,2026-08-01,2026-08-30,500,m3'
        ),
        'mthl_schedule.csv'
      );
    scheduleId = sRes.body.schedule.id;

    const actListRes = await request(app).get(
      `/api/projects/${projectId}/schedules/${scheduleId}/activities`
    );
    activityId = actListRes.body.activities[0].id;
  });

  afterEach(() => {
    closeDatabase();
    if (fs.existsSync(testTempDir)) {
      try {
        fs.rmSync(testTempDir, { recursive: true, force: true });
      } catch {
        // Ignore test cleanup
      }
    }
  });

  it('should support full document ingestion -> matching -> confirmed progress -> activity provenance chain', async () => {
    // -------------------------------------------------------------
    // Step 1: Upload Excel Evidence File
    // -------------------------------------------------------------
    const evUploadRes = await request(app)
      .post(`/api/projects/${projectId}/evidence`)
      .attach('file', xlsxFile);
    expect(evUploadRes.status).toBe(201);
    const evidenceId = evUploadRes.body.evidence.id;

    // -------------------------------------------------------------
    // Step 2: Asynchronous Document Ingestion Job Enqueue & Worker Execution
    // -------------------------------------------------------------
    const processRes = await request(app)
      .post(`/api/projects/${projectId}/evidence/${evidenceId}/process`)
      .send();
    expect(processRes.status).toBe(202);
    expect(processRes.body.job).toBeDefined();
    const jobId = processRes.body.job.id;

    // Process job with worker
    const processed = await workerRunner.processNextJob();
    expect(processed).toBe(true);

    // Verify job completion
    const jobStatusRes = await request(app).get(`/api/projects/${projectId}/jobs/${jobId}`);
    expect(jobStatusRes.status).toBe(200);
    expect(jobStatusRes.body.job.status).toBe('completed');
    expect(jobStatusRes.body.job.result).toBeDefined();

    const progressUpdateId = jobStatusRes.body.job.result.progressUpdateId;
    expect(progressUpdateId).toBeDefined();

    // -------------------------------------------------------------
    // Step 3: Provenance Check 1 — Progress Update -> Evidence
    // -------------------------------------------------------------
    const updateEvRes = await request(app).get(
      `/api/projects/${projectId}/progress-updates/${progressUpdateId}/evidence`
    );
    expect(updateEvRes.status).toBe(200);
    expect(updateEvRes.body.evidence).toHaveLength(1);
    expect(updateEvRes.body.evidence[0].id).toBe(evidenceId);

    // -------------------------------------------------------------
    // Step 4: Verify Activity Matching Integration & Human Review Boundary
    // -------------------------------------------------------------
    expect(jobStatusRes.body.job.result.matchCount).toBeGreaterThan(0);

    const matchesListRes = await request(app).get(
      `/api/projects/${projectId}/progress-updates/${progressUpdateId}/matches`
    );
    expect(matchesListRes.status).toBe(200);
    expect(matchesListRes.body.matches.length).toBeGreaterThan(0);
    const match = matchesListRes.body.matches[0];
    expect(match.status).toBe('suggested'); // Human review boundary preserved!
    expect(match.activityId).toBe(activityId);

    // -------------------------------------------------------------
    // Step 5: Progress Normalization (reusing existing ProgressService)
    // -------------------------------------------------------------
    const progressRecordRes = await request(app)
      .post(`/api/projects/${projectId}/progress-updates/${progressUpdateId}/progress`)
      .send({
        matchId: match.id,
        fact: {
          reference: 'foundation work',
          location: 'Block A',
          progress_percent: 50,
          status: 'in_progress'
        },
        asOfDate: '2026-08-25',
        allowSuggested: true
      });
    expect(progressRecordRes.status).toBe(200);
    expect(progressRecordRes.body.progress.actualPercent).toBe(50);

    // -------------------------------------------------------------
    // Step 6: Provenance Check 2 — Activity -> Originating Document Evidence
    // -------------------------------------------------------------
    const actEvRes = await request(app).get(
      `/api/projects/${projectId}/activities/${activityId}/evidence`
    );
    expect(actEvRes.status).toBe(200);
    expect(actEvRes.body.evidence).toHaveLength(1);
    expect(actEvRes.body.evidence[0].id).toBe(evidenceId);
    expect(actEvRes.body.evidence[0].fileName).toBe('pier_p1_weekly_log.xlsx');
  });
});
