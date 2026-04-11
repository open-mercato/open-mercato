/** @jest-environment node */

const mockGenerateText = jest.fn()
const mockClientFactory = jest.fn((_model: string) => 'mock-model')
const mockPreparePdfPagesForOcr = jest.fn()
const mockReadFile = jest.fn()

jest.mock('ai', () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
}))

jest.mock('fs/promises', () => ({
  __esModule: true,
  default: {
    readFile: (...args: unknown[]) => mockReadFile(...args),
  },
}))

jest.mock('@ai-sdk/openai', () => ({
  createOpenAI: jest.fn(() => mockClientFactory),
}))

jest.mock('../pdfProcessing', () => ({
  preparePdfPagesForOcr: (...args: unknown[]) => mockPreparePdfPagesForOcr(...args),
}))

describe('attachments OCR service hardening', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.OPENAI_API_KEY
    mockReadFile.mockResolvedValue(Buffer.from([4, 5, 6]))
  })

  it('uses LLM OCR for image and PDF uploads', async () => {
    const { shouldUseLlmOcr } = await import('../ocrService')
    expect(shouldUseLlmOcr('image/png', 'scan.png')).toBe(true)
    expect(shouldUseLlmOcr('application/pdf', 'scan.pdf')).toBe(true)
    expect(shouldUseLlmOcr(null, 'scan.pdf')).toBe(true)
    expect(shouldUseLlmOcr('application/zip', 'archive.zip')).toBe(false)
  })

  it('uses pdfjs text extraction before OCR when PDF text is available', async () => {
    const { OcrService } = await import('../ocrService')
    mockPreparePdfPagesForOcr.mockResolvedValue({
      pageCount: 2,
      pages: [
        { pageNumber: 1, extractedText: 'First page text', imageBuffer: null },
        { pageNumber: 2, extractedText: 'Second page text', imageBuffer: null },
      ],
    })

    const service = new OcrService({ apiKey: 'test-key' })
    const result = await service.processFile({
      filePath: '/tmp/document.pdf',
      mimeType: 'application/pdf',
    })

    expect(mockPreparePdfPagesForOcr).toHaveBeenCalledWith('/tmp/document.pdf')
    expect(mockGenerateText).not.toHaveBeenCalled()
    expect(result).toEqual(
      expect.objectContaining({
        pageCount: 2,
        content: '--- Page 1 ---\n\nFirst page text\n\n--- Page 2 ---\n\nSecond page text',
      }),
    )
  })

  it('renders scanned PDF pages through image OCR when text extraction is empty', async () => {
    const { OcrService } = await import('../ocrService')
    mockPreparePdfPagesForOcr.mockResolvedValue({
      pageCount: 1,
      pages: [
        { pageNumber: 1, extractedText: null, imageBuffer: Buffer.from([1, 2, 3]) },
      ],
    })
    mockGenerateText.mockResolvedValue({
      text: 'OCR page content',
    })

    const service = new OcrService({ apiKey: 'test-key' })
    const result = await service.processFile({
      filePath: '/tmp/scan.pdf',
      mimeType: 'application/pdf',
    })

    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'mock-model',
        messages: [
          expect.objectContaining({
            role: 'user',
            content: expect.arrayContaining([
              expect.objectContaining({
                type: 'image',
                image: expect.stringContaining('data:image/png;base64,'),
              }),
            ]),
          }),
        ],
      }),
    )
    expect(result).toEqual(
      expect.objectContaining({
        pageCount: 1,
        content: 'OCR page content',
      }),
    )
  })

  it('still delegates image uploads to image OCR', async () => {
    const { OcrService } = await import('../ocrService')
    mockGenerateText.mockResolvedValue({
      text: 'image OCR text',
    })

    const service = new OcrService({ apiKey: 'test-key' })
    const result = await service.processImage({
      filePath: '/tmp/scan.png',
      mimeType: 'image/png',
    })

    expect(result).toEqual(
      expect.objectContaining({
        content: 'image OCR text',
      }),
    )
  })
})
