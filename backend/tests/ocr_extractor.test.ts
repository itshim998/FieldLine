import { describe, it, expect } from 'vitest';
import { OcrExtractor, OcrEngine } from '../src/services/ingestion/extractors/ocr.extractor.js';
import { ValidationError } from '../src/errors/AppError.js';
import { MAX_EXTRACTED_TEXT_LENGTH } from '../src/services/ingestion/document-ingestion.types.js';

class MockOcrEngine implements OcrEngine {
  constructor(
    private mockText: string = '',
    private mockConfidence: number = 0.95,
    private shouldFail: boolean = false
  ) {}

  async recognize(_imageBuffer: Buffer): Promise<{ text: string; confidence?: number }> {
    if (this.shouldFail) {
      throw new Error('Simulated OCR engine failure');
    }
    return {
      text: this.mockText,
      confidence: this.mockConfidence
    };
  }
}

describe('OcrExtractor', () => {
  it('should support image file extensions and image mime types', () => {
    const extractor = new OcrExtractor(new MockOcrEngine('test'));
    expect(extractor.supports('image', 'site_photo.jpg', 'image/jpeg')).toBe(true);
    expect(extractor.supports('other', 'scan.png', 'image/png')).toBe(true);
    expect(extractor.supports('image', 'blueprint.tiff', 'image/tiff')).toBe(true);
    expect(extractor.supports('text', 'notes.txt', 'text/plain')).toBe(false);
  });

  it('should extract text and normalize line breaks from image OCR', async () => {
    const mockText = 'READY-MIX CONCRETE TICKET\nBatch 4519: 50 m3\nDelivered to Pier P1\nLocation: Zone A';
    const extractor = new OcrExtractor(new MockOcrEngine(mockText, 0.92));

    const result = await extractor.extract({
      evidenceId: 'ev-img-1',
      projectId: 'proj-1',
      sourceFileName: 'batch_ticket.jpg',
      fileBuffer: Buffer.from('FAKE_IMAGE_DATA')
    });

    expect(result.evidenceId).toBe('ev-img-1');
    expect(result.sourceType).toBe('image');
    expect(result.text).toContain('READY-MIX CONCRETE TICKET');
    expect(result.text).toContain('Batch 4519: 50 m3');
    expect(result.text).toContain('Delivered to Pier P1');
    expect(result.metadata?.confidence).toBe(0.92);
  });

  it('should reject empty image buffer', async () => {
    const extractor = new OcrExtractor(new MockOcrEngine('some text'));

    await expect(
      extractor.extract({
        evidenceId: 'ev-empty',
        projectId: 'proj-1',
        sourceFileName: 'empty.png',
        fileBuffer: Buffer.from('')
      })
    ).rejects.toThrow(ValidationError);
  });

  it('should reject empty or whitespace-only OCR results', async () => {
    const extractor = new OcrExtractor(new MockOcrEngine('   \n\n\t  '));

    await expect(
      extractor.extract({
        evidenceId: 'ev-blank',
        projectId: 'proj-1',
        sourceFileName: 'blank.jpg',
        fileBuffer: Buffer.from('FAKE_BLANK_IMAGE')
      })
    ).rejects.toThrow(ValidationError);
  });

  it('should reject OCR results with insufficient alphanumeric characters', async () => {
    const extractor = new OcrExtractor(new MockOcrEngine('... --- ,,, '));

    await expect(
      extractor.extract({
        evidenceId: 'ev-noise',
        projectId: 'proj-1',
        sourceFileName: 'noise.jpg',
        fileBuffer: Buffer.from('FAKE_NOISY_IMAGE')
      })
    ).rejects.toThrow(ValidationError);
  });

  it('should handle OCR engine failures cleanly with ValidationError', async () => {
    const extractor = new OcrExtractor(new MockOcrEngine('', 0, true));

    await expect(
      extractor.extract({
        evidenceId: 'ev-fail',
        projectId: 'proj-1',
        sourceFileName: 'corrupt.jpg',
        fileBuffer: Buffer.from('FAKE_CORRUPT_IMAGE')
      })
    ).rejects.toThrow(ValidationError);
  });

  it('should bound maximum extracted text to MAX_EXTRACTED_TEXT_LENGTH', async () => {
    const hugeText = 'Pier P1 Construction Report Note. '.repeat(2000);
    const extractor = new OcrExtractor(new MockOcrEngine(hugeText));

    const result = await extractor.extract({
      evidenceId: 'ev-huge',
      projectId: 'proj-1',
      sourceFileName: 'huge.jpg',
      fileBuffer: Buffer.from('FAKE_HUGE_IMAGE')
    });

    expect(result.text.length).toBeLessThanOrEqual(MAX_EXTRACTED_TEXT_LENGTH);
  });
});
