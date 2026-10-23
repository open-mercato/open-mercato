import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  DocumentStructureOcrUnavailableError,
  applyOcrFallback,
  createOcrStructureEngine,
  isOcrImageInput,
  mergeOcrBlocksByPage,
  resolveEffectiveOcrMode,
  type OcrPageProcessor,
  type OcrPdfPagePreparer,
  type OcrSlotRunner,
} from '../../engines/ocr'
import { structureDocument } from '../../structurer'
import { documentEngineResultSchema, type DocumentBlock, type DocumentEngineResult } from '../../types'
import type { OcrImageBufferInput } from '../../../ocrService'

let workDir: string

beforeAll(() => {
  workDir = mkdtempSync(path.join(tmpdir(), 'om-ocr-engine-'))
})

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true })
})

function writeFixture(name: string, content: Buffer | string): string {
  const filePath = path.join(workDir, name)
  writeFileSync(filePath, content)
  return filePath
}

function pageMarker(pageNumber: number): Buffer {
  return Buffer.from(`page-${pageNumber}`)
}

function createMockOcr(textForImage: (input: OcrImageBufferInput) => string | Error, available = true) {
  const calls: OcrImageBufferInput[] = []
  const processor: OcrPageProcessor = {
    available,
    async processImageBuffer(input) {
      calls.push(input)
      const outcome = textForImage(input)
      if (outcome instanceof Error) throw outcome
      return outcome
    },
  }
  return { processor, calls }
}

function createMockPreparer() {
  const prepare = jest.fn<ReturnType<OcrPdfPagePreparer>, Parameters<OcrPdfPagePreparer>>(async (_filePath, options) => {
    const pageNumbers = [...(options.pageNumbers ?? [])]
    return {
      pageCount: pageNumbers.length,
      pages: pageNumbers.map((pageNumber) => ({ pageNumber, extractedText: null, imageBuffer: pageMarker(pageNumber) })),
    }
  })
  return prepare
}

function createSlotSpy() {
  let slotCalls = 0
  const runInSlot: OcrSlotRunner = async (run) => {
    slotCalls += 1
    return run()
  }
  return { runInSlot, count: () => slotCalls }
}

function textLayerBlock(text: string, page: number): DocumentBlock {
  return { text, page, source: 'text_layer' }
}

function pdfResult(overrides: Partial<DocumentEngineResult> = {}): DocumentEngineResult {
  return {
    blocks: [
      textLayerBlock('Page one body text with plenty of characters in it', 1),
      textLayerBlock('7', 2),
      textLayerBlock('Page three body text with plenty of characters in it', 3),
    ],
    pageCount: 4,
    pageCharCounts: [50, 1, 52, 0],
    outline: [],
    ocrPageCount: 0,
    unreadablePages: [2, 4],
    ...overrides,
  }
}

const pageTextFromImage = (input: OcrImageBufferInput) => `# Scanned ${input.imageBuffer.toString()}\n\nBody of ${input.imageBuffer.toString()}`

describe('document structure OCR fallback', () => {
  it('rasterizes and OCRs only the candidate pages through the OCR slot', async () => {
    const { processor, calls } = createMockOcr(pageTextFromImage)
    const preparePdfPages = createMockPreparer()
    const slot = createSlotSpy()

    const outcome = await applyOcrFallback(
      { filePath: '/tmp/doc.pdf', result: pdfResult(), ocrModel: 'vision-model' },
      { ocrService: () => processor, preparePdfPages, runInSlot: slot.runInSlot, maxPages: () => 50 },
    )

    expect(preparePdfPages).toHaveBeenCalledTimes(1)
    expect(preparePdfPages).toHaveBeenCalledWith('/tmp/doc.pdf', { pageNumbers: [2, 4], alwaysRender: true })
    expect(calls.map((call) => call.imageBuffer.toString())).toEqual(['page-2', 'page-4'])
    expect(calls.every((call) => call.model === 'vision-model' && call.mediaType === 'image/png')).toBe(true)
    expect(slot.count()).toBe(2)
    expect(outcome.ocrPages).toEqual([2, 4])
    expect(outcome.cappedPages).toEqual([])
    expect(outcome.failedPages).toEqual([])
    expect(outcome.engine).toBe('mixed')
    expect(outcome.result.ocrPageCount).toBe(2)
    expect(outcome.result.unreadablePages).toEqual([])
    expect(documentEngineResultSchema.safeParse(outcome.result).success).toBe(true)
  })

  it('merges OCR blocks by page, replacing the sparse text-layer blocks of OCR pages', async () => {
    const { processor } = createMockOcr(pageTextFromImage)
    const outcome = await applyOcrFallback(
      { filePath: '/tmp/doc.pdf', result: pdfResult() },
      { ocrService: () => processor, preparePdfPages: createMockPreparer(), runInSlot: createSlotSpy().runInSlot, maxPages: () => 50 },
    )

    expect(outcome.result.blocks.map((block) => [block.page, block.source, block.text])).toEqual([
      [1, 'text_layer', 'Page one body text with plenty of characters in it'],
      [2, 'ocr', 'Scanned page-2'],
      [2, 'ocr', 'Body of page-2'],
      [3, 'text_layer', 'Page three body text with plenty of characters in it'],
      [4, 'ocr', 'Scanned page-4'],
      [4, 'ocr', 'Body of page-4'],
    ])
    expect(outcome.result.blocks[1].headingLevel).toBe(1)
  })

  it('caps OCR at the configured page limit and leaves the rest as unreadable placeholders', async () => {
    const { processor, calls } = createMockOcr(pageTextFromImage)
    const preparePdfPages = createMockPreparer()
    const outcome = await applyOcrFallback(
      { filePath: '/tmp/doc.pdf', result: pdfResult() },
      { ocrService: () => processor, preparePdfPages, runInSlot: createSlotSpy().runInSlot, maxPages: () => 1 },
    )

    expect(preparePdfPages).toHaveBeenCalledWith('/tmp/doc.pdf', { pageNumbers: [2], alwaysRender: true })
    expect(calls).toHaveLength(1)
    expect(outcome.ocrPages).toEqual([2])
    expect(outcome.cappedPages).toEqual([4])
    expect(outcome.result.unreadablePages).toEqual([4])
    expect(outcome.result.ocrPageCount).toBe(1)

    const structured = structureDocument(outcome.result, { engine: outcome.engine, engineVersion: 1 })
    expect(structured.status).toBe('partial')
    expect(structured.ocrPageCount).toBe(1)
    const placeholders = structured.sections.filter((section) => section.kind === 'page_unreadable')
    expect(placeholders.map((section) => section.pageStart)).toEqual([4])
  })

  it('reads the OCR cap from OM_ATTACHMENT_OCR_MAX_PAGES by default', async () => {
    const previous = process.env.OM_ATTACHMENT_OCR_MAX_PAGES
    process.env.OM_ATTACHMENT_OCR_MAX_PAGES = '1'
    try {
      const { processor } = createMockOcr(pageTextFromImage)
      const outcome = await applyOcrFallback(
        { filePath: '/tmp/doc.pdf', result: pdfResult() },
        { ocrService: () => processor, preparePdfPages: createMockPreparer(), runInSlot: createSlotSpy().runInSlot },
      )
      expect(outcome.cappedPages).toEqual([4])
    } finally {
      if (previous === undefined) delete process.env.OM_ATTACHMENT_OCR_MAX_PAGES
      else process.env.OM_ATTACHMENT_OCR_MAX_PAGES = previous
    }
  })

  it('skips OCR entirely for ocr: never, a disabled partition or an unavailable service', async () => {
    const { processor, calls } = createMockOcr(pageTextFromImage)
    const unavailable = createMockOcr(pageTextFromImage, false)
    const preparePdfPages = createMockPreparer()
    const options = { preparePdfPages, runInSlot: createSlotSpy().runInSlot, maxPages: () => 50 }
    const original = pdfResult()

    const never = await applyOcrFallback({ filePath: '/tmp/doc.pdf', result: original, ocr: 'never' }, { ...options, ocrService: () => processor })
    const partitionOff = await applyOcrFallback(
      { filePath: '/tmp/doc.pdf', result: original, ocr: resolveEffectiveOcrMode('force', false) },
      { ...options, ocrService: () => processor },
    )
    const noService = await applyOcrFallback({ filePath: '/tmp/doc.pdf', result: original }, { ...options, ocrService: () => unavailable.processor })
    const nullService = await applyOcrFallback({ filePath: '/tmp/doc.pdf', result: original }, { ...options, ocrService: () => null })

    for (const outcome of [never, partitionOff, noService, nullService]) {
      expect(outcome.result).toBe(original)
      expect(outcome.ocrSkipped).toBe(true)
      expect(outcome.engine).toBe('pdf_layout')
    }
    expect(calls).toHaveLength(0)
    expect(unavailable.calls).toHaveLength(0)
    expect(preparePdfPages).not.toHaveBeenCalled()
    expect(resolveEffectiveOcrMode(undefined, true)).toBe('auto')
  })

  it('does nothing when no page needs OCR', async () => {
    const { processor, calls } = createMockOcr(pageTextFromImage)
    const original = pdfResult({ unreadablePages: [] })
    const outcome = await applyOcrFallback(
      { filePath: '/tmp/doc.pdf', result: original },
      { ocrService: () => processor, preparePdfPages: createMockPreparer(), runInSlot: createSlotSpy().runInSlot },
    )
    expect(outcome.result).toBe(original)
    expect(outcome.ocrSkipped).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('OCRs every processed page in force mode and reports an ocr-only engine', async () => {
    const { calls, processor } = createMockOcr(pageTextFromImage)
    const outcome = await applyOcrFallback(
      { filePath: '/tmp/doc.pdf', result: pdfResult(), ocr: 'force' },
      { ocrService: () => processor, preparePdfPages: createMockPreparer(), runInSlot: createSlotSpy().runInSlot, maxPages: () => 50 },
    )
    expect(calls.map((call) => call.imageBuffer.toString())).toEqual(['page-1', 'page-2', 'page-3', 'page-4'])
    expect(outcome.engine).toBe('ocr')
    expect(outcome.result.blocks.every((block) => block.source === 'ocr')).toBe(true)
  })

  it('keeps failed OCR pages unreadable without failing the document', async () => {
    const { processor } = createMockOcr((input) =>
      input.imageBuffer.toString() === 'page-2' ? new Error('provider down') : pageTextFromImage(input),
    )
    const outcome = await applyOcrFallback(
      { filePath: '/tmp/doc.pdf', result: pdfResult() },
      { ocrService: () => processor, preparePdfPages: createMockPreparer(), runInSlot: createSlotSpy().runInSlot, maxPages: () => 50 },
    )
    expect(outcome.failedPages).toEqual([2])
    expect(outcome.ocrPages).toEqual([4])
    expect(outcome.result.unreadablePages).toEqual([2])
    expect(outcome.result.blocks.filter((block) => block.page === 2).map((block) => block.source)).toEqual(['text_layer'])
  })

  it('marks every selected page failed when rasterization throws', async () => {
    const { processor, calls } = createMockOcr(pageTextFromImage)
    const outcome = await applyOcrFallback(
      { filePath: '/tmp/doc.pdf', result: pdfResult() },
      {
        ocrService: () => processor,
        preparePdfPages: async () => {
          throw new Error('render failed')
        },
        runInSlot: createSlotSpy().runInSlot,
        maxPages: () => 50,
      },
    )
    expect(calls).toHaveLength(0)
    expect(outcome.failedPages).toEqual([2, 4])
    expect(outcome.result.unreadablePages).toEqual([2, 4])
  })

  it('places OCR pages that had no text-layer blocks between their neighbours', () => {
    const merged = mergeOcrBlocksByPage(
      [textLayerBlock('one', 1), textLayerBlock('three', 3), textLayerBlock('five', 5)],
      new Map([
        [2, [{ text: 'two', page: 2, source: 'ocr' as const }]],
        [6, [{ text: 'six', page: 6, source: 'ocr' as const }]],
      ]),
    )
    expect(merged.map((block) => block.text)).toEqual(['one', 'two', 'three', 'five', 'six'])
  })
})

describe('document structure OCR image engine', () => {
  it('supports image inputs only', () => {
    expect(isOcrImageInput('image/png', 'png')).toBe(true)
    expect(isOcrImageInput('image/jpeg')).toBe(true)
    expect(isOcrImageInput('application/octet-stream', 'tiff')).toBe(true)
    expect(isOcrImageInput('image/svg+xml', 'svg')).toBe(false)
    expect(isOcrImageInput('application/pdf', 'pdf')).toBe(false)
  })

  it('OCRs a single image into page-tagged blocks through the OCR slot', async () => {
    const filePath = writeFixture('scan.jpg', 'jpeg-bytes')
    const { processor, calls } = createMockOcr(() => '## Invoice\n\n- Item one\n- Item two')
    const slot = createSlotSpy()
    const engine = createOcrStructureEngine({ ocrService: () => processor, runInSlot: slot.runInSlot })

    const result = await engine.extract({ filePath, mimeType: 'image/jpeg', extension: 'jpg', ocrModel: 'vision-model' })

    expect(engine.id).toBe('ocr')
    expect(slot.count()).toBe(1)
    expect(calls).toHaveLength(1)
    expect(calls[0].imageBuffer.toString()).toBe('jpeg-bytes')
    expect(calls[0].mediaType).toBe('image/jpeg')
    expect(calls[0].model).toBe('vision-model')
    expect(result.ocrPageCount).toBe(1)
    expect(result.pageCount).toBe(1)
    expect(result.unreadablePages).toEqual([])
    expect(result.blocks.map((block) => [block.text, block.page, block.source])).toEqual([
      ['Invoice', 1, 'ocr'],
      ['Item one', 1, 'ocr'],
      ['Item two', 1, 'ocr'],
    ])
    expect(documentEngineResultSchema.safeParse(result).success).toBe(true)
  })

  it('refuses images when OCR is disabled or unavailable', async () => {
    const filePath = writeFixture('scan.png', 'png-bytes')
    const { processor, calls } = createMockOcr(() => 'text')
    const enabled = createOcrStructureEngine({ ocrService: () => processor, runInSlot: createSlotSpy().runInSlot })
    await expect(enabled.extract({ filePath, mimeType: 'image/png', ocr: 'never' })).rejects.toBeInstanceOf(
      DocumentStructureOcrUnavailableError,
    )
    const unavailable = createOcrStructureEngine({ ocrService: () => createMockOcr(() => 'text', false).processor })
    await expect(unavailable.extract({ filePath, mimeType: 'image/png' })).rejects.toMatchObject({
      code: 'no_text_layer_ocr_disabled',
    })
    expect(calls).toHaveLength(0)
  })

  it('returns an unreadable page when image OCR fails', async () => {
    const filePath = writeFixture('broken.png', 'png-bytes')
    const { processor } = createMockOcr(() => new Error('provider down'))
    const engine = createOcrStructureEngine({ ocrService: () => processor, runInSlot: createSlotSpy().runInSlot })
    const result = await engine.extract({ filePath, mimeType: 'image/png' })
    expect(result.blocks).toEqual([])
    expect(result.ocrPageCount).toBe(0)
    expect(result.unreadablePages).toEqual([1])
  })

  it('rejects images over the structure byte limit before calling OCR', async () => {
    const filePath = writeFixture('large.png', 'x'.repeat(32))
    const { processor, calls } = createMockOcr(() => 'text')
    const engine = createOcrStructureEngine({ ocrService: () => processor, maxBytes: () => 8 })
    await expect(engine.extract({ filePath, mimeType: 'image/png' })).rejects.toMatchObject({ code: 'too_large' })
    expect(calls).toHaveLength(0)
  })
})
