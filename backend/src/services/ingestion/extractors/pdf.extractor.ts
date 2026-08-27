import path from 'node:path';
import { extractText, getDocumentProxy, renderPageAsImage } from 'unpdf';
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

export interface PdfPageRenderer {
  renderPageToImage(pdfBuffer: Buffer, pageNumber: number): Promise<Buffer>;
}

export class DefaultPdfPageRenderer implements PdfPageRenderer {
  async renderPageToImage(pdfBuffer: Buffer, pageNumber: number): Promise<Buffer> {
    const uint8 = new Uint8Array(
      pdfBuffer.buffer,
      pdfBuffer.byteOffset,
      pdfBuffer.byteLength
    );
    const imgArrayBuffer = await renderPageAsImage(uint8, pageNumber, {
      canvasImport: () => import('@napi-rs/canvas')
    });
    return Buffer.from(imgArrayBuffer);
  }
}

export class PdfExtractor implements DocumentExtractor {
  public readonly name: string = 'pdf-extractor';
  private ocrFallback?: OcrExtractor;
  private pageRenderer: PdfPageRenderer;

  constructor(
    ocrFallback: OcrExtractor = defaultOcrExtractor,
    pageRenderer: PdfPageRenderer = new DefaultPdfPageRenderer()
  ) {
    this.ocrFallback = ocrFallback;
    this.pageRenderer = pageRenderer;
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

    // Check if usable text was extracted; if not, invoke scanned-PDF raster OCR pipeline
    if (pageBlocks.length === 0 || totalAlphanumericCount < 10) {
      logger.info('PDF embedded text is sparse or absent; evaluating OCR fallback for scanned PDF');
      if (this.ocrFallback) {
        try {
          const pagesToOcr = Math.min(pdfData.totalPages, MAX_PDF_PAGES);
          const ocrPageBlocks: string[] = [];
          let totalOcrAlphaCount = 0;

          for (let pageNum = 1; pageNum <= pagesToOcr; pageNum++) {
            // 1. Render PDF page to raster image buffer
            const pageImageBuffer = await this.pageRenderer.renderPageToImage(
              input.fileBuffer,
              pageNum
            );

            // 2. OCR the rendered page image buffer
            const pageOcrResult = await this.ocrFallback.extract({
              ...input,
              fileBuffer: pageImageBuffer,
              mimeType: 'image/png'
            });

            if (pageOcrResult && pageOcrResult.text && pageOcrResult.text.trim().length > 0) {
              const pageText = pageOcrResult.text.trim();
              totalOcrAlphaCount += (pageText.match(/[a-zA-Z0-9]/g) || []).length;
              if (pdfData.totalPages > 1) {
                ocrPageBlocks.push(`--- Page ${pageNum} (OCR) ---\n${pageText}`);
              } else {
                ocrPageBlocks.push(pageText);
              }
            }
          }

          if (ocrPageBlocks.length === 0 || totalOcrAlphaCount < 3) {
            throw new ValidationError('OCR could not detect readable text from rendered PDF pages');
          }

          let combinedOcrText = ocrPageBlocks.join('\n\n');
          if (combinedOcrText.length > MAX_EXTRACTED_TEXT_LENGTH) {
            combinedOcrText = combinedOcrText.slice(0, MAX_EXTRACTED_TEXT_LENGTH);
          }

          return {
            evidenceId: input.evidenceId,
            projectId: input.projectId,
            sourceFileName: input.sourceFileName,
            sourceType: 'pdf',
            text: combinedOcrText,
            metadata: {
              fallbackMethod: 'ocr',
              totalPages: pdfData.totalPages,
              pagesProcessed: pagesToOcr
            }
          };
        } catch (ocrErr) {
          logger.warn('OCR fallback for scanned PDF failed', ocrErr);
          if (ocrErr instanceof ValidationError) {
            throw ocrErr;
          }
          throw new ValidationError(
            `PDF document contains no extractable text and scanned PDF OCR failed: ${ocrErr instanceof Error ? ocrErr.message : String(ocrErr)}`
          );
        }
      }

      throw new ValidationError('PDF document contains no readable text content');
    }

    let combinedText = pageBlocks.join('\n\n');
    if (combinedText.length > MAX_EXTRACTED_TEXT_LENGTH) {
      combinedText = combinedText.slice(0, MAX_EXTRACTED_TEXT_LENGTH);
    }

    return {
      evidenceId: input.evidenceId,
      projectId: input.projectId,
      sourceFileName: input.sourceFileName,
      sourceType: 'pdf',
      text: combinedText,
      metadata: {
        totalPages: pdfData.totalPages,
        pagesProcessed: pdfData.text.length,
        textExtraction: 'embedded'
      }
    };
  }
}

export const pdfExtractor = new PdfExtractor();
