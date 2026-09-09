/**
 * Anomaly Dataset Builder (Phase 14)
 *
 * Generates scripts/ml/datasets/anomaly_dataset.jsonl containing:
 * 1. FieldLine-domain normal progression profiles derived from REFINERY-U4 schedule activities,
 *    covering continuous pacing transitions and minor survey/measurement reconciliations.
 * 2. Controlled synthetic perturbation simulation cases (moderate/severe regressions, extreme jumps)
 *    used strictly for boundary calibration and evaluation.
 *
 * All records carry explicit disclosure metadata. Normal records are marked is_normal: true.
 * Extreme synthetic anomalies are marked is_normal: false and must NOT be used to fit the
 * baseline parameters (mean, std, d95).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REFINERY_U4_ACTIVITIES } from './build_match_dataset.js';
import { calculatePlannedProgress, diffInCalendarDays } from '../../backend/src/services/snapshot/progress-snapshot.calculator.js';
import { AnomalyFeatureVector } from '../../backend/src/ml/types.js';

export interface AnomalyDatasetRecord {
  id: string;
  activityId: string;
  activityName: string;
  scenario: string;
  is_normal: boolean;
  features: AnomalyFeatureVector;
  context: {
    reported_percent: number;
    previous_percent: number;
    days_since_update: number;
    planned_percent: number;
    as_of_date: string;
  };
  disclosure: string;
}

export function generateAnomalyDataset(): AnomalyDatasetRecord[] {
  const records: AnomalyDatasetRecord[] = [];
  let recordIdCounter = 1;

  function addRecord(
    activityId: string,
    activityName: string,
    scenario: string,
    isNormal: boolean,
    reportedPercent: number,
    previousPercent: number,
    daysSinceUpdate: number,
    plannedPercent: number,
    asOfDate: string,
    disclosure: string
  ) {
    const delta = Math.round((reportedPercent - previousPercent) * 100) / 100;
    const daysClamped = Math.max(1, daysSinceUpdate);
    const velocity = Math.round((delta / daysClamped) * 100) / 100;
    const variance = Math.round((reportedPercent - plannedPercent) * 100) / 100;
    const isRegression = delta < 0 ? 1.0 : 0.0;

    records.push({
      id: `ANOM-${String(recordIdCounter++).padStart(4, '0')}`,
      activityId,
      activityName,
      scenario,
      is_normal: isNormal,
      features: {
        progress_delta: delta,
        daily_velocity: velocity,
        progress_variance: variance,
        reported_percent: reportedPercent,
        is_regression: isRegression
      },
      context: {
        reported_percent: reportedPercent,
        previous_percent: previousPercent,
        days_since_update: daysClamped,
        planned_percent: plannedPercent,
        as_of_date: asOfDate
      },
      disclosure
    });
  }

  // -------------------------------------------------------------------------
  // 1. Normal Progression Profiles (FieldLine Domain: REFINERY-U4)
  // -------------------------------------------------------------------------
  // Generate multi-cadence progression profiles across the 30 activities
  // representing daily updates, 2-3 day shifts, and weekly milestone checks
  for (const act of REFINERY_U4_ACTIVITIES) {
    const totalDays = diffInCalendarDays(act.plannedStart, act.plannedFinish);
    if (totalDays <= 0) continue;

    // Reporting cadence: sample at 1-day, 2-day, 3-day, and 5-day intervals
    const cadences = [1, 2, 3, 5];
    let prevPercent = 0;
    let prevDay = 0;

    let day = 1;
    let cadenceIdx = 0;
    while (day <= totalDays) {
      const daysDelta = Math.min(cadences[cadenceIdx % cadences.length], totalDays - prevDay);
      if (daysDelta <= 0) break;
      day = prevDay + daysDelta;
      cadenceIdx++;

      // Expected progress based on linear pacing across duration
      const expectedLinearProgress = (day / totalDays) * 100;
      // Slight natural variance between -5% and +5%
      const naturalVariance = ((day % 5) - 2) * 1.5;
      const reportedPercent = Math.min(100, Math.max(prevPercent + 0.5, Math.round(expectedLinearProgress + naturalVariance)));

      const currentDateObj = new Date(act.plannedStart);
      currentDateObj.setUTCDate(currentDateObj.getUTCDate() + day);
      const asOfDate = currentDateObj.toISOString().slice(0, 10);

      const { plannedProgress } = calculatePlannedProgress(act.plannedStart, act.plannedFinish, asOfDate);

      addRecord(
        act.externalId,
        act.name,
        'normal_pacing_transition',
        true,
        reportedPercent,
        prevPercent,
        daysDelta,
        plannedProgress,
        asOfDate,
        'FieldLine-domain normal progression profile from REFINERY-U4 baseline schedule.'
      );

      prevPercent = reportedPercent;
      prevDay = day;
      if (reportedPercent >= 100) break;
    }
  }

  // -------------------------------------------------------------------------
  // 2. Normal Minor Reconciliation Adjustments (Survey / Measurement Revisions)
  // -------------------------------------------------------------------------
  // Small negative adjustments (-0.5% to -3% over 1-4 days) that regularly occur
  // during site survey cross-checks. These are normal operational corrections, NOT anomalies.
  const reconciliationCases = [
    { extId: 'ACT-A01', name: 'Site Clearing & Grubbing', rep: 83, prev: 85, days: 3, plan: 85, date: '2026-08-08' },
    { extId: 'ACT-A02', name: 'Rough Grading & Terracing', rep: 59, prev: 60, days: 2, plan: 60, date: '2026-08-14' },
    { extId: 'ACT-A03', name: 'Stormwater Retention Basin Excavation', rep: 38, prev: 40, days: 2, plan: 40, date: '2026-08-12' },
    { extId: 'ACT-A04', name: 'Perimeter Access Road Compaction', rep: 44, prev: 46, days: 3, plan: 45, date: '2026-08-15' },
    { extId: 'ACT-B01', name: 'North Tank Farm Foundation Excavation', rep: 78, prev: 80, days: 2, plan: 80, date: '2026-08-16' },
    { extId: 'ACT-B02', name: 'Crude Pump Foundation Piling', rep: 37, prev: 38, days: 3, plan: 38, date: '2026-08-19' },
    { extId: 'ACT-B03', name: 'Compressor House Raft Concrete', rep: 63, prev: 65, days: 2, plan: 65, date: '2026-08-20' },
    { extId: 'ACT-B04', name: 'Cooling Tower Basin Retaining Wall', rep: 72, prev: 74, days: 2, plan: 74, date: '2026-08-22' },
    { extId: 'ACT-C01', name: 'Pipe Rack PR-07 Steel', rep: 69, prev: 70, days: 2, plan: 70, date: '2026-08-23' },
    { extId: 'ACT-C02', name: 'Flare Knockout Drum Structure', rep: 53, prev: 55, days: 3, plan: 55, date: '2026-08-22' },
    { extId: 'ACT-C03', name: 'Substation Control Building Structural Steel', rep: 48, prev: 50, days: 2, plan: 50, date: '2026-08-24' },
    { extId: 'ACT-D01', name: 'Cooling Water Underground Header Installation', rep: 88, prev: 90, days: 2, plan: 90, date: '2026-08-18' },
    { extId: 'ACT-D02', name: 'Process Pipe Rack CS Spooling', rep: 46, prev: 48, days: 3, plan: 48, date: '2026-08-25' },
    { extId: 'ACT-D03', name: 'Utility Air & Nitrogen Headers', rep: 33, prev: 35, days: 2, plan: 35, date: '2026-08-21' },
    { extId: 'ACT-D04', name: 'Crude Feedstock Line Flange & Tie-in', rep: 28, prev: 30, days: 2, plan: 30, date: '2026-08-26' },
    { extId: 'ACT-E01', name: 'Electrical Substation Civil & Trenching Works', rep: 78, prev: 80, days: 2, plan: 80, date: '2026-08-17' },
    { extId: 'ACT-E02', name: 'MCC Room Cable Tray Installation & Earthing', rep: 24, prev: 25, days: 2, plan: 25, date: '2026-08-20' },
    { extId: 'ACT-E03', name: 'Main Power Feeder 11kV Cable Pulling', rep: 43, prev: 45, days: 3, plan: 45, date: '2026-08-23' },
    { extId: 'ACT-E04', name: 'Field Instrument Junction Boxes & Glanding', rep: 33, prev: 35, days: 2, plan: 35, date: '2026-08-24' },
    { extId: 'ACT-F01', name: 'Pre-Commissioning Flushing', rep: 49, prev: 50, days: 2, plan: 50, date: '2026-08-26' }
  ];

  for (const rc of reconciliationCases) {
    addRecord(
      rc.extId,
      rc.name,
      'normal_survey_reconciliation',
      true,
      rc.rep,
      rc.prev,
      rc.days,
      rc.plan,
      rc.date,
      'Normal small survey/measurement reconciliation adjustment consistent with baseline variance.'
    );
  }


  // -------------------------------------------------------------------------
  // 3. Controlled Synthetic Anomalous Perturbations (Calibration & Evaluation)
  // -------------------------------------------------------------------------
  // These records are marked is_normal: false. They must NOT be used to compute
  // normal baseline means/stds/d95. They verify boundary calibration.

  // 3a. Moderate unusual regressions (expected to trigger 'review' band: score 0.50 - 0.75)
  const moderateRegressions = [
    { extId: 'ACT-A02', name: 'Rough Grading & Terracing', rep: 45, prev: 58, days: 2, plan: 62, date: '2026-08-15' },
    { extId: 'ACT-B02', name: 'Crude Pump Foundation Piling', rep: 24, prev: 38, days: 3, plan: 42, date: '2026-08-20' },
    { extId: 'ACT-C02', name: 'Flare Knockout Drum Structure', rep: 50, prev: 65, days: 2, plan: 70, date: '2026-08-24' },
    { extId: 'ACT-D03', name: 'Utility Air & Nitrogen Headers', rep: 32, prev: 46, days: 3, plan: 50, date: '2026-08-23' },
    { extId: 'ACT-E03', name: 'Main Power Feeder 11kV Pulling', rep: 40, prev: 55, days: 2, plan: 60, date: '2026-08-25' }
  ];

  for (const mr of moderateRegressions) {
    addRecord(
      mr.extId,
      mr.name,
      'synthetic_moderate_regression',
      false,
      mr.rep,
      mr.prev,
      mr.days,
      mr.plan,
      mr.date,
      'Controlled synthetic simulation: moderate unusual progress regression for review boundary calibration.'
    );
  }

  // 3b. Severe regressions (expected to trigger 'high' band: score >= 0.75)
  const severeRegressions = [
    { extId: 'ACT-B01', name: 'North Tank Farm Foundation Excavation', rep: 30, prev: 85, days: 1, plan: 90, date: '2026-08-16' },
    { extId: 'ACT-B03', name: 'Compressor House Raft Concrete', rep: 20, prev: 70, days: 2, plan: 75, date: '2026-08-24' },
    { extId: 'ACT-C01', name: 'Pipe Rack PR-07 Steel', rep: 15, prev: 65, days: 1, plan: 70, date: '2026-08-22' },
    { extId: 'ACT-D01', name: 'Cooling Water Underground Header', rep: 35, prev: 90, days: 2, plan: 95, date: '2026-08-20' },
    { extId: 'ACT-E01', name: 'Electrical Substation Civil & Trenching', rep: 25, prev: 80, days: 1, plan: 85, date: '2026-08-18' }
  ];

  for (const sr of severeRegressions) {
    addRecord(
      sr.extId,
      sr.name,
      'synthetic_severe_regression',
      false,
      sr.rep,
      sr.prev,
      sr.days,
      sr.plan,
      sr.date,
      'Controlled synthetic simulation: severe unannounced progress regression for high-priority anomaly calibration.'
    );
  }

  // 3c. Unusually large positive single-interval jumps (excessive daily velocity)
  const extremeJumps = [
    { extId: 'ACT-A03', name: 'Stormwater Retention Basin Excavation', rep: 85, prev: 20, days: 1, plan: 40, date: '2026-08-12' },
    { extId: 'ACT-B02', name: 'Crude Pump Foundation Piling', rep: 95, prev: 35, days: 1, plan: 50, date: '2026-08-21' },
    { extId: 'ACT-C03', name: 'Substation Control Building Structural Steel', rep: 90, prev: 25, days: 1, plan: 45, date: '2026-08-20' },
    { extId: 'ACT-D02', name: 'Process Pipe Rack CS Spooling', rep: 90, prev: 30, days: 1, plan: 50, date: '2026-08-26' },
    { extId: 'ACT-E04', name: 'Field Instrument Junction Boxes', rep: 95, prev: 25, days: 1, plan: 40, date: '2026-08-27' }
  ];

  for (const ej of extremeJumps) {
    addRecord(
      ej.extId,
      ej.name,
      'synthetic_extreme_velocity_jump',
      false,
      ej.rep,
      ej.prev,
      ej.days,
      ej.plan,
      ej.date,
      'Controlled synthetic simulation: extreme single-interval progress jump for high-priority pacing anomaly calibration.'
    );
  }

  return records;
}

export function writeAnomalyDataset(): void {
  const currentFilePath = fileURLToPath(import.meta.url);
  const currentDir = path.dirname(currentFilePath);
  const outputDir = path.join(currentDir, 'datasets');
  const outputPath = path.join(outputDir, 'anomaly_dataset.jsonl');

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const records = generateAnomalyDataset();
  const normalCount = records.filter(r => r.is_normal).length;
  const syntheticCount = records.filter(r => !r.is_normal).length;

  const content = records.map(r => JSON.stringify(r)).join('\n') + '\n';
  fs.writeFileSync(outputPath, content, 'utf-8');

  console.log(`Successfully generated anomaly dataset at: ${outputPath}`);
  console.log(`Total records: ${records.length}`);
  console.log(`  Normal baseline profiles : ${normalCount} (used for fitting baseline mean/std/d95)`);
  console.log(`  Synthetic calibration/test: ${syntheticCount} (excluded from baseline parameter fitting)`);
}

// Execute when run directly via tsx
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  writeAnomalyDataset();
}
