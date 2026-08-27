import path from 'node:path';
import { createWorker } from 'tesseract.js';
import {
  DocumentExtractor,
  ExtractDocumentInput,
  NormalizedDocument,
  MAX_EXTRACTED_TEXT_LENGTH
} from '../document-ingestion.types.js';
import { ValidationError } from '../../../errors/AppError.js';
import { logger } from '../../../config/logger.js';

export interface OcrEngine {
  recognize(imageBuffer: Buffer): Promise<{ text: string; confidence?: number }>;
}

export class DefaultTesseractOcrEngine implements OcrEngine {
  async recognize(imageBuffer: Buffer): Promise<{ text: string; confidence?: number }> {
    let worker: Awaited<ReturnType<typeof createWorker>> | null = null;
    try {
      worker = await createWorker('eng');
      const ret = await worker.recognize(imageBuffer);
      return {
        text: ret.data.text,
        confidence: ret.data.confidence
      };
    } catch (err) {
      logger.error('Tesseract OCR recognition error', err);
      throw new ValidationError(
        `OCR engine failure: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      if (worker) {
        try {
          await worker.terminate();
        } catch {
          // Ignore worker termination failure
        }
      }
    }
  }
}

export class OcrExtractor implements DocumentExtractor {
  public readonly name: string = 'ocr-extractor';
  private engine: OcrEngine;

  constructor(engine: OcrEngine = new DefaultTesseractOcrEngine()) {
    this.engine = engine;
  }

  supports(fileType: string, fileName: string, mimeType?: string | null): boolean {
    const ext = path.extname(fileName).toLowerCase();
    const mime = (mimeType || '').toLowerCase();
    return (
      fileType === 'image' ||
      ext === '.png' ||
      ext === '.jpg' ||
      ext === '.jpeg' ||
      ext === '.gif' ||
      ext === '.webp' ||
      ext === '.bmp' ||
      ext === '.tiff' ||
      mime.startsWith('image/')
    );
  }

  async extract(input: ExtractDocumentInput): Promise<NormalizedDocument> {
    if (!input.fileBuffer || input.fileBuffer.length === 0) {
      throw new ValidationError('Image document is empty');
    }

    let result: { text: string; confidence?: number };
    try {
      result = await this.engine.recognize(input.fileBuffer);
    } catch (err) {
      throw new ValidationError(
        `OCR engine failure: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (!result || !result.text || result.text.trim().length === 0) {
      throw new ValidationError('OCR could not extract any readable text from the document');
    }

    // Normalize OCR text
    let cleanText = result.text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\0/g, '')
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line, i, arr) => {
        // Strip multiple consecutive blank lines
        if (line.trim().length === 0 && i > 0 && arr[i - 1].trim().length === 0) {
          return false;
        }
        return true;
      })
      .join('\n')
      .trim();

    if (cleanText.length === 0) {
      throw new ValidationError('OCR extracted only whitespace from the document');
    }

    // Check for minimum substantive alphanumeric content
    const alphanumericCount = (cleanText.match(/[a-zA-Z0-9]/g) || []).length;
    if (alphanumericCount < 3) {
      throw new ValidationError('OCR output contains insufficient readable alphanumeric text');
    }

    if (cleanText.length > MAX_EXTRACTED_TEXT_LENGTH) {
      cleanText = cleanText.slice(0, MAX_EXTRACTED_TEXT_LENGTH).trim();
    }

    return {
      evidenceId: input.evidenceId,
      projectId: input.projectId,
      sourceFileName: input.sourceFileName,
      sourceType: 'image',
      text: cleanText,
      metadata: {
        ocrEngine: 'tesseract.js',
        confidence: result.confidence ?? null
      }
    };
  }
}

export const ocrExtractor = new OcrExtractor();
