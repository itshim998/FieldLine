import { FieldProgressExtraction } from '../../src/ai/contracts/field-progress-extraction.contract.js';

export const GOLDEN_AS_OF_DATE = '2026-08-20';

export const goldenProject = {
  name: 'Metro Transit Hub Package A',
  code: 'MTH-PKG-A',
  description: 'Multimodal transportation interchange and subway extension'
};

export const goldenScheduleCsv = [
  'Activity ID,Activity Name,WBS,Location,Planned Start,Planned Finish,Planned Quantity,Unit',
  'ACT-101,Site Earthworks & Clearing,WBS-01,Sector 1,2026-08-01,2026-08-10,1000,m3',
  'ACT-102,Foundation Piling Block 1,WBS-02,Block 1,2026-08-01,2026-08-25,500,m3',
  'ACT-103,Underground Drainage Conduit,WBS-03,Zone A,2026-08-01,2026-08-20,300,m',
  'ACT-104,Structural Pier Concrete Pouring,WBS-04,Pier 4,2026-08-01,2026-08-30,800,m3',
  'ACT-105,Substructure Phase Safety Sign-Off,WBS-05,Main Site,2026-08-26,2026-08-26,1,ea',
  'ACT-106,Auxiliary Electrical Ducting,WBS-06,Zone B,2026-08-25,2026-08-30,400,m'
].join('\n');

export const goldenFieldReportText = [
  'Daily Field Inspection Log',
  'Date: 2026-08-20',
  'Inspector: Chief Resident Engineer',
  'Project: Metro Transit Hub Package A',
  '',
  'Observed Progress Notes:',
  '1. Site Earthworks & Clearing at Sector 1 is 40% complete.',
  '2. Foundation Piling Block 1 is currently at 50% progress.',
  '3. Underground Drainage Conduit at Zone A has reached 100% completion today.',
  '4. Structural Pier Concrete Pouring is progressing at 60%.',
  '5. General site clearing and debris removal ongoing around perimeter.'
].join('\n');

export const goldenExtraction: FieldProgressExtraction = {
  items: [
    {
      reference: 'Site Earthworks & Clearing',
      location: 'Sector 1',
      progress_percent: 40,
      status: 'in_progress'
    },
    {
      reference: 'Foundation Piling Block 1',
      location: 'Block 1',
      progress_percent: 50,
      status: 'in_progress'
    },
    {
      reference: 'Underground Drainage Conduit',
      location: 'Zone A',
      progress_percent: 100,
      status: 'completed'
    },
    {
      reference: 'Structural Pier Concrete Pouring',
      location: 'Pier 4',
      progress_percent: 60,
      status: 'in_progress'
    },
    {
      reference: 'General site clearing and debris removal',
      location: null,
      progress_percent: null,
      status: 'in_progress'
    }
  ]
};

export const goldenExpectedSnapshot = {
  summary: {
    totalActivities: 6,
    completed: 1,
    delayed: 1,
    overdue: 1,
    overallActualProgress: 41.67,
    overallPlannedProgress: 57.45,
    progressVariance: -15.78,
    varianceState: 'behind'
  },
  activities: [
    {
      externalId: 'ACT-101',
      plannedProgress: 100,
      actualProgress: 40,
      progressVariance: -60,
      varianceState: 'behind',
      overdue: true,
      status: 'in_progress'
    },
    {
      externalId: 'ACT-102',
      plannedProgress: 79.17,
      actualProgress: 50,
      progressVariance: -29.17,
      varianceState: 'behind',
      overdue: false,
      status: 'in_progress'
    },
    {
      externalId: 'ACT-103',
      plannedProgress: 100,
      actualProgress: 100,
      progressVariance: 0,
      varianceState: 'on_plan',
      overdue: false,
      status: 'completed'
    },
    {
      externalId: 'ACT-104',
      plannedProgress: 65.52,
      actualProgress: 60,
      progressVariance: -5.52,
      varianceState: 'behind',
      overdue: false,
      status: 'in_progress'
    },
    {
      externalId: 'ACT-105',
      plannedProgress: 0,
      actualProgress: 0,
      progressVariance: 0,
      varianceState: 'on_plan',
      overdue: false,
      status: 'not_started'
    },
    {
      externalId: 'ACT-106',
      plannedProgress: 0,
      actualProgress: 0,
      progressVariance: 0,
      varianceState: 'on_plan',
      overdue: false,
      status: 'not_started'
    }
  ]
};

export const goldenExpectedRisks = {
  summary: {
    totalActivities: 6,
    onTrack: 3,
    ahead: 0,
    atRisk: 1,
    delayed: 1,
    completed: 1,
    overdueCount: 1
  },
  classifications: {
    'ACT-101': 'DELAYED',
    'ACT-102': 'AT_RISK',
    'ACT-103': 'COMPLETED',
    'ACT-104': 'ON_TRACK',
    'ACT-105': 'ON_TRACK',
    'ACT-106': 'ON_TRACK'
  }
};

export const goldenExpectedIntelligence = {
  delayedExternalIds: ['ACT-101'],
  atRiskExternalIds: ['ACT-102'],
  completedTodayExternalIds: ['ACT-103'],
  behindScheduleExternalIds: ['ACT-101', 'ACT-102', 'ACT-104'],
  approachingMilestoneExternalIds: ['ACT-105'],
  staleActivityExternalIds: ['ACT-105', 'ACT-106']
};
