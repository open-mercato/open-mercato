import fs from 'fs/promises'
import path from 'path'
import { createRequire } from 'module'
import { pathToFileURL } from 'url'

const moduleRequire = createRequire(path.join(process.cwd(), 'package.json'))

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
  destroy: () => Promise<void>
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

type PdfJsModule = {
  getDocument: (input: {
    data: Uint8Array
    cMapUrl: string
    cMapPacked: boolean
    standardFontDataUrl: string
  }) => { promise: Promise<PdfDocumentProxyLike> }
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

export async function preparePdfPagesForOcr(filePath: string): Promise<PdfOcrPreparationResult> {
  let pdfJsPackageRoot: string
  let pdfJsEntryPath: string

  try {
    pdfJsPackageRoot = path.dirname(moduleRequire.resolve('pdfjs-dist/package.json'))
    pdfJsEntryPath = moduleRequire.resolve('pdfjs-dist/legacy/build/pdf.mjs')
  } catch {
    throw new Error('[attachments.ocr] pdfjs-dist is not installed. Reinstall dependencies to process PDF attachments.')
  }

  const { getDocument } = await import(pathToFileURL(pdfJsEntryPath).href) as PdfJsModule
  const data = new Uint8Array(await fs.readFile(filePath))
  const cMapUrl = `${path.join(pdfJsPackageRoot, 'cmaps')}${path.sep}`
  const standardFontDataUrl = `${path.join(pdfJsPackageRoot, 'standard_fonts')}${path.sep}`
  const loadingTask = getDocument({
    data,
    cMapUrl,
    cMapPacked: true,
    standardFontDataUrl,
  })

  const pdfDocument = (await loadingTask.promise) as unknown as PdfDocumentProxyLike

  try {
    const pages: PdfPageOcrInput[] = []

    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      const page = await pdfDocument.getPage(pageNumber)

      try {
        const textContent = await page.getTextContent()
        const extractedText = extractPdfTextContent(textContent.items)

        if (extractedText) {
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
      pageCount: pdfDocument.numPages,
      pages,
    }
  } finally {
    await pdfDocument.destroy()
  }
}
