import { describe, it, expect } from 'vitest';
import {
  PdfExtractor,
  PdfPageRenderer,
  DefaultPdfPageRenderer
} from '../src/services/ingestion/extractors/pdf.extractor.js';
import { OcrExtractor, OcrEngine } from '../src/services/ingestion/extractors/ocr.extractor.js';
import { ValidationError } from '../src/errors/AppError.js';

class MockOcrEngine implements OcrEngine {
  public recognizedBuffers: Buffer[] = [];
  constructor(private mockText: string = 'Scanned Inspection Sign-off Memo for Pier P1') {}
  async recognize(buf: Buffer) {
    this.recognizedBuffers.push(buf);
    return { text: this.mockText, confidence: 0.9 };
  }
}

class TrackingPdfPageRenderer implements PdfPageRenderer {
  public renderedPages: number[] = [];
  async renderPageToImage(_pdfBuffer: Buffer, pageNumber: number): Promise<Buffer> {
    this.renderedPages.push(pageNumber);
    // Return a dummy PNG raster buffer
    return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
}

function createMinimalTextPdf(text: string): Buffer {
  const streamContent = `BT\n/F1 12 Tf\n50 750 Td\n(${text}) Tj\nET`;
  const pdfBody = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length ${streamContent.length} >>
stream
${streamContent}
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
00000000115 00000 n 
0000000244 00000 n 
0000000372 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
449
%%EOF`;
  return Buffer.from(pdfBody, 'utf-8');
}

describe('PdfExtractor', () => {
  const extractor = new PdfExtractor();

  it('should support .pdf files and application/pdf mime type', () => {
    expect(extractor.supports('pdf', 'report.pdf', 'application/pdf')).toBe(true);
    expect(extractor.supports('other', 'report.pdf', null)).toBe(true);
    expect(extractor.supports('xlsx', 'report.xlsx', 'application/vnd.ms-excel')).toBe(false);
  });

  it('should extract embedded text from valid PDF', async () => {
    const pdfBuf = createMinimalTextPdf('Pier P1 substructure concrete pour 75% complete.');

    const result = await extractor.extract({
      evidenceId: 'ev-pdf-1',
      projectId: 'proj-1',
      sourceFileName: 'pier_report.pdf',
      fileBuffer: pdfBuf
    });

    expect(result.evidenceId).toBe('ev-pdf-1');
    expect(result.sourceType).toBe('pdf');
    expect(result.text).toContain('Pier P1 substructure concrete pour 75% complete.');
    expect(result.metadata?.totalPages).toBe(1);
    expect(result.metadata?.textExtraction).toBe('embedded');
  });

  it('should reject corrupt / invalid PDF buffer', async () => {
    const corruptBuffer = Buffer.from('NOT A REAL PDF FILE');

    await expect(
      extractor.extract({
        evidenceId: 'ev-corrupt',
        projectId: 'proj-1',
        sourceFileName: 'corrupt.pdf',
        fileBuffer: corruptBuffer
      })
    ).rejects.toThrow(ValidationError);
  });

  it('should reject empty PDF buffer', async () => {
    await expect(
      extractor.extract({
        evidenceId: 'ev-empty',
        projectId: 'proj-1',
        sourceFileName: 'empty.pdf',
        fileBuffer: Buffer.from('')
      })
    ).rejects.toThrow(ValidationError);
  });

  it('should fallback to scanned-PDF OCR rendering pipeline when PDF contains sparse/no embedded text', async () => {
    const mockEngine = new MockOcrEngine('Scanned Site Memo: Pier P1 Pour 80% Complete');
    const mockOcr = new OcrExtractor(mockEngine);
    const trackingRenderer = new TrackingPdfPageRenderer();
    const extractorWithOcr = new PdfExtractor(mockOcr, trackingRenderer);

    // Structurally valid PDF with empty text stream (scanned raster PDF representation)
    const emptyPdfBuf = createMinimalTextPdf('');

    const result = await extractorWithOcr.extract({
      evidenceId: 'ev-scanned',
      projectId: 'proj-1',
      sourceFileName: 'scanned_memo.pdf',
      fileBuffer: emptyPdfBuf
    });

    expect(result.sourceType).toBe('pdf');
    expect(result.text).toContain('Scanned Site Memo: Pier P1 Pour 80% Complete');
    expect(result.metadata?.fallbackMethod).toBe('ocr');
    expect(result.metadata?.totalPages).toBe(1);

    // Verify page renderer was actually invoked for page 1
    expect(trackingRenderer.renderedPages).toContain(1);

    // Verify OCR engine received the rendered raster image buffer rather than raw PDF
    expect(mockEngine.recognizedBuffers.length).toBe(1);
    expect(mockEngine.recognizedBuffers[0][0]).toBe(0x89); // PNG signature
    expect(mockEngine.recognizedBuffers[0][1]).toBe(0x50);
  });

  it('should support real raster image rendering with DefaultPdfPageRenderer', async () => {
    const defaultRenderer = new DefaultPdfPageRenderer();
    const validPdfBuf = createMinimalTextPdf('Real Renderer Test');

    const imageBuf = await defaultRenderer.renderPageToImage(validPdfBuf, 1);
    expect(imageBuf).toBeDefined();
    expect(imageBuf.length).toBeGreaterThan(0);
    // Check PNG magic bytes
    expect(imageBuf[0]).toBe(0x89);
    expect(imageBuf[1]).toBe(0x50);
  });
});
