import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractMatchFeatures } from '../../backend/src/ml/match/match-feature-extractor.js';
import { scoreActivityCandidate } from '../../backend/src/services/matching/activity-match-scoring.js';
import { MatchDatasetRecord, MatchFeatureVector } from '../../backend/src/ml/types.js';
import { Activity } from '../../backend/src/models/domain.types.js';
import { FieldProgressItem } from '../../backend/src/ai/contracts/field-progress-extraction.contract.js';

interface RawObservation {
  targetActivityId: string;
  reference: string;
  location: string | null;
  explicitWbs?: string;
  explicitId?: boolean;
}

// 1. Authoritative 30 REFINERY-U4 activities
export const REFINERY_U4_ACTIVITIES: Activity[] = [
  // Area A — Civil / Earthworks
  {
    id: 'act-a01-uuid',
    projectId: 'refinery-u4-proj',
    scheduleId: 'refinery-u4-sched',
    externalId: 'ACT-A01',
    name: 'Unit 4 Site Clearing & Grubbing',
    description: 'Clearing vegetation, topsoil removal, grubbing roots, and site debris disposal across Unit 4 footprint',
    wbsCode: 'WBS-01.01',
    location: 'Area A',
    plannedStart: '2026-08-01',
    plannedFinish: '2026-08-10',
    plannedQuantity: 5000,
    unit: 'm2',
    baselineProgress: 100,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-28T00:00:00Z'
  },
  {
    id: 'act-a02-uuid',
    projectId: 'refinery-u4-proj',
    scheduleId: 'refinery-u4-sched',
    externalId: 'ACT-A02',
    name: 'Unit 4 Site Rough Grading & Terracing',
    description: 'Bulk cut and fill earthmoving, rough site grading, benching, and terrace embankment stabilization',
    wbsCode: 'WBS-01.02',
    location: 'Area A',
    plannedStart: '2026-08-05',
    plannedFinish: '2026-08-20',
    plannedQuantity: 12000,
    unit: 'm3',
    baselineProgress: 85,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-28T00:00:00Z'
  },
  {
    id: 'act-a03-uuid',
    projectId: 'refinery-u4-proj',
    scheduleId: 'refinery-u4-sched',
    externalId: 'ACT-A03',
    name: 'Stormwater Retention Basin Excavation',
    description: 'Excavation of permanent stormwater retention basin, containment berm shaping, and ditching',
    wbsCode: 'WBS-01.03',
    location: 'Area A',
    plannedStart: '2026-08-10',
    plannedFinish: '2026-08-30',
    plannedQuantity: 4500,
    unit: 'm3',
    baselineProgress: 60,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-28T00:00:00Z'
  },
  {
    id: 'act-a04-uuid',
    projectId: 'refinery-u4-proj',
    scheduleId: 'refinery-u4-sched',
    externalId: 'ACT-A04',
    name: 'Perimeter Access Road Sub-base Compaction',
    description: 'Aggregate sub-base laying, grading, moisture conditioning, and heavy roller compaction for perimeter road',
    wbsCode: 'WBS-01.04',
    location: 'Area A',
    plannedStart: '2026-08-15',
    plannedFinish: '2026-09-05',
    plannedQuantity: 2500,
    unit: 'm',
    baselineProgress: 45,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-28T00:00:00Z'
  },
  {
    id: 'act-a05-uuid',
    projectId: 'refinery-u4-proj',
    scheduleId: 'refinery-u4-sched',
    externalId: 'ACT-A05',
    name: 'Civil Site Preparation Acceptance',
    description: 'Milestone sign-off for complete civil site clearing, benching, drainage, and road subgrade handover',
    wbsCode: 'WBS-01.05',
    location: 'Area A',
    plannedStart: '2026-08-30',
    plannedFinish: '2026-08-30',
    plannedQuantity: 1,
    unit: 'ea',
    baselineProgress: 0,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-28T00:00:00Z'
  },

  // Area B — Foundation
  {
    id: 'act-b01-uuid',
    projectId: 'refinery-u4-proj',
    scheduleId: 'refinery-u4-sched',
    externalId: 'ACT-B01',
    name: 'North Tank Farm Foundation Excavation',
    description: 'Foundation pit excavation for North Tank Farm ringwall foundations and sub-base preparation',
    wbsCode: 'WBS-02.01',
    location: 'Area B',
    plannedStart: '2026-08-05',
    plannedFinish: '2026-08-18',
    plannedQuantity: 3500,
    unit: 'm3',
    baselineProgress: 100,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-28T00:00:00Z'
  },
  {
    id: 'act-b02-uuid',
    projectId: 'refinery-u4-proj',
    scheduleId: 'refinery-u4-sched',
    externalId: 'ACT-B02',
    name: 'Crude Pump Foundation Piling Works',
    description: 'Driving 180 heavy precast concrete and steel friction piles for crude feed pump house foundations',
    wbsCode: 'WBS-02.02',
    location: 'Area B',
    plannedStart: '2026-08-10',
    plannedFinish: '2026-08-24',
    plannedQuantity: 180,
    unit: 'piles',
    baselineProgress: 65,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-28T00:00:00Z'
  },
  {
    id: 'act-b03-uuid',
    projectId: 'refinery-u4-proj',
    scheduleId: 'refinery-u4-sched',
    externalId: 'ACT-B03',
    name: 'Substation Heavy Equipment Mat Foundation',
    description: 'Formwork, reinforcing steel cage assembly, and mass concrete pour for main substation transformer mat',
    wbsCode: 'WBS-02.03',
    location: 'Area B',
    plannedStart: '2026-08-12',
    plannedFinish: '2026-08-31',
    plannedQuantity: 850,
    unit: 'm3',
    baselineProgress: 40,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-28T00:00:00Z'
  },
  {
    id: 'act-b04-uuid',
    projectId: 'refinery-u4-proj',
    scheduleId: 'refinery-u4-sched',
    externalId: 'ACT-B04',
    name: 'Compressor House Deep Foundation Piers',
    description: 'Drilling, rebar cage insertion, and tremie concrete pouring for 40 deep foundation piers',
    wbsCode: 'WBS-02.04',
    location: 'Area B',
    plannedStart: '2026-08-15',
    plannedFinish: '2026-09-10',
    plannedQuantity: 40,
    unit: 'piers',
    baselineProgress: 25,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-28T00:00:00Z'
  },
  {
    id: 'act-b05-uuid',
    projectId: 'refinery-u4-proj',
    scheduleId: 'refinery-u4-sched',
    externalId: 'ACT-B05',
    name: 'Foundation Piling Inspection Sign-Off',
    description: 'QA/QC non-destructive testing, pile load test review, and foundation sign-off milestone',
    wbsCode: 'WBS-02.05',
    location: 'Area B',
    plannedStart: '2026-09-02',
    plannedFinish: '2026-09-02',
    plannedQuantity: 1,
    unit: 'ea',
    baselineProgress: 0,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-28T00:00:00Z'
  },

  // Area C — Structural
  {
    id: 'act-c01-uuid',
    projectId: 'refinery-u4-proj',
    scheduleId: 'refinery-u4-sched',
    externalId: 'ACT-C01',
    name: 'Pipe Rack PR-07 Structural Steel Erection',
    description: 'Erection of main pipe rack PR-07 heavy structural steel bents, longitudinal bracing, and tier beams',
    wbsCode: 'WBS-03.01',
    location: 'Area C',
    plannedStart: '2026-08-10',
    plannedFinish: '2026-08-29',
    plannedQuantity: 320,
    unit: 'ton',
    baselineProgress: 55,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-28T00:00:00Z'
  },
  {
    id: 'act-c02-uuid',
    projectId: 'refinery-u4-proj',
    scheduleId: 'refinery-u4-sched',
    externalId: 'ACT-C02',
    name: 'Main Pipe Bridge Column Splice & Bolting',
    description: 'Heavy crane lifting, column splice alignment, high-strength friction grip torque bolting on pipe bridge',
    wbsCode: 'WBS-03.02',
    location: 'Area C',
    plannedStart: '2026-08-18',
    plannedFinish: '2026-09-05',
    plannedQuantity: 140,
    unit: 'ton',
    baselineProgress: 35,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-28T00:00:00Z'
  },
  {
    id: 'act-c03-uuid',
    projectId: 'refinery-u4-proj',
    scheduleId: 'refinery-u4-sched',
    externalId: 'ACT-C03',
    name: 'Compressor Shelter Superstructure Frame',
    description: 'Assembly of structural columns, roof trusses, crane gantry beams, and purlins for compressor shelter',
    wbsCode: 'WBS-03.03',
    location: 'Area C',
    plannedStart: '2026-08-20',
    plannedFinish: '2026-09-15',
    plannedQuantity: 210,
    unit: 'ton',
    baselineProgress: 20,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-28T00:00:00Z'
  },
  {
    id: 'act-c04-uuid',
    projectId: 'refinery-u4-proj',
    scheduleId: 'refinery-u4-sched',
    externalId: 'ACT-C04',
    name: 'Substation Multi-Tier Cable Support Structure',
    description: 'Galvanized steel framing and vertical support towers for multi-tier cable trays entering substation',
    wbsCode: 'WBS-03.04',
    location: 'Area C',
    plannedStart: '2026-08-22',
    plannedFinish: '2026-09-10',
    plannedQuantity: 85,
    unit: 'ton',
    baselineProgress: 15,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-28T00:00:00Z'
  },
  {
    id: 'act-c05-uuid',
    projectId: 'refinery-u4-proj',
    scheduleId: 'refinery-u4-sched',
    externalId: 'ACT-C05',
    name: 'Major Steel Structure Erection Complete',
    description: 'Plumbness inspection, torque certification, and engineering sign-off for primary structural steel',
    wbsCode: 'WBS-03.05',
    location: 'Area C',
    plannedStart: '2026-09-08',
    plannedFinish: '2026-09-08',
    plannedQuantity: 1,
    unit: 'ea',
    baselineProgress: 0,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-28T00:00:00Z'
  },

  // Area D — Piping
  {
    id: 'act-d01-uuid',
    projectId: 'refinery-u4-proj',
    scheduleId: 'refinery-u4-sched',
    externalId: 'ACT-D01',
    name: 'Cooling Water Underground Header Installation',
    description: 'Installation, trench laying, joint welding, and holiday detection on 36-inch cooling water header',
    wbsCode: 'WBS-04.01',
    location: 'Area D',
    plannedStart: '2026-08-01',
    plannedFinish: '2026-08-16',
    plannedQuantity: 1200,
    unit: 'm',
    baselineProgress: 100,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-28T00:00:00Z'
  },
  {
    id: 'act-d02-uuid',
    projectId: 'refinery-u4-proj',
    scheduleId: 'refinery-u4-sched',
    externalId: 'ACT-D02',
    name: 'Process Pipe Rack Carbon Steel Spooling',
    description: 'Rigging, placing, and bolt-up of prefabricated carbon steel piping spools along process rack PR-07',
    wbsCode: 'WBS-04.02',
    location: 'Area D',
    plannedStart: '2026-08-12',
    plannedFinish: '2026-08-25',
    plannedQuantity: 950,
    unit: 'spools',
    baselineProgress: 50,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-28T00:00:00Z'
  },
  {
    id: 'act-d03-uuid',
    projectId: 'refinery-u4-proj',
    scheduleId: 'refinery-u4-sched',
    externalId: 'ACT-D03',
    name: 'High Pressure Steam Header Tie-in Welds',
    description: 'Full-penetration TIG and SMAW butt welds, preheat, and post-weld heat treatment on HP steam lines',
    wbsCode: 'WBS-04.03',
    location: 'Area D',
    plannedStart: '2026-08-18',
    plannedFinish: '2026-08-30',
    plannedQuantity: 48,
    unit: 'welds',
    baselineProgress: 35,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-28T00:00:00Z'
  },
  {
    id: 'act-d04-uuid',
    projectId: 'refinery-u4-proj',
    scheduleId: 'refinery-u4-sched',
    externalId: 'ACT-D04',
    name: 'Crude Feedstock Line Flange Assembly',
    description: 'Flange bolt makeup, spiral-wound gasket installation, and hydraulic torque tensioning on crude line',
    wbsCode: 'WBS-04.04',
    location: 'Area D',
    plannedStart: '2026-08-20',
    plannedFinish: '2026-09-12',
    plannedQuantity: 120,
    unit: 'joints',
    baselineProgress: 20,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-28T00:00:00Z'
  },
  {
    id: 'act-d05-uuid',
    projectId: 'refinery-u4-proj',
    scheduleId: 'refinery-u4-sched',
    externalId: 'ACT-D05',
    name: 'Flare Header Stainless Steel Line Welding',
    description: 'GTAW stainless steel root pass and filling for 24-inch elevated flare header tie-ins',
    wbsCode: 'WBS-04.05',
    location: 'Area D',
    plannedStart: '2026-08-24',
    plannedFinish: '2026-09-15',
    plannedQuantity: 640,
    unit: 'm',
    baselineProgress: 10,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-28T00:00:00Z'
  },

  // Area E — Electrical / Instrumentation
  {
    id: 'act-e01-uuid',
    projectId: 'refinery-u4-proj',
    scheduleId: 'refinery-u4-sched',
    externalId: 'ACT-E01',
    name: 'Electrical Substation Civil & Trenching Works',
    description: 'Underground electrical duct bank trenching, PVC conduit laying, and concrete encasement around substation',
    wbsCode: 'WBS-05.01',
    location: 'Area E',
    plannedStart: '2026-08-02',
    plannedFinish: '2026-08-15',
    plannedQuantity: 800,
    unit: 'm',
    baselineProgress: 100,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-28T00:00:00Z'
  },
  {
    id: 'act-e02-uuid',
    projectId: 'refinery-u4-proj',
    scheduleId: 'refinery-u4-sched',
    externalId: 'ACT-E02',
    name: 'MCC Room Cable Tray Installation & Earthing',
    description: 'Perforated ladder cable tray mounting, grounding busbar bonding, and equipotential earthing loop',
    wbsCode: 'WBS-05.02',
    location: 'Area E',
    plannedStart: '2026-08-15',
    plannedFinish: '2026-09-02',
    plannedQuantity: 1500,
    unit: 'm',
    baselineProgress: 55,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-28T00:00:00Z'
  },
  {
    id: 'act-e03-uuid',
    projectId: 'refinery-u4-proj',
    scheduleId: 'refinery-u4-sched',
    externalId: 'ACT-E03',
    name: 'High Voltage Feeder Cable Pulling Section 1',
    description: 'Winch pulling of three-core 13.8kV armored XLPE copper power cables through main underground duct bank',
    wbsCode: 'WBS-05.03',
    location: 'Area E',
    plannedStart: '2026-08-20',
    plannedFinish: '2026-09-08',
    plannedQuantity: 3200,
    unit: 'm',
    baselineProgress: 30,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-28T00:00:00Z'
  },
  {
    id: 'act-e04-uuid',
    projectId: 'refinery-u4-proj',
    scheduleId: 'refinery-u4-sched',
    externalId: 'ACT-E04',
    name: 'Instrument Air Header Distribution Tubing',
    description: 'Bending and installing 1/2-inch 316 stainless steel instrument air tubing from main header to field panels',
    wbsCode: 'WBS-05.04',
    location: 'Area E',
    plannedStart: '2026-08-22',
    plannedFinish: '2026-09-12',
    plannedQuantity: 1100,
    unit: 'm',
    baselineProgress: 20,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-28T00:00:00Z'
  },
  {
    id: 'act-e05-uuid',
    projectId: 'refinery-u4-proj',
    scheduleId: 'refinery-u4-sched',
    externalId: 'ACT-E05',
    name: 'Control Room Marshalling Cabinet Termination',
    description: 'Wiring ferrule crimping, terminal strip landing, and point-to-point continuity testing inside cabinets',
    wbsCode: 'WBS-05.05',
    location: 'Area E',
    plannedStart: '2026-08-25',
    plannedFinish: '2026-09-15',
    plannedQuantity: 36,
    unit: 'panels',
    baselineProgress: 15,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-28T00:00:00Z'
  },

  // Area F — Commissioning & Utilities
  {
    id: 'act-f01-uuid',
    projectId: 'refinery-u4-proj',
    scheduleId: 'refinery-u4-sched',
    externalId: 'ACT-F01',
    name: 'Cooling Water Header Flush & Hydrostatic Test',
    description: 'Chemical flushing, filling with treated demin water, pressurization to 15 bar test pressure, and holding period',
    wbsCode: 'WBS-06.01',
    location: 'Area F',
    plannedStart: '2026-08-16',
    plannedFinish: '2026-08-26',
    plannedQuantity: 1,
    unit: 'pkg',
    baselineProgress: 70,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-28T00:00:00Z'
  },
  {
    id: 'act-f02-uuid',
    projectId: 'refinery-u4-proj',
    scheduleId: 'refinery-u4-sched',
    externalId: 'ACT-F02',
    name: 'Unit 4 Hydrotest Package A Pre-Commissioning',
    description: 'Piping punch listing, blind flange isolation, hydrotest manifold setup, and test pack documentation sign-off',
    wbsCode: 'WBS-06.02',
    location: 'Area F',
    plannedStart: '2026-08-24',
    plannedFinish: '2026-09-08',
    plannedQuantity: 1,
    unit: 'pkg',
    baselineProgress: 35,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-28T00:00:00Z'
  },
  {
    id: 'act-f03-uuid',
    projectId: 'refinery-u4-proj',
    scheduleId: 'refinery-u4-sched',
    externalId: 'ACT-F03',
    name: 'Emergency Shutdown Loop Logic Verification',
    description: 'Interlock trip simulation, ESD solenoid valve stroking, safety PLC logic verification and Cause & Effect matrix sign-off',
    wbsCode: 'WBS-06.03',
    location: 'Area F',
    plannedStart: '2026-08-26',
    plannedFinish: '2026-09-14',
    plannedQuantity: 42,
    unit: 'loops',
    baselineProgress: 15,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-28T00:00:00Z'
  },
  {
    id: 'act-f04-uuid',
    projectId: 'refinery-u4-proj',
    scheduleId: 'refinery-u4-sched',
    externalId: 'ACT-F04',
    name: 'Instrument Air Header Leak Testing & Certification',
    description: 'Pneumatic service leak test at 8 bar, snoop bubble inspection on all tubing fittings, and dew point certification',
    wbsCode: 'WBS-06.04',
    location: 'Area F',
    plannedStart: '2026-08-28',
    plannedFinish: '2026-09-18',
    plannedQuantity: 1,
    unit: 'pkg',
    baselineProgress: 10,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-28T00:00:00Z'
  },
  {
    id: 'act-f05-uuid',
    projectId: 'refinery-u4-proj',
    scheduleId: 'refinery-u4-sched',
    externalId: 'ACT-F05',
    name: 'Unit 4 Ready for Startup (RFSU) Milestone',
    description: 'Final pre-commissioning walkthrough, punch list clearance, safety readiness review, and operations handover sign-off',
    wbsCode: 'WBS-06.05',
    location: 'Area F',
    plannedStart: '2026-09-10',
    plannedFinish: '2026-09-10',
    plannedQuantity: 1,
    unit: 'ea',
    baselineProgress: 0,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-28T00:00:00Z'
  }
];

// 2. Hand-authored realistic observations across all 30 activities (5-6 per activity = 165 total)
export const AUTHORED_OBSERVATIONS: RawObservation[] = [
  // ACT-A01 (Clearing & Grubbing)
  { targetActivityId: 'ACT-A01', reference: 'Unit 4 site clearing and grubbing completed for south boundary', location: 'Area A' },
  { targetActivityId: 'ACT-A01', reference: 'Clearing vegetation and root removal across Unit 4 main pad', location: 'Area A' },
  { targetActivityId: 'ACT-A01', reference: 'ACT-A01: finished remaining 500m2 grubbing and topsoil scrape', location: 'Area A', explicitId: true },
  { targetActivityId: 'ACT-A01', reference: 'Bulldozer crew cleared trees and stumps along WBS-01.01', location: null, explicitWbs: 'WBS-01.01' },
  { targetActivityId: 'ACT-A01', reference: 'Site clearing work in progress with two excavators at Area A', location: 'Area A' },
  { targetActivityId: 'ACT-A01', reference: 'Vegetation grubbing and debris loading into haul trucks', location: 'Area A' },

  // ACT-A02 (Rough Grading & Terracing)
  { targetActivityId: 'ACT-A02', reference: 'Bulk cut and fill rough grading on terrace bench 2', location: 'Area A' },
  { targetActivityId: 'ACT-A02', reference: 'Unit 4 Site Rough Grading & Terracing excavation continuing', location: 'Area A' },
  { targetActivityId: 'ACT-A02', reference: 'ACT-A02 grading crew finished 4000m3 embankment cut', location: 'Area A', explicitId: true },
  { targetActivityId: 'ACT-A02', reference: 'Terracing and site leveling at Area A civil package', location: 'Area A' },
  { targetActivityId: 'ACT-A02', reference: 'Rough grading earthmoving operations per WBS-01.02', location: null, explicitWbs: 'WBS-01.02' },
  { targetActivityId: 'ACT-A02', reference: 'Motor grader leveling subgrade on western terrace slopes', location: 'Area A' },

  // ACT-A03 (Stormwater Retention Basin Excavation)
  { targetActivityId: 'ACT-A03', reference: 'Stormwater retention basin excavation reached 2.5m depth', location: 'Area A' },
  { targetActivityId: 'ACT-A03', reference: 'Excavation of permanent drainage retention pond in Area A', location: 'Area A' },
  { targetActivityId: 'ACT-A03', reference: 'ACT-A03 basin digging and berm slope trimming', location: 'Area A', explicitId: true },
  { targetActivityId: 'ACT-A03', reference: 'Stormwater basin trenching and sediment trap shaping WBS-01.03', location: null, explicitWbs: 'WBS-01.03' },
  { targetActivityId: 'ACT-A03', reference: 'Retention basin earthworks with 30T backhoe ongoing', location: 'Area A' },

  // ACT-A04 (Perimeter Access Road Sub-base Compaction)
  { targetActivityId: 'ACT-A04', reference: 'Perimeter access road sub-base compaction passed density tests', location: 'Area A' },
  { targetActivityId: 'ACT-A04', reference: 'Aggregate base coarse spreading and roller compaction along perimeter road', location: 'Area A' },
  { targetActivityId: 'ACT-A04', reference: 'ACT-A04 vibratory roller completed 600m road subbase', location: 'Area A', explicitId: true },
  { targetActivityId: 'ACT-A04', reference: 'Road sub-base compaction per specification WBS-01.04', location: null, explicitWbs: 'WBS-01.04' },
  { targetActivityId: 'ACT-A04', reference: 'Water truck and twin-drum roller compacting access road base', location: 'Area A' },

  // ACT-A05 (Civil Site Preparation Acceptance)
  { targetActivityId: 'ACT-A05', reference: 'Civil site preparation acceptance inspection conducted by client PM', location: 'Area A' },
  { targetActivityId: 'ACT-A05', reference: 'Formal handover walkthrough for civil earthworks package Area A', location: 'Area A' },
  { targetActivityId: 'ACT-A05', reference: 'ACT-A05 sign-off punchlist signed by QA manager', location: 'Area A', explicitId: true },
  { targetActivityId: 'ACT-A05', reference: 'Milestone WBS-01.05 civil earthworks readiness certification', location: null, explicitWbs: 'WBS-01.05' },
  { targetActivityId: 'ACT-A05', reference: 'Civil site prep acceptance certificate submitted for review', location: 'Area A' },

  // ACT-B01 (North Tank Farm Foundation Excavation)
  { targetActivityId: 'ACT-B01', reference: 'North tank farm foundation excavation 100% completed to subgrade', location: 'Area B' },
  { targetActivityId: 'ACT-B01', reference: 'Ringwall foundation pit excavation at north tank farm', location: 'Area B' },
  { targetActivityId: 'ACT-B01', reference: 'ACT-B01 bulk excavation for tank base rings verified', location: 'Area B', explicitId: true },
  { targetActivityId: 'ACT-B01', reference: 'Tank farm foundation trenching WBS-02.01 ready for blinding concrete', location: null, explicitWbs: 'WBS-02.01' },
  { targetActivityId: 'ACT-B01', reference: 'Excavation crew completed tank farm footing earthworks in Area B', location: 'Area B' },

  // ACT-B02 (Crude Pump Foundation Piling Works) [HELD OUT]
  { targetActivityId: 'ACT-B02', reference: 'Pump foundation piles completed to 65% at Area B crude pump bay', location: 'Area B' },
  { targetActivityId: 'ACT-B02', reference: 'Crude pump foundation piling works: driven 36 precast piles today', location: 'Area B' },
  { targetActivityId: 'ACT-B02', reference: 'ACT-B02 hydraulic hammer driving friction piles for pump house', location: 'Area B', explicitId: true },
  { targetActivityId: 'ACT-B02', reference: 'Piling work at crude pump bay per WBS-02.02', location: null, explicitWbs: 'WBS-02.02' },
  { targetActivityId: 'ACT-B02', reference: 'Area B piling rig driving reinforced foundation piles', location: 'Area B' },
  { targetActivityId: 'ACT-B02', reference: 'Dynamic pile testing and restrike measurements on crude pump foundation', location: 'Area B' },

  // ACT-B03 (Substation Heavy Equipment Mat Foundation)
  { targetActivityId: 'ACT-B03', reference: 'Substation heavy equipment mat foundation rebar placement 40% complete', location: 'Area B' },
  { targetActivityId: 'ACT-B03', reference: 'Transformer mat foundation formwork and steel tying in Area B', location: 'Area B' },
  { targetActivityId: 'ACT-B03', reference: 'ACT-B03 poured 250m3 mass concrete for substation equipment pad', location: 'Area B', explicitId: true },
  { targetActivityId: 'ACT-B03', reference: 'Heavy equipment mat foundation WBS-02.03 inspection prior to pour', location: null, explicitWbs: 'WBS-02.03' },
  { targetActivityId: 'ACT-B03', reference: 'Placing rebar mats for high voltage transformer foundation', location: 'Area B' },

  // ACT-B04 (Compressor House Deep Foundation Piers)
  { targetActivityId: 'ACT-B04', reference: 'Drilled 10 of 40 compressor house deep foundation piers', location: 'Area B' },
  { targetActivityId: 'ACT-B04', reference: 'Bored pier drilling and cage lowering for compressor house foundation', location: 'Area B' },
  { targetActivityId: 'ACT-B04', reference: 'ACT-B04 auger rig working on pier cluster 3 in Area B', location: 'Area B', explicitId: true },
  { targetActivityId: 'ACT-B04', reference: 'Tremie concrete pour for deep foundation piers under WBS-02.04', location: null, explicitWbs: 'WBS-02.04' },
  { targetActivityId: 'ACT-B04', reference: 'Compressor foundation drilled shafts casing advancement', location: 'Area B' },

  // ACT-B05 (Foundation Piling Inspection Sign-Off)
  { targetActivityId: 'ACT-B05', reference: 'Foundation piling inspection sign-off documentation submitted to civil consultant', location: 'Area B' },
  { targetActivityId: 'ACT-B05', reference: 'Milestone sign-off for pile driving acceptance in Area B', location: 'Area B' },
  { targetActivityId: 'ACT-B05', reference: 'ACT-B05 integrity testing reports and pile cutoff survey approved', location: 'Area B', explicitId: true },
  { targetActivityId: 'ACT-B05', reference: 'Piling inspection sign-off milestone per WBS-02.05', location: null, explicitWbs: 'WBS-02.05' },
  { targetActivityId: 'ACT-B05', reference: 'Final pile installation cert and load deflection charts verified', location: 'Area B' },

  // ACT-C01 (Pipe Rack PR-07 Structural Steel Erection) [HELD OUT]
  { targetActivityId: 'ACT-C01', reference: 'Pipe Rack PR-07 structural steel erection halted due to 50T crane maintenance', location: 'Area C' },
  { targetActivityId: 'ACT-C01', reference: 'Steel erection on PR-07 pipe rack bays 4 through 8 ongoing', location: 'Area C' },
  { targetActivityId: 'ACT-C01', reference: 'ACT-C01 erected 45 tons of main pipe rack bents and longitudinal bracing', location: 'Area C', explicitId: true },
  { targetActivityId: 'ACT-C01', reference: 'Structural steel framing on PR-07 rack per WBS-03.01', location: null, explicitWbs: 'WBS-03.01' },
  { targetActivityId: 'ACT-C01', reference: 'Ironworkers setting transverse beams on pipe rack PR-07 in Area C', location: 'Area C' },
  { targetActivityId: 'ACT-C01', reference: 'PR-07 steel tier 1 framing and diagonal cross bracing installation', location: 'Area C' },

  // ACT-C02 (Main Pipe Bridge Column Splice & Bolting)
  { targetActivityId: 'ACT-C02', reference: 'Main pipe bridge column splice alignment and bolt tensioning in progress', location: 'Area C' },
  { targetActivityId: 'ACT-C02', reference: 'High strength friction grip bolting on pipe bridge column splices', location: 'Area C' },
  { targetActivityId: 'ACT-C02', reference: 'ACT-C02 torque wrench calibration and splice plate bolting verified', location: 'Area C', explicitId: true },
  { targetActivityId: 'ACT-C02', reference: 'Main pipe bridge steel column splicing per WBS-03.02', location: null, explicitWbs: 'WBS-03.02' },
  { targetActivityId: 'ACT-C02', reference: 'Torque tightening splice connections on 140T bridge columns Area C', location: 'Area C' },

  // ACT-C03 (Compressor Shelter Superstructure Frame)
  { targetActivityId: 'ACT-C03', reference: 'Compressor shelter superstructure frame roof truss lifting initiated', location: 'Area C' },
  { targetActivityId: 'ACT-C03', reference: 'Structural steel columns erected for compressor shelter in Area C', location: 'Area C' },
  { targetActivityId: 'ACT-C03', reference: 'ACT-C03 overhead crane gantry rail steel installed', location: 'Area C', explicitId: true },
  { targetActivityId: 'ACT-C03', reference: 'Compressor building structural steel frame per WBS-03.03', location: null, explicitWbs: 'WBS-03.03' },
  { targetActivityId: 'ACT-C03', reference: 'Purlin and girt assembly on compressor shelter superstructure', location: 'Area C' },

  // ACT-C04 (Substation Multi-Tier Cable Support Structure)
  { targetActivityId: 'ACT-C04', reference: 'Substation multi-tier cable support structure galvanized steel erection', location: 'Area C' },
  { targetActivityId: 'ACT-C04', reference: 'Erecting vertical steel support towers for cable trays outside substation', location: 'Area C' },
  { targetActivityId: 'ACT-C04', reference: 'ACT-C04 bolt-up of multi-tier cable framing completed in Area C', location: 'Area C', explicitId: true },
  { targetActivityId: 'ACT-C04', reference: 'Cable support steel structure per WBS-03.04', location: null, explicitWbs: 'WBS-03.04' },
  { targetActivityId: 'ACT-C04', reference: 'Galvanized cable bridge supports installation for substation feeds', location: 'Area C' },

  // ACT-C05 (Major Steel Structure Erection Complete)
  { targetActivityId: 'ACT-C05', reference: 'Major steel structure erection complete inspection scheduled with chief engineer', location: 'Area C' },
  { targetActivityId: 'ACT-C05', reference: 'Plumbness and verticality sign-off for Area C structural packages', location: 'Area C' },
  { targetActivityId: 'ACT-C05', reference: 'ACT-C05 structural steel completion milestone packet assembled', location: 'Area C', explicitId: true },
  { targetActivityId: 'ACT-C05', reference: 'Major steel erection milestone WBS-03.05 signed off', location: null, explicitWbs: 'WBS-03.05' },
  { targetActivityId: 'ACT-C05', reference: 'Final torque verification audit for structural steel in Area C', location: 'Area C' },

  // ACT-D01 (Cooling Water Underground Header Installation)
  { targetActivityId: 'ACT-D01', reference: 'Cooling water underground header installation 100% finished with 1200m pipe', location: 'Area D' },
  { targetActivityId: 'ACT-D01', reference: '36-inch cooling water header lowered into trench and aligned', location: 'Area D' },
  { targetActivityId: 'ACT-D01', reference: 'ACT-D01 buried cooling water line backfill and compaction done', location: 'Area D', explicitId: true },
  { targetActivityId: 'ACT-D01', reference: 'Underground cooling water pipe laying completed per WBS-04.01', location: null, explicitWbs: 'WBS-04.01' },
  { targetActivityId: 'ACT-D01', reference: 'Holiday testing and cathodic protection anodes installed on CW header', location: 'Area D' },

  // ACT-D02 (Process Pipe Rack Carbon Steel Spooling) [HELD OUT]
  { targetActivityId: 'ACT-D02', reference: 'Process pipe rack carbon steel spooling at 50% along rack PR-07', location: 'Area D' },
  { targetActivityId: 'ACT-D02', reference: 'Rigging and placing CS pipe spools on process rack PR-07 tier 2', location: 'Area D' },
  { targetActivityId: 'ACT-D02', reference: 'ACT-D02 piped 45 carbon steel spools today in Area D', location: 'Area D', explicitId: true },
  { targetActivityId: 'ACT-D02', reference: 'Carbon steel piping spool erection per WBS-04.02', location: null, explicitWbs: 'WBS-04.02' },
  { targetActivityId: 'ACT-D02', reference: 'Pipefitting crew bolting CS flanges on process pipe rack PR-07', location: 'Area D' },
  { targetActivityId: 'ACT-D02', reference: 'Pipe rack carbon steel spool installation and alignment on spring hangers', location: 'Area D' },

  // ACT-D03 (High Pressure Steam Header Tie-in Welds)
  { targetActivityId: 'ACT-D03', reference: 'High pressure steam header tie-in welds: 18 welds completed with radiograph inspection', location: 'Area D' },
  { targetActivityId: 'ACT-D03', reference: 'HP steam line welding and preheating in progress at tie-in point 4', location: 'Area D' },
  { targetActivityId: 'ACT-D03', reference: 'ACT-D03 TIG root pass on 600# steam header joint passed NDT', location: 'Area D', explicitId: true },
  { targetActivityId: 'ACT-D03', reference: 'Steam header field tie-in welding per WBS-04.03', location: null, explicitWbs: 'WBS-04.03' },
  { targetActivityId: 'ACT-D03', reference: 'PWHT post weld heat treatment ongoing on HP steam header welds Area D', location: 'Area D' },

  // ACT-D04 (Crude Feedstock Line Flange Assembly) [HELD OUT]
  { targetActivityId: 'ACT-D04', reference: 'Crude feedstock line flange assembly: bolted and torqued 24 joints', location: 'Area D' },
  { targetActivityId: 'ACT-D04', reference: 'Flange bolt makeup and spiral gasket insertion on crude inlet header', location: 'Area D' },
  { targetActivityId: 'ACT-D04', reference: 'ACT-D04 hydraulic torque tightening on 300# crude flanges', location: 'Area D', explicitId: true },
  { targetActivityId: 'ACT-D04', reference: 'Crude line flange makeup per WBS-04.04', location: null, explicitWbs: 'WBS-04.04' },
  { targetActivityId: 'ACT-D04', reference: 'Flange insulation kits and bolt tensioning on crude feedstock piping', location: 'Area D' },

  // ACT-D05 (Flare Header Stainless Steel Line Welding)
  { targetActivityId: 'ACT-D05', reference: 'Flare header stainless steel line welding reached 65 meters completed', location: 'Area D' },
  { targetActivityId: 'ACT-D05', reference: '24-inch stainless steel flare line butt weld argon purging in Area D', location: 'Area D' },
  { targetActivityId: 'ACT-D05', reference: 'ACT-D05 stainless welding on elevated flare header', location: 'Area D', explicitId: true },
  { targetActivityId: 'ACT-D05', reference: 'Stainless steel flare header welding per WBS-04.05', location: null, explicitWbs: 'WBS-04.05' },
  { targetActivityId: 'ACT-D05', reference: 'Visual and liquid penetrant inspection on flare line SS weldments', location: 'Area D' },

  // ACT-E01 (Electrical Substation Civil & Trenching Works)
  { targetActivityId: 'ACT-E01', reference: 'Electrical substation civil & trenching works 100% completed with concrete encasement', location: 'Area E' },
  { targetActivityId: 'ACT-E01', reference: 'Excavated 800m of duct bank trenches around substation perimeter', location: 'Area E' },
  { targetActivityId: 'ACT-E01', reference: 'ACT-E01 PVC electrical conduit duct bank pour completed', location: 'Area E', explicitId: true },
  { targetActivityId: 'ACT-E01', reference: 'Substation cable trench civil work per WBS-05.01', location: null, explicitWbs: 'WBS-05.01' },
  { targetActivityId: 'ACT-E01', reference: 'Red concrete slurry encasement poured over electrical duct runs in Area E', location: 'Area E' },

  // ACT-E02 (MCC Room Cable Tray Installation & Earthing) [HELD OUT]
  { targetActivityId: 'ACT-E02', reference: 'MCC room cable tray installation & earthing reached 55% completion', location: 'Area E' },
  { targetActivityId: 'ACT-E02', reference: 'Mounted aluminum ladder trays and connected copper grounding bus in MCC room', location: 'Area E' },
  { targetActivityId: 'ACT-E02', reference: 'ACT-E02 earthing loop resistance test measured below 1 ohm in MCC room', location: 'Area E', explicitId: true },
  { targetActivityId: 'ACT-E02', reference: 'Cable tray mounting and equipment earthing per WBS-05.02', location: null, explicitWbs: 'WBS-05.02' },
  { targetActivityId: 'ACT-E02', reference: 'Electricians installed 180m of overhead cable tray in motor control room', location: 'Area E' },
  { targetActivityId: 'ACT-E02', reference: 'Grounding rod cadence and earthing wire exothermic thermite welds verified', location: 'Area E' },

  // ACT-E03 (High Voltage Feeder Cable Pulling Section 1)
  { targetActivityId: 'ACT-E03', reference: 'High voltage feeder cable pulling section 1: pulled 960m of 13.8kV cable', location: 'Area E' },
  { targetActivityId: 'ACT-E03', reference: 'Cable pulling winch set up for medium voltage power feeders in Area E', location: 'Area E' },
  { targetActivityId: 'ACT-E03', reference: 'ACT-E03 pulling 13.8kV three-conductor cable through duct bank 2', location: 'Area E', explicitId: true },
  { targetActivityId: 'ACT-E03', reference: 'HV feeder cable pulling per WBS-05.03', location: null, explicitWbs: 'WBS-05.03' },
  { targetActivityId: 'ACT-E03', reference: 'Cable tension monitoring logs approved for substation feeder pull', location: 'Area E' },

  // ACT-E04 (Instrument Air Header Distribution Tubing)
  { targetActivityId: 'ACT-E04', reference: 'Instrument air header distribution tubing: 220m of 1/2-inch SS tubing installed', location: 'Area E' },
  { targetActivityId: 'ACT-E04', reference: 'Stainless steel instrument tubing bent and clamped to field junction boxes', location: 'Area E' },
  { targetActivityId: 'ACT-E04', reference: 'ACT-E04 instrument air impulse lines ran to pressure transmitters', location: 'Area E', explicitId: true },
  { targetActivityId: 'ACT-E04', reference: 'Instrument air distribution tubing installation per WBS-05.04', location: null, explicitWbs: 'WBS-05.04' },
  { targetActivityId: 'ACT-E04', reference: 'Tubing tray supports and compression fittings installed in Area E', location: 'Area E' },

  // ACT-E05 (Control Room Marshalling Cabinet Termination)
  { targetActivityId: 'ACT-E05', reference: 'Control room marshalling cabinet termination: completed wiring 5 cabinets', location: 'Area E' },
  { targetActivityId: 'ACT-E05', reference: 'Landing I/O field cables and crimping ferrules on marshalling panels', location: 'Area E' },
  { targetActivityId: 'ACT-E05', reference: 'ACT-E05 loop wire tagging and continuity buzzing in control room', location: 'Area E', explicitId: true },
  { targetActivityId: 'ACT-E05', reference: 'Marshalling cabinet wire terminations per WBS-05.05', location: null, explicitWbs: 'WBS-05.05' },
  { targetActivityId: 'ACT-E05', reference: 'DCS marshalling cabinet internal wiring and terminal strip check', location: 'Area E' },

  // ACT-F01 (Cooling Water Header Flush & Hydrostatic Test)
  { targetActivityId: 'ACT-F01', reference: 'Cooling water header flush & hydrostatic test: system filled, pressure holding at 15 bar', location: 'Area F' },
  { targetActivityId: 'ACT-F01', reference: 'Hydrostatic pressure test on cooling water main line Area F', location: 'Area F' },
  { targetActivityId: 'ACT-F01', reference: 'ACT-F01 hydrotest chart recorder installed and calibrated for 4-hour hold', location: 'Area F', explicitId: true },
  { targetActivityId: 'ACT-F01', reference: 'Cooling water header hydrotest per WBS-06.01', location: null, explicitWbs: 'WBS-06.01' },
  { targetActivityId: 'ACT-F01', reference: 'Water flushing of 36-inch header completed with zero debris detected', location: 'Area F' },

  // ACT-F02 (Unit 4 Hydrotest Package A Pre-Commissioning) [HELD OUT]
  { targetActivityId: 'ACT-F02', reference: 'Unit 4 hydrotest package A pre-commissioning walkdown with client completed', location: 'Area F' },
  { targetActivityId: 'ACT-F02', reference: 'Punch listing and test manifold setup for hydrotest pack A pre-commissioning', location: 'Area F' },
  { targetActivityId: 'ACT-F02', reference: 'ACT-F02 blind lists verified and safety relief valve tags inspected', location: 'Area F', explicitId: true },
  { targetActivityId: 'ACT-F02', reference: 'Pre-commissioning test package A sign-off WBS-06.02', location: null, explicitWbs: 'WBS-06.02' },
  { targetActivityId: 'ACT-F02', reference: 'Hydrotest package A pressure test folder and weld traceability checked', location: 'Area F' },

  // ACT-F03 (Emergency Shutdown Loop Logic Verification)
  { targetActivityId: 'ACT-F03', reference: 'Emergency shutdown loop logic verification: checked 6 interlock loops', location: 'Area F' },
  { targetActivityId: 'ACT-F03', reference: 'ESD logic testing and trip solenoid stroking in pre-commissioning', location: 'Area F' },
  { targetActivityId: 'ACT-F03', reference: 'ACT-F03 cause & effect logic matrix verified for high level alarms', location: 'Area F', explicitId: true },
  { targetActivityId: 'ACT-F03', reference: 'Safety loop logic verification per WBS-06.03', location: null, explicitWbs: 'WBS-06.03' },
  { targetActivityId: 'ACT-F03', reference: 'Emergency shutdown valve closure time recorded within 2 seconds', location: 'Area F' },

  // ACT-F04 (Instrument Air Header Leak Testing & Certification)
  { targetActivityId: 'ACT-F04', reference: 'Instrument air header leak testing & certification: pneumatic 8-bar test underway', location: 'Area F' },
  { targetActivityId: 'ACT-F04', reference: 'Snoop bubble leak detection on all instrument air fittings and manifolds', location: 'Area F' },
  { targetActivityId: 'ACT-F04', reference: 'ACT-F04 air header pressure hold test passed with zero pressure drop', location: 'Area F', explicitId: true },
  { targetActivityId: 'ACT-F04', reference: 'Air header leak testing certification per WBS-06.04', location: null, explicitWbs: 'WBS-06.04' },
  { targetActivityId: 'ACT-F04', reference: 'Dew point instrument air cleanliness test passed specification', location: 'Area F' },

  // ACT-F05 (Unit 4 Ready for Startup (RFSU) Milestone)
  { targetActivityId: 'ACT-F05', reference: 'Unit 4 Ready for Startup RFSU milestone pre-audit meeting completed', location: 'Area F' },
  { targetActivityId: 'ACT-F05', reference: 'Operations pre-startup safety review PSSR walkthrough for Unit 4 RFSU', location: 'Area F' },
  { targetActivityId: 'ACT-F05', reference: 'ACT-F05 final handover sign-off package ready for executive committee', location: 'Area F', explicitId: true },
  { targetActivityId: 'ACT-F05', reference: 'Ready for startup milestone documentation WBS-06.05', location: null, explicitWbs: 'WBS-06.05' },
  { targetActivityId: 'ACT-F05', reference: 'All category A punches cleared for Unit 4 ready for startup milestone', location: 'Area F' }
];

/**
 * Compiles the ground-truth match dataset.
 */
export function generateMatchDataset(): MatchDatasetRecord[] {
  const records: MatchDatasetRecord[] = [];
  const activityMap = new Map<string, Activity>();
  for (const act of REFINERY_U4_ACTIVITIES) {
    activityMap.set(act.externalId, act);
  }

  // Pre-calculate deterministic candidate scores for all observations across all activities
  for (const obs of AUTHORED_OBSERVATIONS) {
    const targetActivity = activityMap.get(obs.targetActivityId);
    if (!targetActivity) {
      throw new Error(`Target activity ${obs.targetActivityId} not found in REFINERY_U4_ACTIVITIES`);
    }

    const fact: FieldProgressItem = {
      reference: obs.reference,
      location: obs.location,
      progress_percent: 50,
      status: 'in_progress'
    };

    // Calculate deterministic candidate scores for all 30 activities
    const allCandidateScores = REFINERY_U4_ACTIVITIES.map(act => ({
      activity: act,
      score: scoreActivityCandidate(fact, act).confidenceScore
    })).sort((a, b) => b.score - a.score);

    // 1. Positive candidate pair (true activity)
    const trueCandidate = allCandidateScores.find(c => c.activity.externalId === targetActivity.externalId)!;
    const runnerUpToTrue = allCandidateScores.find(c => c.activity.externalId !== targetActivity.externalId);
    const positiveScoreGap = runnerUpToTrue ? Math.max(0, trueCandidate.score - runnerUpToTrue.score) : 1.0;

    const positiveFeatures = extractMatchFeatures(fact, targetActivity, positiveScoreGap);
    records.push({
      reference: obs.reference,
      location: obs.location,
      activityId: targetActivity.externalId,
      targetActivityId: targetActivity.externalId,
      candidateActivityId: targetActivity.externalId,
      pairType: 'positive',
      features: positiveFeatures,
      label: 1
    });

    // 2. Hard Negative Candidate Pair (same area or top non-true distractor)
    // Filter distractors in the same area or high score
    const sameAreaDistractors = allCandidateScores.filter(
      c => c.activity.externalId !== targetActivity.externalId && c.activity.location === targetActivity.location
    );
    const primaryDistractorCandidate = sameAreaDistractors.length > 0
      ? sameAreaDistractors[0]
      : allCandidateScores.find(c => c.activity.externalId !== targetActivity.externalId)!;

    const distractorRunnerUp = allCandidateScores.find(c => c.activity.externalId !== primaryDistractorCandidate.activity.externalId);
    const hardScoreGap = distractorRunnerUp ? Math.max(0, primaryDistractorCandidate.score - distractorRunnerUp.score) : 0.0;

    const hardNegFeatures = extractMatchFeatures(fact, primaryDistractorCandidate.activity, hardScoreGap);
    records.push({
      reference: obs.reference,
      location: obs.location,
      activityId: primaryDistractorCandidate.activity.externalId,
      targetActivityId: targetActivity.externalId,
      candidateActivityId: primaryDistractorCandidate.activity.externalId,
      pairType: 'hard_negative',
      features: hardNegFeatures,
      label: 0
    });

    // 3. Optional second hard distractor if available in same area
    if (sameAreaDistractors.length > 1) {
      const secondDistractor = sameAreaDistractors[1];
      const secondRunnerUp = allCandidateScores.find(c => c.activity.externalId !== secondDistractor.activity.externalId);
      const secondScoreGap = secondRunnerUp ? Math.max(0, secondDistractor.score - secondRunnerUp.score) : 0.0;
      const secondHardFeatures = extractMatchFeatures(fact, secondDistractor.activity, secondScoreGap);
      records.push({
        reference: obs.reference,
        location: obs.location,
        activityId: secondDistractor.activity.externalId,
        targetActivityId: targetActivity.externalId,
        candidateActivityId: secondDistractor.activity.externalId,
        pairType: 'hard_negative',
        features: secondHardFeatures,
        label: 0
      });
    }

    // 4. Soft Negative Candidate Pair (different area / unrelated package)
    const softDistractors = allCandidateScores.filter(
      c => c.activity.externalId !== targetActivity.externalId && c.activity.location !== targetActivity.location
    );
    if (softDistractors.length > 0) {
      // Pick an unrelated activity
      const softDistractor = softDistractors[softDistractors.length - 1]; // bottom rank or distant area
      const softRunnerUp = allCandidateScores.find(c => c.activity.externalId !== softDistractor.activity.externalId);
      const softScoreGap = softRunnerUp ? Math.max(0, softDistractor.score - softRunnerUp.score) : 0.0;
      const softNegFeatures = extractMatchFeatures(fact, softDistractor.activity, softScoreGap);
      records.push({
        reference: obs.reference,
        location: obs.location,
        activityId: softDistractor.activity.externalId,
        targetActivityId: targetActivity.externalId,
        candidateActivityId: softDistractor.activity.externalId,
        pairType: 'soft_negative',
        features: softNegFeatures,
        label: 0
      });
    }
  }

  return records;
}

// If run as CLI script
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  console.log('Building independent Match Model dataset...');
  const records = generateMatchDataset();

  const outputDir = path.resolve(process.cwd(), 'scripts/ml/datasets');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, 'match_dataset.jsonl');
  const lines = records.map(r => JSON.stringify(r));
  fs.writeFileSync(outputPath, lines.join('\n') + '\n', 'utf-8');

  console.log(`Generated ${records.length} candidate pairs in ${outputPath}`);
  const positives = records.filter(r => r.label === 1).length;
  const hardNegs = records.filter(r => r.pairType === 'hard_negative').length;
  const softNegs = records.filter(r => r.pairType === 'soft_negative').length;
  console.log(`- Positive examples (y=1): ${positives}`);
  console.log(`- Hard negatives (y=0): ${hardNegs}`);
  console.log(`- Soft negatives (y=0): ${softNegs}`);
  console.log(`- Total negative examples (y=0): ${hardNegs + softNegs}`);
}
