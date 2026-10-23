import { promises as fs } from 'node:fs'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { resolveMaxOcrPages } from '../../ocrLimits'
import type { OcrImageBufferInput } from '../../ocrService'
import type { PdfOcrPreparationResult, PreparePdfPagesForOcrOptions } from '../../pdfProcessing'
import type {
  DocumentBlock,
  DocumentEngineResult,
  DocumentOcrMode,
  DocumentStructureEngine,
  DocumentStructureEngineInput,
  DocumentStructureEngineName,
} from '../types'
import {
  DocumentStructureFileTooLargeError,
  normalizeExtension,
  normalizeMimeType,
  normalizeTextDocument,
  parseMarkdownBlocks,
  resolveMaxDocumentStructureBytes,
} from './text'

const OCR_ENGINE_VERSION = 1
const PDF_RENDER_MEDIA_TYPE = 'image/png'
const OCR_IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tif', 'tiff'])
const EXTENSION_MEDIA_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
}

const logger = createLogger('attachments').child({ component: 'document-structure-ocr' })

export type OcrPageProcessor = {
  readonly available: boolean
  processImageBuffer(input: OcrImageBufferInput): Promise<string>
}

export type OcrPdfPagePreparer = (
  filePath: string,
  options: PreparePdfPagesForOcrOptions,
) => Promise<PdfOcrPreparationResult>

export type OcrSlotRunner = <T>(run: () => Promise<T>) => Promise<T>

export type OcrStructureOptions = {
  ocrService?: () => OcrPageProcessor | null
  preparePdfPages?: OcrPdfPagePreparer
  runInSlot?: OcrSlotRunner
  maxPages?: () => number
  maxBytes?: () => number
}

export type ApplyOcrFallbackInput = {
  filePath: string
  result: DocumentEngineResult
  ocr?: DocumentOcrMode
  ocrModel?: string | null
}

export type OcrFallbackOutcome = {
  result: DocumentEngineResult
  engine: DocumentStructureEngineName
  ocrPages: number[]
  cappedPages: number[]
  failedPages: number[]
  ocrSkipped: boolean
}

export class DocumentStructureOcrUnavailableError extends Error {
  readonly code = 'no_text_layer_ocr_disabled'

  constructor() {
    super('[internal] document structure input requires OCR, which is disabled or unavailable')
    this.name = 'DocumentStructureOcrUnavailableError'
  }
}

export function resolveEffectiveOcrMode(requested: DocumentOcrMode | undefined, partitionRequiresOcr: boolean): DocumentOcrMode {
  if (!partitionRequiresOcr) return 'never'
  return requested ?? 'auto'
}

async function createDefaultOcrService(): Promise<OcrPageProcessor> {
  const { OcrService } = await import('../../ocrService')
  return new OcrService()
}

const defaultPreparePdfPages: OcrPdfPagePreparer = async (filePath, options) => {
  const { preparePdfPagesForOcr } = await import('../../pdfProcessing')
  return preparePdfPagesForOcr(filePath, options)
}

const defaultRunInSlot: OcrSlotRunner = async (run) => {
  const { withOcrConcurrencySlot } = await import('../../ocrQueue')
  return withOcrConcurrencySlot(run)
}

function sortedUnique(pages: readonly number[]): number[] {
  return [...new Set(pages)].sort((left, right) => left - right)
}

export function ocrTextToBlocks(text: string, page: number | null): DocumentBlock[] {
  return parseMarkdownBlocks(normalizeTextDocument(text)).map((block) => ({ ...block, page, source: 'ocr' }))
}

export function mergeOcrBlocksByPage(
  blocks: readonly DocumentBlock[],
  ocrBlocksByPage: ReadonlyMap<number, DocumentBlock[]>,
): DocumentBlock[] {
  const pendingPages = sortedUnique([...ocrBlocksByPage.keys()])
  const merged: DocumentBlock[] = []
  const flushUpTo = (page: number | null) => {
    while (pendingPages.length > 0 && (page === null || pendingPages[0] <= page)) {
      const pendingPage = pendingPages.shift() ?? 0
      merged.push(...(ocrBlocksByPage.get(pendingPage) ?? []))
    }
  }
  for (const block of blocks) {
    if (block.page !== null) {
      flushUpTo(block.page)
      if (ocrBlocksByPage.has(block.page)) continue
    }
    merged.push(block)
  }
  flushUpTo(null)
  return merged
}

function resolveCandidatePages(result: DocumentEngineResult, mode: DocumentOcrMode): number[] {
  if (mode === 'force') {
    return Array.from({ length: result.pageCharCounts.length }, (_value, index) => index + 1)
  }
  return sortedUnique(result.unreadablePages)
}

function resolveMergedEngineName(blocks: readonly DocumentBlock[], ocrPageCount: number): DocumentStructureEngineName {
  if (ocrPageCount === 0) return 'pdf_layout'
  return blocks.every((block) => block.source === 'ocr') ? 'ocr' : 'mixed'
}

async function resolveOcrProcessor(options: OcrStructureOptions): Promise<OcrPageProcessor | null> {
  const processor = options.ocrService ? options.ocrService() : await createDefaultOcrService()
  return processor && processor.available ? processor : null
}

export async function applyOcrFallback(
  input: ApplyOcrFallbackInput,
  options: OcrStructureOptions = {},
): Promise<OcrFallbackOutcome> {
  const mode = input.ocr ?? 'auto'
  const candidates = resolveCandidatePages(input.result, mode)
  const unchanged: OcrFallbackOutcome = {
    result: input.result,
    engine: resolveMergedEngineName(input.result.blocks, input.result.ocrPageCount),
    ocrPages: [],
    cappedPages: [],
    failedPages: [],
    ocrSkipped: candidates.length > 0,
  }
  if (candidates.length === 0) return { ...unchanged, ocrSkipped: false }
  if (mode === 'never') return unchanged
  const processor = await resolveOcrProcessor(options)
  if (!processor) return unchanged

  const maxPages = Math.max(0, Math.floor((options.maxPages ?? resolveMaxOcrPages)()))
  const selectedPages = candidates.slice(0, maxPages)
  const cappedPages = candidates.slice(maxPages)
  const runInSlot = options.runInSlot ?? defaultRunInSlot
  const preparePdfPages = options.preparePdfPages ?? defaultPreparePdfPages
  const model = input.ocrModel ?? undefined
  const ocrBlocksByPage = new Map<number, DocumentBlock[]>()
  const ocrPages: number[] = []
  const failedPages: number[] = []

  if (selectedPages.length > 0) {
    let prepared: PdfOcrPreparationResult | null = null
    try {
      prepared = await preparePdfPages(input.filePath, { pageNumbers: selectedPages, alwaysRender: true })
    } catch (error) {
      logger.warn('PDF rasterization for structure OCR failed', { pageCount: selectedPages.length, err: error })
    }
    const imagesByPage = new Map((prepared?.pages ?? []).map((page) => [page.pageNumber, page.imageBuffer]))
    for (const pageNumber of selectedPages) {
      const imageBuffer = imagesByPage.get(pageNumber) ?? null
      if (!imageBuffer) {
        failedPages.push(pageNumber)
        continue
      }
      try {
        const text = await runInSlot(() =>
          processor.processImageBuffer({ imageBuffer, mediaType: PDF_RENDER_MEDIA_TYPE, model }),
        )
        ocrPages.push(pageNumber)
        const pageBlocks = ocrTextToBlocks(text, pageNumber)
        if (pageBlocks.length > 0) ocrBlocksByPage.set(pageNumber, pageBlocks)
      } catch (error) {
        failedPages.push(pageNumber)
        logger.warn('Structure OCR failed for page', { pageNumber, err: error })
      }
    }
  }

  const resolvedPages = new Set(ocrPages)
  const blocks = mergeOcrBlocksByPage(input.result.blocks, ocrBlocksByPage)
  const ocrPageCount = input.result.ocrPageCount + ocrPages.length
  return {
    result: {
      ...input.result,
      blocks,
      ocrPageCount,
      unreadablePages: sortedUnique(input.result.unreadablePages).filter((page) => !resolvedPages.has(page)),
    },
    engine: resolveMergedEngineName(blocks, ocrPageCount),
    ocrPages,
    cappedPages,
    failedPages,
    ocrSkipped: false,
  }
}

function resolveImageMediaType(mimeType: string, extension?: string | null): string {
  const normalizedMime = normalizeMimeType(mimeType)
  if (normalizedMime.startsWith('image/')) return normalizedMime
  const normalizedExtension = normalizeExtension(extension)
  return (normalizedExtension && EXTENSION_MEDIA_TYPES[normalizedExtension]) || PDF_RENDER_MEDIA_TYPE
}

export function isOcrImageInput(mimeType: string, extension?: string | null): boolean {
  const normalizedExtension = normalizeExtension(extension)
  if (normalizedExtension && OCR_IMAGE_EXTENSIONS.has(normalizedExtension)) return true
  const normalizedMime = normalizeMimeType(mimeType)
  if (!normalizedMime.startsWith('image/')) return false
  return OCR_IMAGE_EXTENSIONS.has(normalizedMime.slice('image/'.length).replace(/^x-/, ''))
}

export function createOcrStructureEngine(options: OcrStructureOptions = {}): DocumentStructureEngine {
  const resolveMaxBytes = options.maxBytes ?? resolveMaxDocumentStructureBytes
  return {
    id: 'ocr',
    version: OCR_ENGINE_VERSION,
    supports: isOcrImageInput,
    async extract(input: DocumentStructureEngineInput): Promise<DocumentEngineResult> {
      if (input.ocr === 'never') throw new DocumentStructureOcrUnavailableError()
      const maxBytes = resolveMaxBytes()
      const stats = await fs.stat(input.filePath)
      if (stats.size > maxBytes) throw new DocumentStructureFileTooLargeError(stats.size, maxBytes)
      const processor = await resolveOcrProcessor(options)
      if (!processor) throw new DocumentStructureOcrUnavailableError()
      const imageBuffer = await fs.readFile(input.filePath)
      const runInSlot = options.runInSlot ?? defaultRunInSlot
      const baseResult: DocumentEngineResult = {
        blocks: [],
        pageCount: 1,
        pageCharCounts: [0],
        outline: [],
        ocrPageCount: 0,
        unreadablePages: [1],
      }
      try {
        const text = await runInSlot(() =>
          processor.processImageBuffer({
            imageBuffer,
            mediaType: resolveImageMediaType(input.mimeType, input.extension),
            model: input.ocrModel ?? undefined,
          }),
        )
        return { ...baseResult, blocks: ocrTextToBlocks(text, 1), ocrPageCount: 1, unreadablePages: [] }
      } catch (error) {
        logger.warn('Structure OCR failed for image', { err: error })
        return baseResult
      }
    },
  }
}

export const ocrStructureEngine: DocumentStructureEngine = createOcrStructureEngine()
