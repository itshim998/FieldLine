import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createMLRouter } from '../src/routes/ml.router.js';
import { MatchModelService } from '../src/ml/match/match-model.service.js';
import { AnomalyModelService } from '../src/ml/anomaly/anomaly-model.service.js';
import { createApp } from '../src/app.js';
import { initDatabase, closeDatabase } from '../src/database/db.js';

describe('Phase 22 & 24 — ML Status Endpoint Vitest Suite', () => {
  describe('Production System Health', () => {
    let app: ReturnType<typeof createApp>;

    beforeEach(() => {
      initDatabase({ dbPath: ':memory:' });
      app = createApp();
    });

    afterEach(() => {
      closeDatabase();
    });

    it('GET /api/ml/status returns healthy status and metadata for both loaded models', async () => {
      const res = await request(app).get('/api/ml/status');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('healthy');

      const models = res.body.models;
      expect(models).toBeDefined();

      // Match Model metadata
      expect(models.matchModel.loaded).toBe(true);
      expect(models.matchModel.version).toBe('1.0.0');
      expect(models.matchModel.type).toBe('logistic_regression');
      expect(models.matchModel.featureCount).toBe(8);

      // Anomaly Model metadata
      expect(models.anomalyModel.loaded).toBe(true);
      expect(models.anomalyModel.version).toBe('1.0.0');
      expect(models.anomalyModel.type).toBe('standardized_distance_anomaly');
      expect(models.anomalyModel.featureCount).toBe(5);
    });
  });

  describe('Degraded and Fallback Handling', () => {
    it('returns degraded status when Match Model is unavailable', async () => {
      const mockMatchService = {
        isAvailable: () => false,
        getArtifact: () => null
      } as unknown as MatchModelService;

      const mockAnomalyService = {
        isAvailable: () => true,
        getArtifact: () => ({
          modelType: 'standardized_distance_anomaly',
          version: '1.0.0',
          featureNames: ['a', 'b', 'c', 'd', 'e']
        })
      } as unknown as AnomalyModelService;

      const app = express();
      app.use('/api', createMLRouter({
        matchModelService: mockMatchService,
        anomalyModelService: mockAnomalyService
      }));

      const res = await request(app).get('/api/ml/status');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('degraded');
      expect(res.body.models.matchModel.loaded).toBe(false);
      expect(res.body.models.anomalyModel.loaded).toBe(true);
    });

    it('returns unavailable status when both models are unavailable', async () => {
      const mockMatchService = {
        isAvailable: () => false,
        getArtifact: () => null
      } as unknown as MatchModelService;

      const mockAnomalyService = {
        isAvailable: () => false,
        getArtifact: () => null
      } as unknown as AnomalyModelService;

      const app = express();
      app.use('/api', createMLRouter({
        matchModelService: mockMatchService,
        anomalyModelService: mockAnomalyService
      }));

      const res = await request(app).get('/api/ml/status');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('unavailable');
      expect(res.body.models.matchModel.loaded).toBe(false);
      expect(res.body.models.anomalyModel.loaded).toBe(false);
    });
  });
});
