import { readEndpointRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'
import type { RateLimitConfig } from '@open-mercato/shared/lib/ratelimit/types'

const DEFAULT_MAX_OCR_PAGES = 50
const DEFAULT_OCR_PAGE_TIMEOUT_MS = 60_000
const DEFAULT_OCR_MAX_OUTPUT_TOKENS = 4_096
const DEFAULT_OCR_MAX_CONCURRENCY = 2
const DEFAULT_OCR_MAX_WAIT_QUEUE = 50
const DEFAULT_SPREADSHEET_MAX_UNCOMPRESSED_BYTES = 5 * 1024 * 1024
const DEFAULT_SPREADSHEET_MAX_SHEETS = 10
const DEFAULT_SPREADSHEET_MAX_CELLS = 1_000_000
const DEFAULT_SPREADSHEET_MAX_TEXT_CHARS = 1_000_000
const DEFAULT_SPREADSHEET_MAX_CONCURRENCY = 2
const DEFAULT_SPREADSHEET_MAX_WAIT_QUEUE = 20

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.floor(parsed)
}

/** Cap PDF pages processed for OCR / text extraction (env: OM_ATTACHMENT_OCR_MAX_PAGES). */
export function resolveMaxOcrPages(): number {
  return parsePositiveInt(process.env.OM_ATTACHMENT_OCR_MAX_PAGES, DEFAULT_MAX_OCR_PAGES)
}

/** Per-page LLM OCR call timeout in ms (env: OM_ATTACHMENT_OCR_PAGE_TIMEOUT_MS). */
export function resolveOcrPageTimeoutMs(): number {
  return parsePositiveInt(process.env.OM_ATTACHMENT_OCR_PAGE_TIMEOUT_MS, DEFAULT_OCR_PAGE_TIMEOUT_MS)
}

/** Max output tokens for a single OCR generateText call (env: OM_ATTACHMENT_OCR_MAX_OUTPUT_TOKENS). */
export function resolveOcrMaxOutputTokens(): number {
  return parsePositiveInt(process.env.OM_ATTACHMENT_OCR_MAX_OUTPUT_TOKENS, DEFAULT_OCR_MAX_OUTPUT_TOKENS)
}

/** Max concurrent in-process OCR jobs (env: OM_ATTACHMENT_OCR_MAX_CONCURRENCY). */
export function resolveOcrMaxConcurrency(): number {
  return parsePositiveInt(process.env.OM_ATTACHMENT_OCR_MAX_CONCURRENCY, DEFAULT_OCR_MAX_CONCURRENCY)
}

/** Max waiters blocked on the in-process OCR concurrency slot (env: OM_ATTACHMENT_OCR_MAX_WAIT_QUEUE). */
export function resolveOcrMaxWaitQueue(): number {
  return parsePositiveInt(process.env.OM_ATTACHMENT_OCR_MAX_WAIT_QUEUE, DEFAULT_OCR_MAX_WAIT_QUEUE)
}

/**
 * Max bytes any single spreadsheet archive entry may decompress to (env: OM_ATTACHMENT_SPREADSHEET_MAX_UNCOMPRESSED_BYTES).
 * Kept low on purpose: parsing the shared-strings table peaks at roughly 40-50x its size in memory.
 */
export function resolveSpreadsheetMaxUncompressedBytes(): number {
  return parsePositiveInt(
    process.env.OM_ATTACHMENT_SPREADSHEET_MAX_UNCOMPRESSED_BYTES,
    DEFAULT_SPREADSHEET_MAX_UNCOMPRESSED_BYTES,
  )
}

/** Max worksheets read from one spreadsheet (env: OM_ATTACHMENT_SPREADSHEET_MAX_SHEETS). */
export function resolveSpreadsheetMaxSheets(): number {
  return parsePositiveInt(process.env.OM_ATTACHMENT_SPREADSHEET_MAX_SHEETS, DEFAULT_SPREADSHEET_MAX_SHEETS)
}

/** Max grid cells scanned from one spreadsheet across all sheets, empty ones included (env: OM_ATTACHMENT_SPREADSHEET_MAX_CELLS). */
export function resolveSpreadsheetMaxCells(): number {
  return parsePositiveInt(process.env.OM_ATTACHMENT_SPREADSHEET_MAX_CELLS, DEFAULT_SPREADSHEET_MAX_CELLS)
}

/** Max characters of text extracted from one spreadsheet (env: OM_ATTACHMENT_SPREADSHEET_MAX_TEXT_CHARS). */
export function resolveSpreadsheetMaxTextChars(): number {
  return parsePositiveInt(process.env.OM_ATTACHMENT_SPREADSHEET_MAX_TEXT_CHARS, DEFAULT_SPREADSHEET_MAX_TEXT_CHARS)
}

/** Max spreadsheets parsed at once per process; uploads beyond it wait for a slot (env: OM_ATTACHMENT_SPREADSHEET_MAX_CONCURRENCY). */
export function resolveSpreadsheetMaxConcurrency(): number {
  return parsePositiveInt(process.env.OM_ATTACHMENT_SPREADSHEET_MAX_CONCURRENCY, DEFAULT_SPREADSHEET_MAX_CONCURRENCY)
}

/** Max uploads waiting for a spreadsheet slot; beyond it extraction is skipped (env: OM_ATTACHMENT_SPREADSHEET_MAX_WAIT_QUEUE). */
export function resolveSpreadsheetMaxWaitQueue(): number {
  return parsePositiveInt(process.env.OM_ATTACHMENT_SPREADSHEET_MAX_WAIT_QUEUE, DEFAULT_SPREADSHEET_MAX_WAIT_QUEUE)
}

/** How many PDF pages to iterate given document length and the configured cap. */
export function resolvePdfPageIterationLimit(numPages: number, maxPages: number = resolveMaxOcrPages()): number {
  if (!Number.isFinite(numPages) || numPages <= 0) return 0
  if (!Number.isFinite(maxPages) || maxPages <= 0) return 0
  return Math.min(Math.floor(numPages), Math.floor(maxPages))
}

/**
 * Per-tenant/user upload throttle for POST /api/attachments.
 * Env: RATE_LIMIT_ATTACHMENTS_UPLOAD_{POINTS,DURATION,BLOCK_DURATION}.
 */
export function resolveAttachmentsUploadRateLimitConfig(): RateLimitConfig {
  // Default sits above typical multi-file library batches (dialog has no hard
  // file cap). Client retry/partial-progress UX for rejected mid-batch files is
  // tracked in https://github.com/open-mercato/open-mercato/issues/6397.
  return readEndpointRateLimitConfig('ATTACHMENTS_UPLOAD', {
    points: 100,
    duration: 60,
    keyPrefix: 'attachments_upload',
  })
}
