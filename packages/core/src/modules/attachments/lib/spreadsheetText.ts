import fs from 'fs/promises'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import {
  resolveSpreadsheetMaxCells,
  resolveSpreadsheetMaxConcurrency,
  resolveSpreadsheetMaxSheets,
  resolveSpreadsheetMaxTextChars,
  resolveSpreadsheetMaxUncompressedBytes,
  resolveSpreadsheetMaxWaitQueue,
} from './ocrLimits'
import { readXlsxSheetNames, SPREADSHEET_ENCRYPTED, SPREADSHEET_ENTRY_TOO_LARGE } from './xlsxSheetNames'

const logger = createLogger('attachments').child({ component: 'spreadsheet-text' })

export type SpreadsheetTextLimits = {
  maxUncompressedBytes: number
  maxSheets: number
  maxCells: number
  maxTextChars: number
}

type SpreadsheetCap = 'sheets' | 'cells' | 'text'

type SheetRows = AsyncIterable<{ values: readonly unknown[] }>

type ExtractionState = {
  lines: string[]
  textLength: number
  scannedCells: number
}

type RenderedRow = {
  line: string
  filledCells: number
  overflow: boolean
}

let activeExtractions = 0
const extractionWaitQueue: Array<() => void> = []

/** Test-only: reset in-process spreadsheet concurrency bookkeeping. */
export function resetSpreadsheetConcurrencyStateForTests(): void {
  activeExtractions = 0
  extractionWaitQueue.length = 0
}

async function withSpreadsheetSlot<T>(run: () => Promise<T>): Promise<T> {
  const maxConcurrency = resolveSpreadsheetMaxConcurrency()
  while (activeExtractions >= maxConcurrency) {
    await new Promise<void>((resolve) => {
      extractionWaitQueue.push(resolve)
    })
  }
  activeExtractions += 1
  try {
    return await run()
  } finally {
    activeExtractions -= 1
    extractionWaitQueue.shift()?.()
  }
}

export function resolveSpreadsheetTextLimits(): SpreadsheetTextLimits {
  return {
    maxUncompressedBytes: resolveSpreadsheetMaxUncompressedBytes(),
    maxSheets: resolveSpreadsheetMaxSheets(),
    maxCells: resolveSpreadsheetMaxCells(),
    maxTextChars: resolveSpreadsheetMaxTextChars(),
  }
}

function formatDate(value: Date): string {
  if (Number.isNaN(value.getTime())) return ''
  const iso = value.toISOString()
  return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.slice(0, 19).replace('T', ' ')
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim()
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (value instanceof Date) return formatDate(value)
  if (typeof value === 'object' && 'error' in value && typeof value.error === 'string') return value.error
  return ''
}

function resolveFailureCode(error: unknown): string {
  const { code, name, message } = (error ?? {}) as { code?: unknown; name?: unknown; message?: unknown }
  if (code === SPREADSHEET_ENCRYPTED || name === 'EncryptedFileError') return 'attachments.spreadsheet_encrypted'
  if (code === SPREADSHEET_ENTRY_TOO_LARGE || (typeof message === 'string' && message.includes('possible zip bomb'))) {
    return 'attachments.spreadsheet_entry_too_large'
  }
  return 'attachments.spreadsheet_extraction_failed'
}

function joinLines(state: ExtractionState): string | null {
  const text = state.lines.join('\n').trim()
  return text.length > 0 ? text : null
}

function renderRow(values: readonly unknown[], maxLength: number): RenderedRow {
  const cells: string[] = []
  let length = 0
  let filledCells = 0
  let lastFilledIndex = -1
  for (const value of values) {
    const cell = formatCellValue(value)
    length += cell.length + (cells.length > 0 ? 1 : 0)
    if (cell.length > 0 && length > maxLength) return { line: '', filledCells, overflow: true }
    cells.push(cell)
    if (cell.length > 0) {
      filledCells += 1
      lastFilledIndex = cells.length - 1
    }
  }
  return { line: cells.slice(0, lastFilledIndex + 1).join('\t'), filledCells, overflow: false }
}

async function appendSheet(
  rows: SheetRows,
  heading: string,
  state: ExtractionState,
  limits: SpreadsheetTextLimits,
): Promise<SpreadsheetCap | null> {
  let pendingHeading: string | null = heading
  for await (const row of rows) {
    if (state.scannedCells + row.values.length > limits.maxCells) return 'cells'
    state.scannedCells += row.values.length
    const headingLength = pendingHeading === null ? 0 : pendingHeading.length + 1
    const rendered = renderRow(row.values, limits.maxTextChars - state.textLength - headingLength)
    if (rendered.overflow) return 'text'
    if (rendered.filledCells === 0) continue
    if (pendingHeading !== null) {
      state.lines.push(pendingHeading)
      pendingHeading = null
    }
    state.lines.push(rendered.line)
    state.textLength += headingLength + rendered.line.length + 1
  }
  return null
}

async function readSpreadsheetText(filePath: string, limits: SpreadsheetTextLimits): Promise<string | null> {
  const state: ExtractionState = { lines: [], textLength: 0, scannedCells: 0 }
  try {
    const { streamXlsxRows } = await import('hucre/xlsx')
    const data = await fs.readFile(filePath)
    const sheetNames = readXlsxSheetNames(data, limits.maxUncompressedBytes)
    let truncatedBy: SpreadsheetCap | null = sheetNames.length > limits.maxSheets ? 'sheets' : null
    const sheetCount = Math.min(sheetNames.length, limits.maxSheets)
    for (let sheetIndex = 0; sheetIndex < sheetCount; sheetIndex += 1) {
      const rows = streamXlsxRows(data, { sheet: sheetIndex, maxDecompressedBytes: limits.maxUncompressedBytes })
      const heading = `## ${sheetNames[sheetIndex] || `Sheet ${sheetIndex + 1}`}`
      const cap = await appendSheet(rows, heading, state, limits)
      if (cap !== null) {
        truncatedBy = cap
        break
      }
    }
    if (truncatedBy !== null) {
      logger.warn('Spreadsheet exceeds text-extraction cap; truncating', {
        filePath,
        cap: truncatedBy,
        sheetCount: sheetNames.length,
        maxSheets: limits.maxSheets,
        maxCells: limits.maxCells,
        maxTextChars: limits.maxTextChars,
      })
    }
    return joinLines(state)
  } catch (error) {
    logger.warn('Spreadsheet text extraction failed', { filePath, keptLines: state.lines.length, err: error })
    getTelemetryRuntime()?.reportError(error, {
      module: 'attachments',
      code: resolveFailureCode(error),
    })
    return joinLines(state)
  }
}

export async function extractSpreadsheetText(
  filePath: string,
  limits: SpreadsheetTextLimits = resolveSpreadsheetTextLimits(),
): Promise<string | null> {
  const maxWaitQueue = resolveSpreadsheetMaxWaitQueue()
  if (activeExtractions >= resolveSpreadsheetMaxConcurrency() && extractionWaitQueue.length >= maxWaitQueue) {
    logger.warn('Spreadsheet extraction wait queue full; skipping text extraction', {
      filePath,
      waiting: extractionWaitQueue.length,
      maxWaitQueue,
    })
    return null
  }
  return withSpreadsheetSlot(() => readSpreadsheetText(filePath, limits))
}
