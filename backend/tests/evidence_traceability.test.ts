import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { initDatabase, closeDatabase } from '../src/database/db.js';

describe('Evidence End-to-End Provenance & Traceability Chain', () => {
  let app: ReturnType<typeof createApp>;
  let projectId: string;
  let scheduleId: string;
  let activityId: string;
  let update1Id: string;
  let update2Id: string;

  const testTempDir = path.resolve(process.cwd(), 'test-traceability-artifacts');
  const file1 = path.join(testTempDir, 'pier_p1_drawing.pdf');
  const file2 = path.join(testTempDir, 'pier_p1_concrete_ticket.jpg');
  const file3 = path.join(testTempDir, 'pier_p1_inspection_memo.txt');

  beforeEach(async () => {
    initDatabase({ dbPath: ':memory:' });
    app = createApp();

    if (!fs.existsSync(testTempDir)) {
      fs.mkdirSync(testTempDir, { recursive: true });
    }
    fs.writeFileSync(file1, 'BLUEPRINT FOR PIER 1');
    fs.writeFileSync(file2, 'READY-MIX CONCRETE BATCH 4519 TICKET');
    fs.writeFileSync(file3, 'QA INSPECTION SIGN-OFF BY CHIEF ENGINEER');

    // 1. Create Project
    const pRes = await request(app)
      .post('/api/projects')
      .send({ name: 'Mumbai Trans Harbour Link Package 2', code: 'MTHL-P2' });
    projectId = pRes.body.project.id;

    // 2. Import baseline schedule with Activity
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

  it('should support full provenance chain from Activity Progress back to Originating Evidence', async () => {
    // -------------------------------------------------------------
    // Observation 1: Day 10 (2026-08-10) - 20% complete
    // -------------------------------------------------------------
    // Step A: Progress report 1 received
    const u1Res = await request(app)
      .post(`/api/projects/${projectId}/progress-updates`)
      .send({
        reportDate: '2026-08-10',
        reporterName: 'Suresh Patil',
        reporterRole: 'Site Engineer',
        rawText: 'Pier P1 substructure reinforcement placed. Pouring first 100 m3 batch today.'
      });
    update1Id = u1Res.body.progressUpdate.id;

    // Step B: Attach 2 evidence files to update 1 (drawing + concrete ticket)
    const ev1Res = await request(app)
      .post(`/api/projects/${projectId}/evidence`)
      .attach('file', file1)
      .field('progressUpdateId', update1Id);
    const ev1Id = ev1Res.body.evidence.id;

    const ev2Res = await request(app)
      .post(`/api/projects/${projectId}/evidence`)
      .attach('file', file2)
      .field('progressUpdateId', update1Id);
    const ev2Id = ev2Res.body.evidence.id;

    // Step C: Match update 1 to activity
    await request(app)
      .post(`/api/projects/${projectId}/progress-updates/${update1Id}/matches`)
      .send({
        extraction: {
          items: [
            {
              reference: 'Construct Pier P1 Substructure',
              location: 'Zone A',
              progress_percent: 20,
              status: 'in_progress'
            }
          ]
        }
      });
    const matches1Res = await request(app).get(
      `/api/projects/${projectId}/progress-updates/${update1Id}/matches`
    );
    const match1Id = matches1Res.body.matches[0].id;

    // Step D: Normalize and record canonical progress
    await request(app)
      .post(`/api/projects/${projectId}/progress-updates/${update1Id}/progress`)
      .send({
        matchId: match1Id,
        fact: {
          reference: 'Construct Pier P1 Substructure',
          progress_percent: 20,
          status: 'in_progress'
        },
        asOfDate: '2026-08-10',
        allowSuggested: true
      });

    // -------------------------------------------------------------
    // Observation 2: Day 25 (2026-08-25) - 100% completed
    // -------------------------------------------------------------
    // Step E: Progress report 2 received
    const u2Res = await request(app)
      .post(`/api/projects/${projectId}/progress-updates`)
      .send({
        reportDate: '2026-08-25',
        reporterName: 'Suresh Patil',
        reporterRole: 'Site Engineer',
        rawText: 'Pier P1 substructure casting 100% complete and inspected by QA.'
      });
    update2Id = u2Res.body.progressUpdate.id;

    // Step F: Attach inspection memo evidence to update 2
    const ev3Res = await request(app)
      .post(`/api/projects/${projectId}/evidence`)
      .attach('file', file3)
      .field('progressUpdateId', update2Id);
    const ev3Id = ev3Res.body.evidence.id;

    // Match update 2 to activity
    await request(app)
      .post(`/api/projects/${projectId}/progress-updates/${update2Id}/matches`)
      .send({
        extraction: {
          items: [
            {
              reference: 'Construct Pier P1 Substructure',
              location: 'Zone A',
              progress_percent: 100,
              status: 'completed'
            }
          ]
        }
      });
    const matches2Res = await request(app).get(
      `/api/projects/${projectId}/progress-updates/${update2Id}/matches`
    );
    const match2Id = matches2Res.body.matches[0].id;

    // Step G: Normalize second progress observation
    await request(app)
      .post(`/api/projects/${projectId}/progress-updates/${update2Id}/progress`)
      .send({
        matchId: match2Id,
        fact: {
          reference: 'Construct Pier P1 Substructure',
          progress_percent: 100,
          status: 'completed'
        },
        asOfDate: '2026-08-25',
        allowSuggested: true
      });

    // -------------------------------------------------------------
    // VERIFICATION: Provenance Traceability Checks
    // -------------------------------------------------------------

    // 1. Progress Update 1 returns both of its attached evidence records
    const u1EvRes = await request(app).get(
      `/api/projects/${projectId}/progress-updates/${update1Id}/evidence`
    );
    expect(u1EvRes.status).toBe(200);
    expect(u1EvRes.body.evidence).toHaveLength(2);
    expect(u1EvRes.body.evidence.map((e: { id: string }) => e.id)).toEqual(
      expect.arrayContaining([ev1Id, ev2Id])
    );

    // 2. Progress Update 2 returns its single attached evidence record
    const u2EvRes = await request(app).get(
      `/api/projects/${projectId}/progress-updates/${update2Id}/evidence`
    );
    expect(u2EvRes.status).toBe(200);
    expect(u2EvRes.body.evidence).toHaveLength(1);
    expect(u2EvRes.body.evidence[0].id).toBe(ev3Id);

    // 3. Activity Traceability returns ALL 3 historical originating evidence records across both observations!
    const actTraceRes = await request(app).get(
      `/api/projects/${projectId}/activities/${activityId}/evidence`
    );
    expect(actTraceRes.status).toBe(200);
    expect(actTraceRes.body.evidence).toHaveLength(3);
    expect(actTraceRes.body.evidence.map((e: { id: string }) => e.id)).toEqual(
      expect.arrayContaining([ev1Id, ev2Id, ev3Id])
    );

    // 4. Content of each evidence file can be fetched and matches the original ground-truth bytes
    const content1 = await request(app).get(
      `/api/projects/${projectId}/evidence/${ev1Id}/content`
    );
    expect(content1.status).toBe(200);
    const text1 = content1.text || (Buffer.isBuffer(content1.body) ? content1.body.toString('utf-8') : '');
    expect(text1).toBe('BLUEPRINT FOR PIER 1');

    const content2 = await request(app).get(
      `/api/projects/${projectId}/evidence/${ev2Id}/content`
    );
    expect(content2.status).toBe(200);
    const text2 = content2.text || (Buffer.isBuffer(content2.body) ? content2.body.toString('utf-8') : '');
    expect(text2).toBe('READY-MIX CONCRETE BATCH 4519 TICKET');

    const content3 = await request(app).get(
      `/api/projects/${projectId}/evidence/${ev3Id}/content`
    );
    expect(content3.status).toBe(200);
    const text3 = content3.text || (Buffer.isBuffer(content3.body) ? content3.body.toString('utf-8') : '');
    expect(text3).toBe('QA INSPECTION SIGN-OFF BY CHIEF ENGINEER');
  });
});
