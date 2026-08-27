import path from 'node:path';
import { extractText, getDocumentProxy } from 'unpdf';
import {
  DocumentExtractor,
  ExtractDocumentInput,
  NormalizedDocument,
  MAX_PDF_PAGES,
  MAX_EXTRACTED_TEXT_LENGTH
} from '../document-ingestion.types.js';
import { OcrExtractor, ocrExtractor as defaultOcrExtractor } from './ocr.extractor.js';
import { ValidationError } from '../../../errors/AppError.js';
import { logger } from '../../../config/logger.js';

export class PdfExtractor implements DocumentExtractor {
  public readonly name: string = 'pdf-extractor';
  private ocrFallback?: OcrExtractor;

  constructor(ocrFallback: OcrExtractor = defaultOcrExtractor) {
    this.ocrFallback = ocrFallback;
  }

  supports(fileType: string, fileName: string, mimeType?: string | null): boolean {
    const ext = path.extname(fileName).toLowerCase();
    const mime = (mimeType || '').toLowerCase();
    return fileType === 'pdf' || ext === '.pdf' || mime === 'application/pdf';
  }

  async extract(input: ExtractDocumentInput): Promise<NormalizedDocument> {
    if (!input.fileBuffer || input.fileBuffer.length === 0) {
      throw new ValidationError('PDF document is empty');
    }

    let pdfData: { totalPages: number; text: string[] };
    try {
      // Validate PDF header
      const headerStr = input.fileBuffer.slice(0, 8).toString('ascii');
      if (!headerStr.includes('%PDF')) {
        throw new Error('Missing %PDF header identifier');
      }

      // Convert Buffer to Uint8Array for unpdf
      const uint8 = new Uint8Array(
        input.fileBuffer.buffer,
        input.fileBuffer.byteOffset,
        input.fileBuffer.byteLength
      );

      const doc = await getDocumentProxy(uint8);
      const totalPages = doc.numPages;

      const pagesToExtract = Math.min(totalPages, MAX_PDF_PAGES);
      const extracted = await extractText(uint8, { mergePages: false });
      
      const textPages = Array.isArray(extracted.text)
        ? extracted.text.slice(0, pagesToExtract)
        : [extracted.text];

      pdfData = {
        totalPages,
        text: textPages
      };
    } catch (parseErr) {
      logger.warn('PDF embedded text extraction failed', parseErr);
      throw new ValidationError(
        `Failed to parse PDF document: ${parseErr instanceof Error ? parseErr.message : 'corrupt or invalid file format'}`
      );
    }

    // Process and normalize extracted pages
    const pageBlocks: string[] = [];
    let totalAlphanumericCount = 0;

    for (let pageNum = 1; pageNum <= pdfData.text.length; pageNum++) {
      const rawPageText = pdfData.text[pageNum - 1] || '';

      // Normalize page text
      const cleanPageText = rawPageText
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\0/g, '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .join('\n');

      if (cleanPageText.length > 0) {
        totalAlphanumericCount += (cleanPageText.match(/[a-zA-Z0-9]/g) || []).length;
        if (pdfData.totalPages > 1) {
          pageBlocks.push(`--- Page ${pageNum} ---\n${cleanPageText}`);
        } else {
          pageBlocks.push(cleanPageText);
        }
      }
    }

    // Check if usable text was extracted
    if (pageBlocks.length === 0 || totalAlphanumericCount < 10) {
      logger.info('PDF embedded text is sparse or absent; evaluating OCR fallback for scanned PDF');
      // If OCR fallback is configured, attempt OCR
      if (this.ocrFallback) {
        try {
          const ocrResult = await this.ocrFallback.extract(input);
          return {
            ...ocrResult,
            sourceType: 'pdf',
            metadata: {
              ...ocrResult.metadata,
              fallbackMethod: 'ocr',
              totalPages: pdfData.totalPages
            }
          };
        } catch (ocrErr) {
          logger.warn('OCR fallback for scanned PDF also failed', ocrErr);
          throw new ValidationError(
            'PDF document contains no extractable text and OCR fallback could not detect readable content'
          );
        }
      }

      throw new ValidationError('PDF document contains no readable text content');
    }

    let normalizedText = pageBlocks.join('\n\n').trim();

    if (normalizedText.length > MAX_EXTRACTED_TEXT_LENGTH) {
      normalizedText = normalizedText.slice(0, MAX_EXTRACTED_TEXT_LENGTH).trim();
    }

    return {
      evidenceId: input.evidenceId,
      projectId: input.projectId,
      sourceFileName: input.sourceFileName,
      sourceType: 'pdf',
      text: normalizedText,
      metadata: {
        totalPages: pdfData.totalPages,
        extractedPages: pageBlocks.length
      }
    };
  }
}

export const pdfExtractor = new PdfExtractor();
