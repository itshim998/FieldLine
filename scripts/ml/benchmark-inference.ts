/**
 * Phase 28 — ML Inference Micro-Benchmark & Artifact Audit Script
 *
 * Measures:
 * 1. Exact byte sizes of production model JSON artifacts.
 * 2. Warm in-memory inference latency for MatchModelService and AnomalyModelService.
 * 3. Distribution metrics: iterations, total duration, mean, median, and p95 (in microseconds).
 *
 * Usage:
 *   npx tsx scripts/ml/benchmark-inference.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MatchModelService } from '../../backend/src/ml/match/match-model.service.js';
import { AnomalyModelService } from '../../backend/src/ml/anomaly/anomaly-model.service.js';
import { MatchFeatureVector, AnomalyFeatureVector } from '../../backend/src/ml/types.js';
import { logger } from '../../backend/src/config/logger.js';

// Silence background logger for clean benchmark output
logger.info = () => {};
logger.debug = () => {};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const matchArtifactPath = path.resolve(repoRoot, 'backend/src/ml/artifacts/match-model.json');
const anomalyArtifactPath = path.resolve(repoRoot, 'backend/src/ml/artifacts/anomaly-model.json');

function getArtifactSizes() {
  const matchSize = fs.statSync(matchArtifactPath).size;
  const anomalySize = fs.statSync(anomalyArtifactPath).size;
  const totalSize = matchSize + anomalySize;
  return { matchSize, anomalySize, totalSize };
}

function runBenchmark() {
  console.log('================================================================');
  console.log('📊 FieldLine Phase 28 — Production ML Runtime & Inference Benchmark');
  console.log('================================================================\n');

  // 1. Artifact Sizes Audit
  const { matchSize, anomalySize, totalSize } = getArtifactSizes();
  console.log('--- 1. Artifact Disk Footprint ---');
  console.log(`  match-model.json   : ${matchSize} bytes (${(matchSize / 1024).toFixed(2)} KB)`);
  console.log(`  anomaly-model.json : ${anomalySize} bytes (${(anomalySize / 1024).toFixed(2)} KB)`);
  console.log(`  Total Artifacts    : ${totalSize} bytes (${(totalSize / 1024).toFixed(2)} KB)`);
  console.log(`  Render Free-Tier Budget (< 100 KB): ${totalSize < 100 * 1024 ? 'PASS (< 100 KB)' : 'FAIL'}`);
  console.log('');

  // 2. Initialize Native TypeScript Services
  const matchService = new MatchModelService({ artifactPath: matchArtifactPath, strict: true });
  const anomalyService = new AnomalyModelService({ artifactPath: anomalyArtifactPath, strict: true });

  if (!matchService.isAvailable() || !anomalyService.isAvailable()) {
    console.error('Failed to initialize ML services');
    process.exit(1);
  }

  const sampleMatchFeatures: MatchFeatureVector = {
    name_similarity: 0.85,
    description_similarity: 0.72,
    location_exact_match: 1.0,
    location_similarity: 1.0,
    location_contradiction: 0.0,
    wbs_match: 1.0,
    exact_id_match: 0.0,
    score_gap_from_second_candidate: 0.28
  };

  const sampleAnomalyFeatures: AnomalyFeatureVector = {
    progress_delta: 12,
    daily_velocity: 12,
    progress_variance: 5,
    reported_percent: 75,
    is_regression: 0
  };

  const WARMUP_RUNS = 1000;
  const BENCHMARK_RUNS = 20000;

  // Warmup JIT
  for (let i = 0; i < WARMUP_RUNS; i++) {
    matchService.predict(sampleMatchFeatures);
    anomalyService.predict(sampleAnomalyFeatures);
  }

  // 3. Benchmark MatchModelService.predict
  const matchTimesNs: bigint[] = new Array(BENCHMARK_RUNS);
  const matchStartTotal = process.hrtime.bigint();
  for (let i = 0; i < BENCHMARK_RUNS; i++) {
    const t0 = process.hrtime.bigint();
    matchService.predict(sampleMatchFeatures);
    const t1 = process.hrtime.bigint();
    matchTimesNs[i] = t1 - t0;
  }
  const matchEndTotal = process.hrtime.bigint();
  const matchTotalDurationMs = Number(matchEndTotal - matchStartTotal) / 1e6;

  // Sort for percentiles
  const matchTimesMicro = matchTimesNs.map(ns => Number(ns) / 1000).sort((a, b) => a - b);
  const matchMeanMicro = matchTimesMicro.reduce((acc, v) => acc + v, 0) / BENCHMARK_RUNS;
  const matchMedianMicro = matchTimesMicro[Math.floor(BENCHMARK_RUNS * 0.5)];
  const matchP95Micro = matchTimesMicro[Math.floor(BENCHMARK_RUNS * 0.95)];

  console.log('--- 2. Match Model Native TS Inference Latency ---');
  console.log(`  Iterations        : ${BENCHMARK_RUNS.toLocaleString()}`);
  console.log(`  Total Duration    : ${matchTotalDurationMs.toFixed(2)} ms`);
  console.log(`  Mean Latency      : ${matchMeanMicro.toFixed(3)} μs`);
  console.log(`  Median Latency    : ${matchMedianMicro.toFixed(3)} μs`);
  console.log(`  p95 Latency       : ${matchP95Micro.toFixed(3)} μs`);
  console.log(`  Engineering Target (< 50 μs): ${matchMeanMicro < 50 ? 'PASS (< 50 μs)' : 'ABOVE TARGET'}`);
  console.log('');

  // 4. Benchmark AnomalyModelService.predict
  const anomalyTimesNs: bigint[] = new Array(BENCHMARK_RUNS);
  const anomalyStartTotal = process.hrtime.bigint();
  for (let i = 0; i < BENCHMARK_RUNS; i++) {
    const t0 = process.hrtime.bigint();
    anomalyService.predict(sampleAnomalyFeatures);
    const t1 = process.hrtime.bigint();
    anomalyTimesNs[i] = t1 - t0;
  }
  const anomalyEndTotal = process.hrtime.bigint();
  const anomalyTotalDurationMs = Number(anomalyEndTotal - anomalyStartTotal) / 1e6;

  const anomalyTimesMicro = anomalyTimesNs.map(ns => Number(ns) / 1000).sort((a, b) => a - b);
  const anomalyMeanMicro = anomalyTimesMicro.reduce((acc, v) => acc + v, 0) / BENCHMARK_RUNS;
  const anomalyMedianMicro = anomalyTimesMicro[Math.floor(BENCHMARK_RUNS * 0.5)];
  const anomalyP95Micro = anomalyTimesMicro[Math.floor(BENCHMARK_RUNS * 0.95)];

  console.log('--- 3. Anomaly Model Native TS Inference Latency ---');
  console.log(`  Iterations        : ${BENCHMARK_RUNS.toLocaleString()}`);
  console.log(`  Total Duration    : ${anomalyTotalDurationMs.toFixed(2)} ms`);
  console.log(`  Mean Latency      : ${anomalyMeanMicro.toFixed(3)} μs`);
  console.log(`  Median Latency    : ${anomalyMedianMicro.toFixed(3)} μs`);
  console.log(`  p95 Latency       : ${anomalyP95Micro.toFixed(3)} μs`);
  console.log(`  Engineering Target (< 50 μs): ${anomalyMeanMicro < 50 ? 'PASS (< 50 μs)' : 'ABOVE TARGET'}`);
  console.log('');

  console.log('================================================================');
  console.log('🎯 SUMMARY CONCLUSION:');
  console.log(`  • Production Runtime: Node 22 (Zero Python dependencies)`);
  console.log(`  • Combined Model Footprint: ${(totalSize / 1024).toFixed(2)} KB (Target: < 100 KB)`);
  console.log(`  • Match Model Average Latency: ${matchMeanMicro.toFixed(3)} μs (Target: < 50 μs)`);
  console.log(`  • Anomaly Model Average Latency: ${anomalyMeanMicro.toFixed(3)} μs (Target: < 50 μs)`);
  console.log('================================================================\n');
}

runBenchmark();
