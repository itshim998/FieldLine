import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { createApp } from '../src/app.js';
import { initDatabase, closeDatabase } from '../src/database/db.js';

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
      ['2026-08-25', 'Construct Pier P1 Substructure', 'Zone A', '100 m3', 'in_progress']
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
          'Activity ID,Activity Name,WBS,Location,Planned Start,Planned Finish,Planned Quantity,Unit\nACT-PIER-01,Construct Pier P1 Substructure,WBS-01,Zone A,2026-08-01,2026-08-30,500,m3'
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
    // Step 2: Explicit Synchronous Document Ingestion
    // -------------------------------------------------------------
    const processRes = await request(app)
      .post(`/api/projects/${projectId}/evidence/${evidenceId}/process`)
      .send();
    expect(processRes.status).toBe(200);

    const progressUpdateId = processRes.body.progressUpdate.id;
    expect(progressUpdateId).toBeDefined();
    expect(processRes.body.evidence.progressUpdateId).toBe(progressUpdateId);
    expect(processRes.body.normalizedDocument.sourceType).toBe('xlsx');
    expect(processRes.body.extraction.items.length).toBeGreaterThan(0);

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
    // Step 4: Activity Matching (reusing existing ActivityMatchingService)
    // -------------------------------------------------------------
    const matchRes = await request(app)
      .post(`/api/projects/${projectId}/progress-updates/${progressUpdateId}/matches`)
      .send({
        extraction: {
          items: [
            {
              reference: 'Construct Pier P1 Substructure',
              location: 'Zone A',
              progress_percent: 60,
              status: 'in_progress'
            }
          ]
        }
      });
    expect(matchRes.status).toBe(200);

    const matchesListRes = await request(app).get(
      `/api/projects/${projectId}/progress-updates/${progressUpdateId}/matches`
    );
    expect(matchesListRes.status).toBe(200);
    expect(matchesListRes.body.matches).toHaveLength(1);
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
          reference: 'Construct Pier P1 Substructure',
          location: 'Zone A',
          progress_percent: 60,
          status: 'in_progress'
        },
        asOfDate: '2026-08-25',
        allowSuggested: true
      });
    expect(progressRecordRes.status).toBe(200);
    expect(progressRecordRes.body.progress.actualPercent).toBe(60);

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
