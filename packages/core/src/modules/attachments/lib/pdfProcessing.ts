import fs from 'fs/promises'
import path from 'path'
import { createRequire } from 'module'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { resolveMaxOcrPages, resolvePdfPageIterationLimit } from './ocrLimits'

const moduleRequire = createRequire(path.join(process.cwd(), 'package.json'))
const pdfJsPackageRoot = path.dirname(moduleRequire.resolve('pdfjs-dist/package.json'))
const cMapUrl = `${path.join(pdfJsPackageRoot, 'cmaps')}${path.sep}`
const standardFontDataUrl = `${path.join(pdfJsPackageRoot, 'standard_fonts')}${path.sep}`
const logger = createLogger('attachments').child({ component: 'pdf-processing' })

const MIN_RENDER_SCALE = 2
const MAX_RENDER_SCALE = 4
const MAX_RENDER_DIMENSION = 2200
const MAX_RENDER_PIXELS = 8_000_000

type PdfPageProxyLike = {
  cleanup: () => void
  getTextContent: () => Promise<{ items?: Array<{ str?: string }> }>
  getViewport: (args: { scale: number }) => { width: number; height: number }
  render: (args: { canvasContext: unknown; viewport: { width: number; height: number } }) => { promise: Promise<void> }
}

type PdfCanvasFactoryLike = {
  create: (width: number, height: number) => {
    canvas: { toBuffer: (mimeType: string) => Buffer | Uint8Array }
    context: unknown
  }
  destroy: (canvasAndContext: {
    canvas: { toBuffer: (mimeType: string) => Buffer | Uint8Array } | null
    context: unknown
  }) => void
}

type PdfDocumentProxyLike = {
  numPages: number
  canvasFactory: PdfCanvasFactoryLike
  getPage: (pageNumber: number) => Promise<PdfPageProxyLike>
}

export type PdfPageOcrInput = {
  pageNumber: number
  extractedText: string | null
  imageBuffer: Buffer | null
}

export type PdfOcrPreparationResult = {
  pageCount: number
  pages: PdfPageOcrInput[]
}

export type PreparePdfPagesForOcrOptions = {
  pageNumbers?: readonly number[]
  alwaysRender?: boolean
}

function resolveSelectedPageNumbers(
  numPages: number,
  maxPages: number,
  pageNumbers: readonly number[] | undefined,
): number[] {
  if (pageNumbers === undefined) {
    const pageLimit = resolvePdfPageIterationLimit(numPages, maxPages)
    return Array.from({ length: pageLimit }, (_value, index) => index + 1)
  }
  const selected = [...new Set(pageNumbers)]
    .filter((pageNumber) => Number.isInteger(pageNumber) && pageNumber >= 1 && pageNumber <= numPages)
    .sort((left, right) => left - right)
  return selected.slice(0, Math.max(0, Math.floor(maxPages)))
}

function normalizePdfText(rawText: string): string | null {
  const normalized = rawText.replace(/\s+/g, ' ').trim()
  return normalized.length > 0 ? normalized : null
}

function extractPdfTextContent(items: Array<{ str?: string }> | undefined): string | null {
  if (!Array.isArray(items) || items.length === 0) return null
  const collected = items
    .map((item) => (typeof item?.str === 'string' ? item.str : ''))
    .filter((value) => value.length > 0)
    .join(' ')
  return normalizePdfText(collected)
}

function resolvePdfRenderScale(page: PdfPageProxyLike): number {
  const baseViewport = page.getViewport({ scale: 1 })
  const baseLargestDimension = Math.max(baseViewport.width, baseViewport.height)
  let scale = Math.min(
    MAX_RENDER_SCALE,
    Math.max(MIN_RENDER_SCALE, MAX_RENDER_DIMENSION / Math.max(baseLargestDimension, 1)),
  )

  let viewport = page.getViewport({ scale })
  const pixelCount = viewport.width * viewport.height
  if (pixelCount > MAX_RENDER_PIXELS) {
    scale *= Math.sqrt(MAX_RENDER_PIXELS / pixelCount)
    viewport = page.getViewport({ scale })
  }

  return Math.max(1, scale)
}

async function renderPdfPageToImageBuffer(
  page: PdfPageProxyLike,
  canvasFactory: PdfCanvasFactoryLike,
): Promise<Buffer> {
  const viewport = page.getViewport({ scale: resolvePdfRenderScale(page) })
  const canvasAndContext = canvasFactory.create(viewport.width, viewport.height)

  try {
    const renderTask = page.render({
      canvasContext: canvasAndContext.context,
      viewport,
    })
    await renderTask.promise
    const imageBuffer = canvasAndContext.canvas.toBuffer('image/png')
    return Buffer.isBuffer(imageBuffer) ? imageBuffer : Buffer.from(imageBuffer)
  } finally {
    canvasFactory.destroy(canvasAndContext)
  }
}

export async function preparePdfPagesForOcr(
  filePath: string,
  options: PreparePdfPagesForOcrOptions = {},
): Promise<PdfOcrPreparationResult> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const data = new Uint8Array(await fs.readFile(filePath))
  const loadingTask = getDocument({
    data,
    cMapUrl,
    cMapPacked: true,
    standardFontDataUrl,
  })

  const pdfDocument = (await loadingTask.promise) as unknown as PdfDocumentProxyLike

  try {
    const pages: PdfPageOcrInput[] = []
    const maxPages = resolveMaxOcrPages()
    const selectedPageNumbers = resolveSelectedPageNumbers(pdfDocument.numPages, maxPages, options.pageNumbers)
    if (options.pageNumbers === undefined && pdfDocument.numPages > selectedPageNumbers.length) {
      logger.warn('PDF page count exceeds OCR cap; truncating', {
        numPages: pdfDocument.numPages,
        maxPages: selectedPageNumbers.length,
        filePath,
      })
    }

    for (const pageNumber of selectedPageNumbers) {
      const page = await pdfDocument.getPage(pageNumber)

      try {
        const textContent = await page.getTextContent()
        const extractedText = extractPdfTextContent(textContent.items)

        if (extractedText && !options.alwaysRender) {
          pages.push({
            pageNumber,
            extractedText,
            imageBuffer: null,
          })
          continue
        }

        pages.push({
          pageNumber,
          extractedText: null,
          imageBuffer: await renderPdfPageToImageBuffer(page, pdfDocument.canvasFactory),
        })
      } finally {
        page.cleanup()
      }
    }

    return {
      pageCount: pages.length,
      pages,
    }
  } finally {
    await loadingTask.destroy()
  }
}
