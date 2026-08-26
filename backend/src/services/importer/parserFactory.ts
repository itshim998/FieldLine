import path from 'node:path';
import { ScheduleParser } from './types.js';
import { CsvScheduleParser } from './csvParser.js';
import { XlsxScheduleParser } from './xlsxParser.js';
import { ScheduleSourceType } from '../../models/domain.types.js';
import { ValidationError } from '../../errors/AppError.js';

export interface ResolvedParser {
  parser: ScheduleParser;
  sourceType: ScheduleSourceType;
}

export function getScheduleParser(filename: string, mimetype?: string): ResolvedParser {
  const ext = path.extname(filename).toLowerCase();

  if (ext === '.csv' || mimetype === 'text/csv' || mimetype === 'application/csv') {
    return {
      parser: new CsvScheduleParser(),
      sourceType: 'csv'
    };
  }

  if (
    ext === '.xlsx' ||
    mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ) {
    return {
      parser: new XlsxScheduleParser(),
      sourceType: 'xlsx'
    };
  }

  throw new ValidationError(
    `Unsupported file format '${ext || 'unknown'}'. FieldLine schedule importer supports .csv and .xlsx files.`
  );
}
