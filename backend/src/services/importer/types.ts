import { CanonicalScheduleImportRow } from '../../models/domain.types.js';

export interface ScheduleParser {
  parse(filePath: string, originalFilename: string): Promise<CanonicalScheduleImportRow[]>;
}
