import * as XLSX from 'xlsx';
import path from 'node:path';
import fs from 'node:fs';

const fixturesDir = path.resolve(process.cwd(), 'backend', 'tests', 'fixtures');
if (!fs.existsSync(fixturesDir)) {
  fs.mkdirSync(fixturesDir, { recursive: true });
}

// 1. Valid XLSX Schedule
const validData = [
  {
    'Activity ID': 'XL-001',
    'Activity Name': 'Substation Earthworks',
    'Description': 'Mass excavation and site grading for main substation yard',
    'WBS': 'SUB-01',
    'Location': 'Switchyard Area',
    'Start Date': '2026-06-01',
    'Finish Date': '2026-06-25',
    'Quantity': 3200,
    'Unit': 'm3'
  },
  {
    'Activity ID': 'XL-002',
    'Activity Name': 'Control Building Foundation',
    'Description': 'Raft foundation concrete casting',
    'WBS': 'SUB-02',
    'Location': 'Building Pad 1',
    'Start Date': '2026-06-26',
    'Finish Date': '2026-07-20',
    'Quantity': 650,
    'Unit': 'm3'
  },
  {
    'Activity ID': 'XL-003',
    'Activity Name': 'Transformer Bay Gantry Erection',
    'Description': 'Galvanized steel gantry assembly and torque tightening',
    'WBS': 'SUB-03',
    'Location': 'Bay 1 & 2',
    'Start Date': '2026-07-21',
    'Finish Date': '2026-08-15',
    'Quantity': 45,
    'Unit': 'tonnes'
  }
];

const validWb = XLSX.utils.book_new();
const validWs = XLSX.utils.json_to_sheet(validData);
XLSX.utils.book_append_sheet(validWb, validWs, 'Schedule');
XLSX.writeFile(validWb, path.join(fixturesDir, 'valid_schedule.xlsx'));

// 2. Missing Headers XLSX
const missingHeadersData = [
  {
    'Activity ID': 'XL-BAD',
    'Location': 'Nowhere',
    'Quantity': 100
  }
];

const missingWb = XLSX.utils.book_new();
const missingWs = XLSX.utils.json_to_sheet(missingHeadersData);
XLSX.utils.book_append_sheet(missingWb, missingWs, 'Sheet1');
XLSX.writeFile(missingWb, path.join(fixturesDir, 'missing_headers.xlsx'));

console.log('Successfully generated XLSX test fixtures.');
