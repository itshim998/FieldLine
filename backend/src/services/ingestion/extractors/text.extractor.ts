import path from 'node:path';
import {
  DocumentExtractor,
  ExtractDocumentInput,
  NormalizedDocument,
  MAX_EXTRACTED_TEXT_LENGTH
} from '../document-ingestion.types.js';
import { ValidationError } from '../../../errors/AppError.js';

export class TextExtractor implements DocumentExtractor {
  public readonly name: string = 'text-extractor';

  supports(fileType: string, fileName: string, mimeType?: string | null): boolean {
    const ext = path.extname(fileName).toLowerCase();
    const mime = (mimeType || '').toLowerCase();
    return (
      fileType === 'text' ||
      fileType === 'transcript' ||
      ext === '.txt' ||
      ext === '.log' ||
      ext === '.md' ||
      ext === '.vtt' ||
      ext === '.srt' ||
      ext === '.transcript' ||
      mime.startsWith('text/') ||
      mime === 'application/json'
    );
  }

  async extract(input: ExtractDocumentInput): Promise<NormalizedDocument> {
    if (!input.fileBuffer || input.fileBuffer.length === 0) {
      throw new ValidationError('Text document is empty');
    }

    let rawContent: string;
    try {
      rawContent = input.fileBuffer.toString('utf-8');
      if (rawContent.charCodeAt(0) === 0xFEFF) {
        rawContent = rawContent.slice(1);
      }
    } catch (err) {
      throw new ValidationError(
        `Failed to decode text document as UTF-8: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    let cleanText = rawContent
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\0/g, '')
      .trim();

    if (cleanText.length === 0) {
      throw new ValidationError('Text document is empty or contains only whitespace');
    }

    if (cleanText.length > MAX_EXTRACTED_TEXT_LENGTH) {
      cleanText = cleanText.slice(0, MAX_EXTRACTED_TEXT_LENGTH).trim();
    }

    return {
      evidenceId: input.evidenceId,
      projectId: input.projectId,
      sourceFileName: input.sourceFileName,
      sourceType: 'text',
      text: cleanText,
      metadata: {
        characterCount: cleanText.length
      }
    };
  }
}

export const textExtractor = new TextExtractor();
