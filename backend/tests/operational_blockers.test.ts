import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { seedGoldenDemo } from '../../demo/golden-demo-seeder.js';
import { projectRepository } from '../src/repositories/project.repository.js';
import { activityRepository } from '../src/repositories/activity.repository.js';
import { operationalBlockerRepository } from '../src/repositories/operational-blocker.repository.js';
import { projectEventRepository } from '../src/repositories/project-event.repository.js';
import { getDatabase } from '../src/database/db.js';
import { workerAuthHeader, adminAuthHeader } from './helpers/auth-test-helper.js';

describe('Pass 33 — Operational Blockers & Work-Relevant Safety Context', () => {
  let app: ReturnType<typeof createApp>;
  let projectId: string;
  let otherProjectId: string;

  beforeEach(async () => {
    app = createApp();
    const seedResult = await seedGoldenDemo();
    projectId = seedResult.projectId;

    // Reset operational blockers table for test isolation
    const db = getDatabase();
    db.exec('DELETE FROM operational_blockers');

    // Create or retrieve a second isolated project to verify cross-project isolation
    const existing = projectRepository.getByCode('OFFSHORE-X1');
    if (existing) {
      otherProjectId = existing.id;
    } else {
      const otherProj = projectRepository.create({
        code: 'OFFSHORE-X1',
        name: 'Offshore Platform X1',
        status: 'active'
      });
      otherProjectId = otherProj.id;
    }
  });

  it('1. Reports blocker on ACT-C01 (Pipe Rack PR-07) with category equipment and human attribution', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/blockers`)
      .set(workerAuthHeader(projectId))
      .send({
        activityId: 'ACT-C01',
        category: 'equipment',
        description: '50T mobile crane down for hydraulic line repair; pipe rack structural steel lifts halted',
        reporterName: 'Carlos Rivera',
        reporterRole: 'Rigging Superintendent'
      });

    expect(res.status).toBe(201);
    expect(res.body.blocker).toBeDefined();
    expect(res.body.blocker.id).toBeDefined();
    expect(res.body.blocker.projectId).toBe(projectId);
    expect(res.body.blocker.category).toBe('equipment');
    expect(res.body.blocker.status).toBe('active');
    expect(res.body.blocker.reporterName).toBe('Carlos Rivera');
    expect(res.body.blocker.reporterRole).toBe('Rigging Superintendent');
    expect(res.body.blocker.description).toContain('crane down');

    // Verify activityId was resolved from externalId 'ACT-C01' to canonical activity id
    const actC01 = activityRepository.listByProjectId(projectId).find(a => a.externalId === 'ACT-C01')!;
    expect(res.body.blocker.activityId).toBe(actC01.id);
  });

  it('2. Active blocker appears in Worker and Admin active blockers query', async () => {
    // Report two blockers: one on an activity, one on general site
    await request(app)
      .post(`/api/projects/${projectId}/blockers`)
      .set(workerAuthHeader(projectId))
      .send({
        activityId: 'ACT-C01',
        category: 'equipment',
        description: 'Crane breakdown at Area C',
        reporterName: 'Rigger Lead'
      });

    await request(app)
      .post(`/api/projects/${projectId}/blockers`)
      .set(workerAuthHeader(projectId))
      .send({
        category: 'access',
        description: 'Heavy mud blocking south perimeter haul road',
        reporterName: 'Logistics Supervisor'
      });

    // Query active blockers via Worker credentials
    const workerRes = await request(app)
      .get(`/api/projects/${projectId}/blockers?status=active`)
      .set(workerAuthHeader(projectId));

    expect(workerRes.status).toBe(200);
    expect(workerRes.body.blockers).toHaveLength(2);
    expect(workerRes.body.blockers.some((b: any) => b.category === 'equipment')).toBe(true);
    expect(workerRes.body.blockers.some((b: any) => b.category === 'access')).toBe(true);

    // Query active blockers via Admin credentials
    const adminRes = await request(app)
      .get(`/api/projects/${projectId}/blockers`)
      .set(adminAuthHeader(projectId));

    expect(adminRes.status).toBe(200);
    expect(adminRes.body.blockers).toHaveLength(2);
  });

  it('3. Active blocker flows into GET /risk-status and flags activity with active_blocker rationale', async () => {
    // Report blocker on ACT-C01
    await request(app)
      .post(`/api/projects/${projectId}/blockers`)
      .set(workerAuthHeader(projectId))
      .send({
        activityId: 'ACT-C01',
        category: 'equipment',
        description: '50T crane breakdown halting lifts',
        reporterName: 'Carlos Rivera'
      });

    const riskRes = await request(app)
      .get(`/api/projects/${projectId}/risk-status`)
      .query({ asOfDate: '2026-08-28' });

    expect(riskRes.status).toBe(200);
    const c01Risk = riskRes.body.activities.find((a: any) => a.externalId === 'ACT-C01');
    expect(c01Risk).toBeDefined();
    expect(c01Risk.classification).toBe('AT_RISK');

    // Verify reason array contains the active blocker rationale
    const blockerReason = c01Risk.reasons.find((r: any) => r.code === 'active_blocker');
    expect(blockerReason).toBeDefined();
    expect(blockerReason.message).toContain('equipment');
    expect(blockerReason.message).toContain('50T crane breakdown');
  });

  it('4. Blocker elevates an ON_TRACK activity to AT_RISK and resolving it restores ON_TRACK status', async () => {
    // Find an ON_TRACK activity in golden demo as of 2026-08-28 (e.g. ACT-B02 or ACT-A04)
    const initialRiskRes = await request(app)
      .get(`/api/projects/${projectId}/risk-status`)
      .query({ asOfDate: '2026-08-28' });

    const onTrackAct = initialRiskRes.body.activities.find((a: any) => a.classification === 'ON_TRACK');
    expect(onTrackAct).toBeDefined();
    const targetExtId = onTrackAct.externalId;

    // Report material blocker on this activity
    const postRes = await request(app)
      .post(`/api/projects/${projectId}/blockers`)
      .set(workerAuthHeader(projectId))
      .send({
        activityId: targetExtId,
        category: 'material',
        description: 'Delayed delivery of grade-B structural bolts',
        reporterName: 'Procurement Specialist'
      });

    expect(postRes.status).toBe(201);
    const blockerId = postRes.body.blocker.id;

    // Verify it is now AT_RISK with active_blocker reason
    const midRiskRes = await request(app)
      .get(`/api/projects/${projectId}/risk-status`)
      .query({ asOfDate: '2026-08-28' });

    const updatedAct = midRiskRes.body.activities.find((a: any) => a.externalId === targetExtId);
    expect(updatedAct.classification).toBe('AT_RISK');
    expect(updatedAct.reasons.some((r: any) => r.code === 'active_blocker')).toBe(true);

    // Resolve the blocker
    const resolveRes = await request(app)
      .patch(`/api/projects/${projectId}/blockers/${blockerId}/resolve`)
      .set(adminAuthHeader(projectId))
      .send({});

    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.blocker.status).toBe('resolved');
    expect(resolveRes.body.blocker.resolvedAt).toBeDefined();

    // Verify risk status restores deterministically back to ON_TRACK
    const finalRiskRes = await request(app)
      .get(`/api/projects/${projectId}/risk-status`)
      .query({ asOfDate: '2026-08-28' });

    const restoredAct = finalRiskRes.body.activities.find((a: any) => a.externalId === targetExtId);
    expect(restoredAct.classification).toBe('ON_TRACK');
    expect(restoredAct.reasons.some((r: any) => r.code === 'active_blocker')).toBe(false);
  });

  it('5. Auditable project events are emitted on blocker report and resolution', async () => {
    // 1. Report blocker
    const reportRes = await request(app)
      .post(`/api/projects/${projectId}/blockers`)
      .set(workerAuthHeader(projectId))
      .send({
        activityId: 'ACT-C01',
        category: 'inspection',
        description: 'Awaiting third-party weld ultrasonic testing signoff',
        reporterName: 'QA/QC Lead'
      });

    expect(reportRes.status).toBe(201);
    expect(reportRes.body.blocker).toBeDefined();
    const blockerId = reportRes.body.blocker.id;

    // Check project events
    const eventsAfterReport = projectEventRepository.listByProjectId(projectId, 200);
    const reportedEvent = eventsAfterReport.find(
      (e) => e.eventType === 'blocker_reported' && e.entityId === blockerId
    );
    expect(reportedEvent).toBeDefined();
    expect(reportedEvent?.summary).toContain('INSPECTION');
    expect(reportedEvent?.summary).toContain('ACT-C01');

    // 2. Resolve blocker
    await request(app)
      .patch(`/api/projects/${projectId}/blockers/${blockerId}/resolve`)
      .set(workerAuthHeader(projectId))
      .send({});

    const eventsAfterResolve = projectEventRepository.listByProjectId(projectId);
    const resolvedEvent = eventsAfterResolve.find(
      (e) => e.eventType === 'blocker_resolved' && e.entityId === blockerId
    );
    expect(resolvedEvent).toBeDefined();
    expect(resolvedEvent?.summary).toContain('INSPECTION');
  });

  it('6. Safety hazard reporting creates an auditable project event', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/safety/hazards`)
      .set(workerAuthHeader(projectId))
      .send({
        workArea: 'Area C — Structural Pipe Rack',
        hazardType: 'Working at Heights',
        description: 'Missing toe board and loose scaffolding coupler at level 3 walkway',
        reporterName: 'David Chen',
        reporterRole: 'Safety Inspector',
        immediateActionTaken: 'Erected hazard warning tape and notified scaffold subcontractor'
      });

    expect(res.status).toBe(201);
    expect(res.body.event).toBeDefined();
    expect(res.body.event.eventType).toBe('safety_hazard_reported');
    expect(res.body.event.summary).toContain('Working at Heights');
    expect(res.body.event.summary).toContain('Area C');

    // Also verify event is persisted in SQLite
    const savedEvent = projectEventRepository.getById(res.body.event.id);
    expect(savedEvent).toBeDefined();
    const payload = JSON.parse(savedEvent!.payloadJson || '{}');
    expect(payload.hazardType).toBe('Working at Heights');
    expect(payload.immediateActionTaken).toContain('Erected hazard warning tape');
  });

  it('7. Primary Dashboard displays active blockers with root-cause category aggregation', async () => {
    // Add two equipment blockers, one access blocker
    await request(app)
      .post(`/api/projects/${projectId}/blockers`)
      .set(workerAuthHeader(projectId))
      .send({
        activityId: 'ACT-C01',
        category: 'equipment',
        description: 'Crane 1 hydraulic issue',
        reporterName: 'Worker A'
      });

    await request(app)
      .post(`/api/projects/${projectId}/blockers`)
      .set(workerAuthHeader(projectId))
      .send({
        activityId: 'ACT-C02',
        category: 'equipment',
        description: 'Welding generator low voltage',
        reporterName: 'Worker B'
      });

    await request(app)
      .post(`/api/projects/${projectId}/blockers`)
      .set(workerAuthHeader(projectId))
      .send({
        category: 'access',
        description: 'Excavation trench blocking east ramp',
        reporterName: 'Worker C'
      });

    const dashRes = await request(app)
      .get(`/api/projects/${projectId}/dashboard`)
      .query({ asOfDate: '2026-08-28' });

    expect(dashRes.status).toBe(200);
    expect(dashRes.body.attention).toBeDefined();
    expect(dashRes.body.attention.activeBlockersCount).toBe(3);
    expect(dashRes.body.attention.activeBlockers).toHaveLength(3);
    expect(dashRes.body.attention.blockersByRootCause).toEqual(
      expect.objectContaining({
        equipment: 2,
        access: 1,
        material: 0
      })
    );
  });

  it('8. Enforces role authorization and strict project isolation', async () => {
    // 8a. Unauthenticated request rejected with HTTP 401
    const unauthRes = await request(app)
      .post(`/api/projects/${projectId}/blockers`)
      .send({
        category: 'weather',
        description: 'High winds',
        reporterName: 'Anonymous'
      });
    expect(unauthRes.status).toBe(401);

    // 8b. Project B worker token cannot access Project A blockers (HTTP 403)
    const crossRes = await request(app)
      .post(`/api/projects/${projectId}/blockers`)
      .set(workerAuthHeader(otherProjectId))
      .send({
        category: 'weather',
        description: 'High winds',
        reporterName: 'Other Worker'
      });
    expect(crossRes.status).toBe(403);

    // 8c. Resolving non-existent blocker returns HTTP 404
    const notFoundRes = await request(app)
      .patch(`/api/projects/${projectId}/blockers/non-existent-id/resolve`)
      .set(adminAuthHeader(projectId))
      .send({});
    expect(notFoundRes.status).toBe(404);
  });
});
