import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import * as XLSXModule from 'xlsx';
import { runMigrations } from '../src/database/migrator.js';
import { SqliteProjectRepository } from '../src/repositories/project.repository.js';
import { SqliteScheduleRepository } from '../src/repositories/schedule.repository.js';
import { SqliteActivityRepository } from '../src/repositories/activity.repository.js';
import { DefaultScheduleImportService } from '../src/services/schedule-import.service.js';
import { CsvScheduleParser } from '../src/services/importer/csvParser.js';
import { XlsxScheduleParser } from '../src/services/importer/xlsxParser.js';
import { scheduleNormalizer } from '../src/services/normalization/index.js';

const XLSX = (XLSXModule as unknown as { default: typeof XLSXModule }).default || XLSXModule;
const fixturesDir = path.resolve(process.cwd(), 'backend', 'tests', 'fixtures');

describe('Cross-Format Equivalence (CSV vs XLSX Normalization)', () => {
  let db: DatabaseType;
  let projectRepo: SqliteProjectRepository;
  let scheduleRepo: SqliteScheduleRepository;
  let activityRepo: SqliteActivityRepository;
  let importService: DefaultScheduleImportService;
  let projectId: string;

  const csvTestPath = path.join(fixturesDir, 'temp_equiv_test.csv');
  const xlsxTestPath = path.join(fixturesDir, 'temp_equiv_test.xlsx');

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    projectRepo = new SqliteProjectRepository(() => db);
    scheduleRepo = new SqliteScheduleRepository(() => db);
    activityRepo = new SqliteActivityRepository(() => db);
    importService = new DefaultScheduleImportService(
      projectRepo,
      scheduleRepo,
      activityRepo
    );

    const project = projectRepo.create({
      name: 'Equivalence Test Project',
      code: 'EQV-01'
    });
    projectId = project.id;

    // Create CSV with mixed formatting (extra spaces, slash dates, comma quantity, unit aliases)
    const csvContent = [
      'Activity ID,Activity Name,Description,WBS,Location,Start,Finish,Quantity,Unit',
      '  ACT-101  ," Site   Mobilization & Clearing ","Initial site work", 1.1 , Sector A ,2026-03-01,15-Mar-2026,"1,200",sqm',
      'ACT-102,"  Foundation   Excavation  ",,1.2,Sector A,2026/03/16,2026.04.10,"2.5E3",cubic meters',
      'ACT-103,Piling Works,"Pre-cast piling",1.3,,25/04/2026,2026-05-15,85,KGS'
    ].join('\n');
    fs.writeFileSync(csvTestPath, csvContent, 'utf-8');

    // Create XLSX with alternative equivalent formatting (clean text, ISO dates, numeric quantities, canonical units)
    const xlsxData = [
      {
        'Activity ID': 'ACT-101',
        'Activity Name': 'Site Mobilization & Clearing',
        'Description': 'Initial site work',
        'WBS': '1.1',
        'Location': 'Sector A',
        'Start Date': '2026-03-01',
        'Finish Date': '2026-03-15',
        'Quantity': 1200,
        'Unit': 'm2'
      },
      {
        'Activity ID': 'ACT-102',
        'Activity Name': 'Foundation Excavation',
        'Description': null,
        'WBS': '1.2',
        'Location': 'Sector A',
        'Start Date': '2026-03-16',
        'Finish Date': '2026-04-10',
        'Quantity': 2500,
        'Unit': 'm3'
      },
      {
        'Activity ID': 'ACT-103',
        'Activity Name': 'Piling Works',
        'Description': 'Pre-cast piling',
        'WBS': '1.3',
        'Location': '',
        'Start Date': '2026-04-25',
        'Finish Date': '2026-05-15',
        'Quantity': 85,
        'Unit': 'kg'
      }
    ];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(xlsxData);
    XLSX.utils.book_append_sheet(wb, ws, 'Schedule');
    XLSX.writeFile(wb, xlsxTestPath);
  });

  afterEach(() => {
    if (db) db.close();
    if (fs.existsSync(csvTestPath)) fs.unlinkSync(csvTestPath);
    if (fs.existsSync(xlsxTestPath)) fs.unlinkSync(xlsxTestPath);
  });

  it('should parse and normalize CSV and XLSX into EXACTLY equivalent NormalizedScheduleActivity arrays', async () => {
    const csvParser = new CsvScheduleParser();
    const xlsxParser = new XlsxScheduleParser();

    const csvCanonical = await csvParser.parse(csvTestPath, 'temp_equiv_test.csv');
    const xlsxCanonical = await xlsxParser.parse(xlsxTestPath, 'temp_equiv_test.xlsx');

    const csvNormalized = scheduleNormalizer.normalizeScheduleRows(csvCanonical);
    const xlsxNormalized = scheduleNormalizer.normalizeScheduleRows(xlsxCanonical);

    expect(csvNormalized).toEqual(xlsxNormalized);

    expect(csvNormalized).toEqual([
      {
        externalId: 'ACT-101',
        name: 'Site Mobilization & Clearing',
        description: 'Initial site work',
        wbsCode: '1.1',
        location: 'Sector A',
        plannedStart: '2026-03-01',
        plannedFinish: '2026-03-15',
        plannedQuantity: 1200,
        unit: 'm2',
        baselineProgress: 0.0
      },
      {
        externalId: 'ACT-102',
        name: 'Foundation Excavation',
        description: null,
        wbsCode: '1.2',
        location: 'Sector A',
        plannedStart: '2026-03-16',
        plannedFinish: '2026-04-10',
        plannedQuantity: 2500,
        unit: 'm3',
        baselineProgress: 0.0
      },
      {
        externalId: 'ACT-103',
        name: 'Piling Works',
        description: 'Pre-cast piling',
        wbsCode: '1.3',
        location: null,
        plannedStart: '2026-04-25',
        plannedFinish: '2026-05-15',
        plannedQuantity: 85,
        unit: 'kg',
        baselineProgress: 0.0
      }
    ]);
  });

  it('should persist identical normalized activity records in SQLite whether imported from CSV or XLSX', async () => {
    // Import CSV into Project 1
    const csvImportCopy = path.join(fixturesDir, 'temp_csv_import.csv');
    fs.copyFileSync(csvTestPath, csvImportCopy);

    const csvResult = await importService.importSchedule(projectId, {
      path: csvImportCopy,
      originalname: 'schedule_from_csv.csv',
      mimetype: 'text/csv'
    });

    // Create Project 2 and import XLSX
    const proj2 = projectRepo.create({
      name: 'Project 2 for XLSX',
      code: 'EQV-02'
    });

    const xlsxImportCopy = path.join(fixturesDir, 'temp_xlsx_import.xlsx');
    fs.copyFileSync(xlsxTestPath, xlsxImportCopy);

    const xlsxResult = await importService.importSchedule(proj2.id, {
      path: xlsxImportCopy,
      originalname: 'schedule_from_xlsx.xlsx',
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });

    const csvActivities = activityRepo.listByScheduleId(csvResult.schedule.id);
    const xlsxActivities = activityRepo.listByScheduleId(xlsxResult.schedule.id);

    expect(csvActivities).toHaveLength(3);
    expect(xlsxActivities).toHaveLength(3);

    // Verify field-by-field equivalence (ignoring generated primary keys and schedule/project IDs)
    for (let i = 0; i < 3; i++) {
      expect(csvActivities[i].externalId).toBe(xlsxActivities[i].externalId);
      expect(csvActivities[i].name).toBe(xlsxActivities[i].name);
      expect(csvActivities[i].description).toBe(xlsxActivities[i].description);
      expect(csvActivities[i].wbsCode).toBe(xlsxActivities[i].wbsCode);
      expect(csvActivities[i].location).toBe(xlsxActivities[i].location);
      expect(csvActivities[i].plannedStart).toBe(xlsxActivities[i].plannedStart);
      expect(csvActivities[i].plannedFinish).toBe(xlsxActivities[i].plannedFinish);
      expect(csvActivities[i].plannedQuantity).toBe(xlsxActivities[i].plannedQuantity);
      expect(csvActivities[i].unit).toBe(xlsxActivities[i].unit);
      expect(csvActivities[i].baselineProgress).toBe(xlsxActivities[i].baselineProgress);
    }
  });

  it('should produce equivalent validation errors for equivalent invalid CSV and XLSX datasets', async () => {
    const csvBadPath = path.join(fixturesDir, 'temp_bad_equiv.csv');
    const xlsxBadPath = path.join(fixturesDir, 'temp_bad_equiv.xlsx');

    const badCsvContent = [
      'Activity ID,Activity Name,Start Date,Finish Date,Quantity,Baseline Progress',
      'ACT-001,Paving,2026-06-10,2026-06-01,-20,120',
      'ACT-001,Excavation,2026-07-01,2026-07-15,100,50'
    ].join('\n');
    fs.writeFileSync(csvBadPath, badCsvContent, 'utf-8');

    const badXlsxData = [
      {
        'Activity ID': 'ACT-001',
        'Activity Name': 'Paving',
        'Start Date': '2026-06-10',
        'Finish Date': '2026-06-01',
        'Quantity': -20,
        'Baseline Progress': 120
      },
      {
        'Activity ID': 'ACT-001',
        'Activity Name': 'Excavation',
        'Start Date': '2026-07-01',
        'Finish Date': '2026-07-15',
        'Quantity': 100,
        'Baseline Progress': 50
      }
    ];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(badXlsxData);
    XLSX.utils.book_append_sheet(wb, ws, 'Schedule');
    XLSX.writeFile(wb, xlsxBadPath);

    try {
      const csvParser = new CsvScheduleParser();
      const xlsxParser = new XlsxScheduleParser();

      const csvRows = await csvParser.parse(csvBadPath, 'bad.csv');
      const xlsxRows = await xlsxParser.parse(xlsxBadPath, 'bad.xlsx');

      const csvNorm = scheduleNormalizer.normalizeScheduleRows(csvRows);
      const xlsxNorm = scheduleNormalizer.normalizeScheduleRows(xlsxRows);

      const { scheduleValidator } = await import('../src/services/validation/index.js');
      const csvValidation = scheduleValidator.validateSchedule(csvNorm);
      const xlsxValidation = scheduleValidator.validateSchedule(xlsxNorm);

      expect(csvValidation.isValid).toBe(false);
      expect(xlsxValidation.isValid).toBe(false);
      expect(csvValidation.issues).toEqual(xlsxValidation.issues);
    } finally {
      if (fs.existsSync(csvBadPath)) fs.unlinkSync(csvBadPath);
      if (fs.existsSync(xlsxBadPath)) fs.unlinkSync(xlsxBadPath);
    }
  });
});

