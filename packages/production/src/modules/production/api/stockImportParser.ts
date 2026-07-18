import { stockImportRowSchema, STOCK_IMPORT_MAX_ROWS, type StockImportRow } from '../data/validators.js'

/**
 * Pure CSV-row validator for `api/stock/import/route.ts`. Kept free of any
 * I/O (no request/em/container) so it is unit-testable without a DB —
 * `api/__tests__/stockImportParser.test.ts` exercises it directly.
 */

export type StockImportRowSuccess = { rowNumber: number; ok: true; row: StockImportRow }
export type StockImportRowFailure = { rowNumber: number; ok: false; error: string }
export type StockImportRowResult = StockImportRowSuccess | StockImportRowFailure

/**
 * Validates one CSV data row (1-indexed `rowNumber`, matching the row's
 * position for a user-facing error report) against `stockImportRowSchema`.
 * `raw` mirrors the shape `sync_excel`'s CSV parser produces
 * (`CsvPreviewRow` — a record of column name to string-or-null).
 */
export function validateStockImportRow(
  raw: Record<string, string | null | undefined>,
  rowNumber: number,
): StockImportRowResult {
  const parsed = stockImportRowSchema.safeParse(raw)
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]
    const error = firstIssue
      ? `${firstIssue.path.length ? firstIssue.path.join('.') + ': ' : ''}${firstIssue.message}`
      : 'Invalid row'
    return { rowNumber, ok: false, error }
  }
  return { rowNumber, ok: true, row: parsed.data }
}

/** Thrown when a CSV import exceeds {@link STOCK_IMPORT_MAX_ROWS} — the
 * route maps this to a 413-style rejection before processing any row. */
export class StockImportRowCapExceededError extends Error {
  constructor(
    public readonly maxRows: number,
    public readonly actualRows: number,
  ) {
    super(`[internal] CSV import exceeds the maximum row cap (${maxRows}); received at least ${actualRows} rows`)
    this.name = 'StockImportRowCapExceededError'
  }
}

/** Guards a CSV import against unbounded memory/time cost. Called by the
 * route as rows stream in, so an oversized file is rejected as soon as it
 * crosses the cap rather than after fully buffering it. */
export function assertWithinRowCap(rowCount: number, maxRows: number = STOCK_IMPORT_MAX_ROWS): void {
  if (rowCount > maxRows) {
    throw new StockImportRowCapExceededError(maxRows, rowCount)
  }
}

/**
 * The JSON body `api/stock/import/route.ts` returns on both the 200 (fully
 * processed) and 413 (row cap exceeded mid-stream) paths. `capExceeded` is
 * the caller's signal to render the outcome distinctly; `imported`/`failed`
 * are ALWAYS the real counts already committed by prior batches — never a
 * bare error with no counts (review finding, task 2.2 follow-up: a batch
 * that already ran before the cap tripped created real receipts, so an
 * operator being told "nothing happened" would be misleading and could lead
 * to a duplicate re-upload).
 */
export type StockImportSummary = {
  imported: number
  failed: number
  capExceeded: boolean
  errors: Array<{ row: number; error: string }>
}

/** Builds the response-body contract above from the running counters the
 * route accumulates while streaming — pure, so the shape is unit-testable
 * without driving `STOCK_IMPORT_MAX_ROWS` rows through a real request. */
export function buildStockImportSummary(params: {
  importedCount: number
  errors: Array<{ row: number; error: string }>
  capExceeded: boolean
}): StockImportSummary {
  return {
    imported: params.importedCount,
    failed: params.errors.length,
    capExceeded: params.capExceeded,
    errors: params.errors,
  }
}
