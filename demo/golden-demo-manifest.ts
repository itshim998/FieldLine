/**
 * Golden Demo Environment Manifest & Machine-Verifiable Invariants
 * Pass 24 — Presentation Dataset for SIH 2026
 */

export const GOLDEN_AS_OF_DATE = '2026-08-28';

export const goldenProjectManifest = {
  name: 'Refinery Expansion — Unit 4',
  code: 'REFINERY-U4',
  description:
    'Flagship Downstream EPC Refining Expansion covering Civil, Foundation, Structural, Piping, Electrical, and Commissioning Packages'
};

export const goldenWorkAreas = [
  'Area A — Civil / Earthworks',
  'Area B — Foundation',
  'Area C — Structural',
  'Area D — Piping',
  'Area E — Electrical / Instrumentation',
  'Area F — Commissioning & Utilities'
] as const;

export const goldenWorkerCredentials = {
  accountType: 'worker' as const,
  pin: '4444',
  displayName: 'Refinery Operations Crew'
};

export const goldenAdminCredentials = {
  accountType: 'admin' as const,
  password: 'RefineryAdmin2026!',
  displayName: 'Refinery Project Superintendent'
};

export interface GoldenBlockerManifest {
  activityExternalId: string | null;
  category: 'equipment' | 'material' | 'access' | 'inspection' | 'weather' | 'safety' | 'coordination';
  description: string;
  reporterName: string;
  reporterRole: string;
  status: 'active' | 'resolved';
}

export const goldenOperationalBlockers: GoldenBlockerManifest[] = [
  {
    activityExternalId: 'ACT-C01',
    category: 'equipment',
    description: '50T mobile crane down for hydraulic line repair; pipe rack structural steel lifts halted',
    reporterName: 'Carlos Rivera',
    reporterRole: 'Rigging Superintendent',
    status: 'active'
  },
  {
    activityExternalId: 'ACT-B02',
    category: 'weather',
    description: 'Heavy flash rains flooded piling trenches in Area B; de-watering pumps deployed',
    reporterName: 'David Chen',
    reporterRole: 'Civil Works Supervisor',
    status: 'active'
  }
];

export interface GoldenExpectedInvariants {
  projectCode: string;
  projectName: string;
  activityCount: number;
  scheduleCount: number;
  expectedDelayedIds: string[];
  expectedAtRiskIds: string[];
  expectedCompletedIds: string[];
  expectedMilestoneIds: string[];
  expectedBehindScheduleIds: string[];
  expectedApproachingMilestoneIds: string[];
  expectedRichHistoryIds: string[];
  expectedActiveBlockersCount: number;
  expectedBlockerCategories: string[];
  expectedRiskCounts: {
    delayed: number;
    atRisk: number;
    completed: number;
    onTrack: number;
    total: number;
  };
  expectedEvidenceFileNames: string[];
}

export const goldenManifestInvariants: GoldenExpectedInvariants = {
  projectCode: 'REFINERY-U4',
  projectName: 'Refinery Expansion — Unit 4',
  activityCount: 30,
  scheduleCount: 1,
  expectedDelayedIds: ['ACT-A02', 'ACT-B02', 'ACT-D02', 'ACT-F01'],
  expectedAtRiskIds: ['ACT-A03', 'ACT-B03', 'ACT-C01', 'ACT-D03'],
  expectedCompletedIds: ['ACT-A01', 'ACT-B01', 'ACT-D01', 'ACT-E01'],
  expectedMilestoneIds: ['ACT-A05', 'ACT-B05', 'ACT-C05', 'ACT-F05'],
  expectedBehindScheduleIds: [
    'ACT-C01', // -44.74%
    'ACT-D02', // -45%
    'ACT-A02', // -35%
    'ACT-B02', // -35%
    'ACT-F01', // -30%
    'ACT-D03', // -23.33%
    'ACT-B03', // -19.21%
    'ACT-A03'  // -15%
  ],
  expectedApproachingMilestoneIds: ['ACT-A05', 'ACT-B05', 'ACT-C05', 'ACT-F05'],
  expectedRichHistoryIds: ['ACT-B02', 'ACT-C01', 'ACT-E02', 'ACT-B01', 'ACT-A02'],
  expectedActiveBlockersCount: 2,
  expectedBlockerCategories: ['equipment', 'weather'],
  expectedRiskCounts: {
    delayed: 4,
    atRisk: 4,
    completed: 4,
    onTrack: 18,
    total: 30
  },
  expectedEvidenceFileNames: [
    'daily_site_report_2026-08-14.txt',
    'daily_site_report_2026-08-18.txt',
    'civil_progress_update_2026-08-21.csv',
    'weekly_execution_report_2026-08-24.txt',
    'piping_and_electrical_log_2026-08-27.txt',
    'site_inspection_note_2026-08-28.txt'
  ]
};

export interface GoldenHistoryProgression {
  externalId: string;
  name: string;
  area: string;
  milestones: Array<{
    date: string;
    actualPercent: number;
    status: 'not_started' | 'in_progress' | 'completed' | 'delayed';
    reportSummary: string;
  }>;
}

export const goldenRichHistories: GoldenHistoryProgression[] = [
  {
    externalId: 'ACT-B02',
    name: 'Crude Pump Foundation Piling Works',
    area: 'Area B',
    milestones: [
      {
        date: '2026-08-14',
        actualPercent: 20,
        status: 'in_progress',
        reportSummary: 'Crude Pump Foundation Piling Works started, 36 piles driven.'
      },
      {
        date: '2026-08-18',
        actualPercent: 38,
        status: 'in_progress',
        reportSummary: 'Piling works reached 68 piles installed.'
      },
      {
        date: '2026-08-21',
        actualPercent: 52,
        status: 'in_progress',
        reportSummary: 'Rig 2 mobilized, driving rate increased.'
      },
      {
        date: '2026-08-27',
        actualPercent: 65,
        status: 'in_progress',
        reportSummary: '117 of 180 piles installed (65% progress).'
      }
    ]
  },
  {
    externalId: 'ACT-C01',
    name: 'Pipe Rack PR-07 Structural Steel Erection',
    area: 'Area C',
    milestones: [
      {
        date: '2026-08-14',
        actualPercent: 15,
        status: 'in_progress',
        reportSummary: 'PR-07 steel erection commenced with lower column setting.'
      },
      {
        date: '2026-08-21',
        actualPercent: 31,
        status: 'in_progress',
        reportSummary: 'Transverse tie beams connected on Bents 1 to 4.'
      },
      {
        date: '2026-08-27',
        actualPercent: 50,
        status: 'in_progress',
        reportSummary: 'PR-07 structural steel erection reached 50% completion.'
      }
    ]
  },
  {
    externalId: 'ACT-E02',
    name: 'MCC Room Cable Tray Installation & Earthing',
    area: 'Area E',
    milestones: [
      {
        date: '2026-08-18',
        actualPercent: 25,
        status: 'in_progress',
        reportSummary: 'Overhead ladder tray layout started in MCC Room.'
      },
      {
        date: '2026-08-24',
        actualPercent: 48,
        status: 'in_progress',
        reportSummary: 'Grounding copper bus bar and secondary tray runs mounted.'
      },
      {
        date: '2026-08-27',
        actualPercent: 70,
        status: 'in_progress',
        reportSummary: 'Cable tray tiers 1 & 2 fully installed and earthed (70%).'
      }
    ]
  },
  {
    externalId: 'ACT-B01',
    name: 'North Tank Farm Foundation Excavation',
    area: 'Area B',
    milestones: [
      {
        date: '2026-08-14',
        actualPercent: 60,
        status: 'in_progress',
        reportSummary: 'North Tank excavation at 60% bulk volume removal.'
      },
      {
        date: '2026-08-18',
        actualPercent: 100,
        status: 'completed',
        reportSummary: 'North Tank Farm foundation excavation 100% completed.'
      }
    ]
  },
  {
    externalId: 'ACT-A02',
    name: 'Unit 4 Site Rough Grading & Terracing',
    area: 'Area A',
    milestones: [
      {
        date: '2026-08-14',
        actualPercent: 30,
        status: 'in_progress',
        reportSummary: 'Bulk grading and cut-and-fill underway in Area A.'
      },
      {
        date: '2026-08-21',
        actualPercent: 50,
        status: 'in_progress',
        reportSummary: 'Terrace benching 50% complete across slope profile.'
      },
      {
        date: '2026-08-27',
        actualPercent: 65,
        status: 'in_progress',
        reportSummary: 'Rough grading reached 65% (delayed against 08-20 baseline).'
      }
    ]
  }
];
