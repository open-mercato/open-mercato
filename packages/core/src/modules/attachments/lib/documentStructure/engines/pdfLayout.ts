import { promises as fs } from 'node:fs'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'
import { openPdfDocument } from '../../pdfJsLoader'
import type {
  DocumentBlock,
  DocumentEngineResult,
  DocumentOutlineEntry,
  DocumentStructureEngine,
  DocumentStructureEngineInput,
} from '../types'
import {
  DocumentStructureFileTooLargeError,
  throwIfDocumentStructureAborted,
  normalizeExtension,
  normalizeMimeType,
  resolveMaxDocumentStructureBytes,
} from './text'

const PDF_LAYOUT_ENGINE_VERSION = 1
const DEFAULT_MAX_STRUCTURE_PAGES = 1000
const DEFAULT_OCR_MIN_CHARS_PER_PAGE = 40
const MAX_OUTLINE_ENTRIES = 10_000
const MAX_OUTLINE_DEPTH = 16
const PDF_MIME_TYPES = new Set(['application/pdf', 'application/x-pdf'])

const ROW_TOLERANCE_RATIO = 0.4
const MIN_ROW_TOLERANCE = 2
const WORD_GAP_RATIO = 0.15
const FRAGMENT_GAP_RATIO = 1.5
const MIN_FRAGMENT_GAP = 12
const GUTTER_SCAN_START = 0.3
const GUTTER_SCAN_END = 0.7
const GUTTER_SCAN_STEP = 1
const MIN_COLUMN_LINES = 3
const MAX_GUTTER_CROSSING_RATIO = 0.25
const PARAGRAPH_GAP_RATIO = 1.4
const FALLBACK_PARAGRAPH_GAP_RATIO = 1.5
const MIN_PARAGRAPH_GAP_RATIO = 1.05
const FONT_SIZE_TOLERANCE = 0.5
const INDENT_RATIO = 0.8
const MIN_INDENT = 6
const SHORT_LINE_RATIO = 0.85
const FONT_SIZE_PRECISION = 100

const NUMBERED_LINE_START =
  /^(?:§+\s*\d|\d{1,3}(?:\.\d{1,3}){0,5}\.?\s|\((?:\d{1,3}|[a-z]{1,5})\)\s|[a-z]{1,5}\)\s|(?:Part|PART|Chapter|CHAPTER|Section|SECTION|Article|ARTICLE|Art\.|Annex|ANNEX|Appendix|APPENDIX)\s+\S)/

export type PdfLayoutTextRun = {
  text: string
  x: number
  y: number
  width: number
  fontSize: number
  bold: boolean
}

export type PdfLayoutPage = {
  pageNumber: number
  width: number
  height: number
  runs: PdfLayoutTextRun[]
}

export type PdfLayoutSource = {
  numPages: number
  readPage(pageNumber: number): Promise<PdfLayoutPage>
  readOutline(): Promise<DocumentOutlineEntry[]>
  close(): Promise<void>
}

export type PdfLayoutSourceLoader = (data: Uint8Array) => Promise<PdfLayoutSource>

export type PdfLayoutEngineOptions = {
  loadSource?: PdfLayoutSourceLoader
  maxBytes?: () => number
  maxPages?: () => number
  ocrMinCharsPerPage?: () => number
}

type LayoutFragment = {
  text: string
  x0: number
  x1: number
  y: number
  fontSize: number
  bold: boolean
}

type LayoutRow = {
  y: number
  fragments: LayoutFragment[]
}

type LayoutLine = LayoutFragment & { segment: number }

type OutlineNodeLike = {
  title: string
  dest: string | unknown[] | null
  items: OutlineNodeLike[]
}

export class DocumentStructurePdfEncryptedError extends Error {
  readonly code = 'encrypted_pdf'

  constructor() {
    super('[internal] document structure input is a password-protected PDF')
    this.name = 'DocumentStructurePdfEncryptedError'
  }
}

function readNonNegativeIntEnv(name: string, fallback: number, minimum: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < minimum) return fallback
  return Math.floor(parsed)
}

export function resolveMaxDocumentStructurePages(): number {
  return readNonNegativeIntEnv('OM_ATTACHMENT_STRUCTURE_MAX_PAGES', DEFAULT_MAX_STRUCTURE_PAGES, 1)
}

export function resolveOcrMinCharsPerPage(): number {
  return readNonNegativeIntEnv('OM_ATTACHMENT_STRUCTURE_OCR_MIN_CHARS_PER_PAGE', DEFAULT_OCR_MIN_CHARS_PER_PAGE, 0)
}

export function isPdfPasswordError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const name = 'name' in error ? error.name : null
  return name === 'PasswordException'
}

export function countPageChars(runs: readonly PdfLayoutTextRun[]): number {
  return runs.reduce((total, run) => total + run.text.replace(/\s+/g, '').length, 0)
}

function roundFontSize(size: number): number {
  return Math.round(size * FONT_SIZE_PRECISION) / FONT_SIZE_PRECISION
}

function joinRunText(left: string, right: string, gap: number, fontSize: number): string {
  if (left.length === 0) return right
  if (/\s$/.test(left) || /^\s/.test(right)) return `${left}${right}`
  return gap > fontSize * WORD_GAP_RATIO ? `${left} ${right}` : `${left}${right}`
}

function dominantStyle(runs: readonly PdfLayoutTextRun[]): { fontSize: number; bold: boolean } {
  const weightBySize = new Map<number, number>()
  let boldChars = 0
  let totalChars = 0
  for (const run of runs) {
    const chars = Math.max(1, run.text.trim().length)
    const size = roundFontSize(run.fontSize)
    weightBySize.set(size, (weightBySize.get(size) ?? 0) + chars)
    totalChars += chars
    if (run.bold) boldChars += chars
  }
  let fontSize = 0
  let bestWeight = -1
  for (const [size, weight] of weightBySize) {
    if (weight > bestWeight || (weight === bestWeight && size > fontSize)) {
      fontSize = size
      bestWeight = weight
    }
  }
  return { fontSize, bold: totalChars > 0 && boldChars === totalChars }
}

function buildFragment(runs: readonly PdfLayoutTextRun[]): LayoutFragment {
  let text = ''
  let previousEnd: number | null = null
  for (const run of runs) {
    const gap = previousEnd === null ? 0 : run.x - previousEnd
    text = joinRunText(text, run.text, gap, run.fontSize)
    previousEnd = Math.max(previousEnd ?? run.x + run.width, run.x + run.width)
  }
  const style = dominantStyle(runs)
  return {
    text: text.replace(/\s+/g, ' ').trim(),
    x0: Math.min(...runs.map((run) => run.x)),
    x1: Math.max(...runs.map((run) => run.x + run.width)),
    y: Math.min(...runs.map((run) => run.y)),
    fontSize: style.fontSize,
    bold: style.bold,
  }
}

function groupRows(runs: readonly PdfLayoutTextRun[]): PdfLayoutTextRun[][] {
  const sorted = [...runs].sort((left, right) => left.y - right.y || left.x - right.x)
  const rows: PdfLayoutTextRun[][] = []
  let current: PdfLayoutTextRun[] = []
  let anchorY = 0
  let anchorSize = 0
  for (const run of sorted) {
    const tolerance = Math.max(MIN_ROW_TOLERANCE, Math.min(anchorSize, run.fontSize) * ROW_TOLERANCE_RATIO)
    if (current.length > 0 && Math.abs(run.y - anchorY) <= tolerance) {
      current.push(run)
      continue
    }
    if (current.length > 0) rows.push(current)
    current = [run]
    anchorY = run.y
    anchorSize = run.fontSize
  }
  if (current.length > 0) rows.push(current)
  return rows
}

function splitRowIntoFragments(rowRuns: readonly PdfLayoutTextRun[]): LayoutFragment[] {
  const sorted = [...rowRuns].sort((left, right) => left.x - right.x)
  const fragments: LayoutFragment[] = []
  let current: PdfLayoutTextRun[] = []
  let currentEnd = 0
  for (const run of sorted) {
    const threshold = Math.max(MIN_FRAGMENT_GAP, run.fontSize * FRAGMENT_GAP_RATIO)
    if (current.length > 0 && run.x - currentEnd > threshold) {
      fragments.push(buildFragment(current))
      current = []
    }
    current.push(run)
    currentEnd = current.length === 1 ? run.x + run.width : Math.max(currentEnd, run.x + run.width)
  }
  if (current.length > 0) fragments.push(buildFragment(current))
  return fragments.filter((fragment) => fragment.text.length > 0)
}

function countWithinSpan(fragments: readonly LayoutFragment[], reference: readonly LayoutFragment[]): number {
  const top = Math.min(...reference.map((fragment) => fragment.y))
  const bottom = Math.max(...reference.map((fragment) => fragment.y))
  return fragments.filter((fragment) => fragment.y >= top && fragment.y <= bottom).length
}

function isSideBySide(fragments: readonly LayoutFragment[], gutter: number): boolean {
  const leftFragments = fragments.filter((fragment) => fragment.x1 <= gutter)
  const rightFragments = fragments.filter((fragment) => fragment.x0 >= gutter)
  if (leftFragments.length < MIN_COLUMN_LINES || rightFragments.length < MIN_COLUMN_LINES) return false
  return (
    countWithinSpan(leftFragments, rightFragments) >= MIN_COLUMN_LINES &&
    countWithinSpan(rightFragments, leftFragments) >= MIN_COLUMN_LINES
  )
}

function detectColumnGutter(fragments: readonly LayoutFragment[], pageWidth: number): number | null {
  if (fragments.length < MIN_COLUMN_LINES * 2 || pageWidth <= 0) return null
  type GutterRun = { start: number; end: number; crossing: number }
  const runs: GutterRun[] = []
  let current: GutterRun | null = null
  for (
    let gutter = pageWidth * GUTTER_SCAN_START;
    gutter <= pageWidth * GUTTER_SCAN_END;
    gutter += GUTTER_SCAN_STEP
  ) {
    let left = 0
    let right = 0
    let crossing = 0
    for (const fragment of fragments) {
      if (fragment.x1 <= gutter) left += 1
      else if (fragment.x0 >= gutter) right += 1
      else crossing += 1
    }
    const valid =
      left >= MIN_COLUMN_LINES &&
      right >= MIN_COLUMN_LINES &&
      crossing <= fragments.length * MAX_GUTTER_CROSSING_RATIO
    if (valid && current && current.crossing === crossing) {
      current.end = gutter
      continue
    }
    if (current) runs.push(current)
    current = valid ? { start: gutter, end: gutter, crossing } : null
  }
  if (current) runs.push(current)
  const ranked = [...runs].sort(
    (left, right) => left.crossing - right.crossing || right.end - right.start - (left.end - left.start),
  )
  for (const run of ranked) {
    const gutter = (run.start + run.end) / 2
    if (isSideBySide(fragments, gutter)) return gutter
  }
  return null
}

function mergeRowFragments(fragments: readonly LayoutFragment[]): LayoutFragment {
  const style = dominantStyle(
    fragments.map((fragment) => ({
      text: fragment.text,
      x: fragment.x0,
      y: fragment.y,
      width: fragment.x1 - fragment.x0,
      fontSize: fragment.fontSize,
      bold: fragment.bold,
    })),
  )
  return {
    text: fragments.map((fragment) => fragment.text).join(' '),
    x0: Math.min(...fragments.map((fragment) => fragment.x0)),
    x1: Math.max(...fragments.map((fragment) => fragment.x1)),
    y: Math.min(...fragments.map((fragment) => fragment.y)),
    fontSize: style.fontSize,
    bold: style.bold,
  }
}

function orderLines(rows: readonly LayoutRow[], pageWidth: number): LayoutLine[] {
  const allFragments = rows.flatMap((row) => row.fragments)
  const gutter = detectColumnGutter(allFragments, pageWidth)
  if (gutter === null) {
    return rows.map((row) => ({ ...mergeRowFragments(row.fragments), segment: 0 }))
  }
  const lines: LayoutLine[] = []
  let segment = 0
  let leftBuffer: LayoutFragment[] = []
  let rightBuffer: LayoutFragment[] = []
  const flushColumns = () => {
    if (leftBuffer.length > 0) {
      for (const fragment of leftBuffer) lines.push({ ...fragment, segment })
      segment += 1
    }
    if (rightBuffer.length > 0) {
      for (const fragment of rightBuffer) lines.push({ ...fragment, segment })
      segment += 1
    }
    leftBuffer = []
    rightBuffer = []
  }
  for (const row of rows) {
    const crossing = row.fragments.filter((fragment) => fragment.x0 < gutter && fragment.x1 > gutter)
    if (crossing.length > 0) {
      flushColumns()
      lines.push({ ...mergeRowFragments(row.fragments), segment })
      segment += 1
      continue
    }
    for (const fragment of row.fragments) {
      if (fragment.x1 <= gutter) leftBuffer.push(fragment)
      else rightBuffer.push(fragment)
    }
  }
  flushColumns()
  return lines
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

function typicalLineGap(lines: readonly LayoutLine[]): number | null {
  const gaps: number[] = []
  for (let index = 1; index < lines.length; index += 1) {
    const previous = lines[index - 1]
    const current = lines[index]
    if (previous.segment !== current.segment) continue
    if (Math.abs(previous.fontSize - current.fontSize) > FONT_SIZE_TOLERANCE) continue
    const gap = current.y - previous.y
    if (gap > 0) gaps.push(gap)
  }
  return median(gaps)
}

function startsNewBlock(
  previous: LayoutLine,
  current: LayoutLine,
  blockLeft: number,
  segmentRight: number,
  typicalGap: number | null,
): boolean {
  if (previous.segment !== current.segment) return true
  if (Math.abs(previous.fontSize - current.fontSize) > FONT_SIZE_TOLERANCE) return true
  if (previous.bold !== current.bold) return true
  if (NUMBERED_LINE_START.test(current.text)) return true
  const largerFont = Math.max(previous.fontSize, current.fontSize)
  const gap = current.y - previous.y
  const gapThreshold =
    typicalGap === null
      ? largerFont * FALLBACK_PARAGRAPH_GAP_RATIO
      : Math.max(typicalGap * PARAGRAPH_GAP_RATIO, largerFont * MIN_PARAGRAPH_GAP_RATIO)
  if (gap <= 0 || gap > gapThreshold) return true
  const indent = Math.max(MIN_INDENT, largerFont * INDENT_RATIO)
  const segmentWidth = segmentRight - blockLeft
  const previousIsShort = segmentWidth > 0 && previous.x1 - blockLeft < segmentWidth * SHORT_LINE_RATIO
  return current.x0 - blockLeft > indent && previousIsShort
}

export function layoutPdfPage(page: PdfLayoutPage): DocumentBlock[] {
  const runs = page.runs.filter((run) => run.text.trim().length > 0 && Number.isFinite(run.x) && Number.isFinite(run.y))
  if (runs.length === 0) return []
  const rows: LayoutRow[] = groupRows(runs)
    .map((rowRuns) => {
      const fragments = splitRowIntoFragments(rowRuns)
      return { y: Math.min(...fragments.map((fragment) => fragment.y)), fragments }
    })
    .filter((row) => row.fragments.length > 0)
  const lines = orderLines(rows, page.width)
  const typicalGap = typicalLineGap(lines)
  const segmentRight = new Map<number, number>()
  for (const line of lines) segmentRight.set(line.segment, Math.max(segmentRight.get(line.segment) ?? line.x1, line.x1))

  const blocks: DocumentBlock[] = []
  let currentLines: LayoutLine[] = []
  const flush = () => {
    if (currentLines.length === 0) return
    const style = dominantStyle(
      currentLines.map((line) => ({
        text: line.text,
        x: line.x0,
        y: line.y,
        width: line.x1 - line.x0,
        fontSize: line.fontSize,
        bold: line.bold,
      })),
    )
    blocks.push({
      text: currentLines.map((line) => line.text).join('\n'),
      page: page.pageNumber,
      source: 'text_layer',
      fontSize: style.fontSize > 0 ? style.fontSize : null,
      bold: style.bold,
      x: roundFontSize(Math.min(...currentLines.map((line) => line.x0))),
      y: roundFontSize(currentLines[0].y),
    })
    currentLines = []
  }
  for (const line of lines) {
    const previous = currentLines[currentLines.length - 1]
    if (previous) {
      const blockLeft = Math.min(...currentLines.map((candidate) => candidate.x0))
      if (startsNewBlock(previous, line, blockLeft, segmentRight.get(line.segment) ?? line.x1, typicalGap)) flush()
    }
    currentLines.push(line)
  }
  flush()
  return blocks
}

function isTextItem(item: unknown): item is TextItem {
  return Boolean(item) && typeof item === 'object' && item !== null && 'str' in item && 'transform' in item
}

function readFontWeights(page: PDFPageProxy, fontNames: ReadonlySet<string>): Map<string, boolean> {
  const weights = new Map<string, boolean>()
  for (const fontName of fontNames) {
    if (!page.commonObjs.has(fontName)) continue
    const font: unknown = page.commonObjs.get(fontName)
    if (!font || typeof font !== 'object') continue
    const declaredBold = 'bold' in font && font.bold === true
    const declaredBlack = 'black' in font && font.black === true
    const name = 'name' in font && typeof font.name === 'string' ? font.name : ''
    weights.set(fontName, declaredBold || declaredBlack || /bold|black|heavy|semibold|demi/i.test(name))
  }
  return weights
}

async function readPdfJsPage(pdfDocument: PDFDocumentProxy, pageNumber: number): Promise<PdfLayoutPage> {
  const page = await pdfDocument.getPage(pageNumber)
  try {
    const viewport = page.getViewport({ scale: 1 })
    const textContent = await page.getTextContent()
    const items = textContent.items.filter(isTextItem).filter((item) => item.str.trim().length > 0)
    let weights = new Map<string, boolean>()
    if (items.length > 0) {
      try {
        await page.getOperatorList()
        weights = readFontWeights(page, new Set(items.map((item) => item.fontName)))
      } catch {
        weights = new Map<string, boolean>()
      }
    }
    const runs: PdfLayoutTextRun[] = items.map((item) => {
      const [scaleX, skewX, skewY, scaleY, translateX, translateY] = item.transform.map((value: unknown) =>
        typeof value === 'number' ? value : 0,
      )
      const fontSize = Math.hypot(scaleX, skewX) || Math.hypot(skewY, scaleY) || item.height || 0
      const [viewX, viewY] = viewport.convertToViewportPoint(translateX, translateY)
      return {
        text: item.str,
        x: viewX,
        y: viewY,
        width: item.width,
        fontSize,
        bold: weights.get(item.fontName) === true,
      }
    })
    return { pageNumber, width: viewport.width, height: viewport.height, runs }
  } finally {
    page.cleanup()
  }
}

function toOutlineNode(value: unknown): OutlineNodeLike | null {
  if (!value || typeof value !== 'object') return null
  const title = 'title' in value && typeof value.title === 'string' ? value.title : ''
  const rawDest = 'dest' in value ? value.dest : null
  const dest = typeof rawDest === 'string' || Array.isArray(rawDest) ? rawDest : null
  const rawItems = 'items' in value && Array.isArray(value.items) ? value.items : []
  const items = rawItems.map(toOutlineNode).filter((node): node is OutlineNodeLike => node !== null)
  return { title, dest, items }
}

async function resolveOutlinePage(pdfDocument: PDFDocumentProxy, dest: OutlineNodeLike['dest']): Promise<number | null> {
  try {
    const explicit = typeof dest === 'string' ? await pdfDocument.getDestination(dest) : dest
    if (!Array.isArray(explicit) || explicit.length === 0) return null
    const target: unknown = explicit[0]
    if (typeof target === 'number' && Number.isInteger(target)) return target + 1
    if (target && typeof target === 'object' && 'num' in target && 'gen' in target) {
      const pageIndex = await pdfDocument.getPageIndex(target as Parameters<PDFDocumentProxy['getPageIndex']>[0])
      return pageIndex + 1
    }
    return null
  } catch {
    return null
  }
}

async function readPdfJsOutline(pdfDocument: PDFDocumentProxy): Promise<DocumentOutlineEntry[]> {
  const rawOutline: unknown = await pdfDocument.getOutline().catch(() => null)
  if (!Array.isArray(rawOutline)) return []
  const entries: DocumentOutlineEntry[] = []
  const visit = async (nodes: readonly OutlineNodeLike[], depth: number) => {
    for (const node of nodes) {
      if (entries.length >= MAX_OUTLINE_ENTRIES) return
      const title = node.title.replace(/\s+/g, ' ').trim()
      if (title.length > 0) {
        entries.push({ title, depth, page: await resolveOutlinePage(pdfDocument, node.dest) })
      }
      if (depth < MAX_OUTLINE_DEPTH && node.items.length > 0) await visit(node.items, depth + 1)
    }
  }
  await visit(
    rawOutline.map(toOutlineNode).filter((node): node is OutlineNodeLike => node !== null),
    1,
  )
  return entries
}

export const loadPdfJsLayoutSource: PdfLayoutSourceLoader = async (data) => {
  const loadingTask = await openPdfDocument(data)
  let pdfDocument: PDFDocumentProxy
  try {
    pdfDocument = await loadingTask.promise
  } catch (error) {
    await loadingTask.destroy().catch(() => undefined)
    if (isPdfPasswordError(error)) throw new DocumentStructurePdfEncryptedError()
    throw error
  }
  return {
    numPages: pdfDocument.numPages,
    readPage: (pageNumber) => readPdfJsPage(pdfDocument, pageNumber),
    readOutline: () => readPdfJsOutline(pdfDocument),
    close: () => loadingTask.destroy(),
  }
}

function resolvePageLimit(numPages: number, configuredMax: number, requestedMax?: number): number {
  const requested = requestedMax !== undefined && Number.isFinite(requestedMax) && requestedMax > 0
    ? Math.floor(requestedMax)
    : configuredMax
  return Math.max(0, Math.min(Math.floor(numPages), configuredMax, requested))
}

export function createPdfLayoutEngine(options: PdfLayoutEngineOptions = {}): DocumentStructureEngine {
  const loadSource = options.loadSource ?? loadPdfJsLayoutSource
  const resolveMaxBytes = options.maxBytes ?? resolveMaxDocumentStructureBytes
  const resolveMaxPages = options.maxPages ?? resolveMaxDocumentStructurePages
  const resolveOcrThreshold = options.ocrMinCharsPerPage ?? resolveOcrMinCharsPerPage
  return {
    id: 'pdf_layout',
    version: PDF_LAYOUT_ENGINE_VERSION,
    supports(mimeType: string, extension?: string | null): boolean {
      if (normalizeExtension(extension) === 'pdf') return true
      return PDF_MIME_TYPES.has(normalizeMimeType(mimeType))
    },
    async extract(input: DocumentStructureEngineInput): Promise<DocumentEngineResult> {
      const maxBytes = resolveMaxBytes()
      const stats = await fs.stat(input.filePath)
      if (stats.size > maxBytes) throw new DocumentStructureFileTooLargeError(stats.size, maxBytes)
      const data = new Uint8Array(await fs.readFile(input.filePath))
      throwIfDocumentStructureAborted(input.signal)
      const source = await loadSource(data)
      try {
        const pageLimit = resolvePageLimit(source.numPages, resolveMaxPages(), input.maxPages)
        const ocrThreshold = resolveOcrThreshold()
        const blocks: DocumentBlock[] = []
        const pageCharCounts: number[] = []
        const unreadablePages: number[] = []
        for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
          throwIfDocumentStructureAborted(input.signal)
          const page = await source.readPage(pageNumber)
          const charCount = countPageChars(page.runs)
          pageCharCounts.push(charCount)
          if (charCount < ocrThreshold) unreadablePages.push(pageNumber)
          blocks.push(...layoutPdfPage(page))
        }
        return {
          blocks,
          pageCount: source.numPages,
          pageCharCounts,
          outline: await source.readOutline(),
          ocrPageCount: 0,
          unreadablePages,
        }
      } finally {
        await source.close()
      }
    },
  }
}

export const pdfLayoutStructureEngine: DocumentStructureEngine = createPdfLayoutEngine()
