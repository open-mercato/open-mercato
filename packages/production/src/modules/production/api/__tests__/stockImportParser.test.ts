export {}

import {
  validateStockImportRow,
  assertWithinRowCap,
  buildStockImportSummary,
  StockImportRowCapExceededError,
} from '../stockImportParser'

const VALID_ROW = {
  product_id: '11111111-1111-4111-8111-111111111111',
  variant_id: null,
  qty: '10',
  uom: 'pcs',
  batch_number: 'B-001',
  expires_at: null,
}

describe('validateStockImportRow', () => {
  it('accepts a valid row and coerces qty to a number', () => {
    const result = validateStockImportRow(VALID_ROW, 1)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.row.qty).toBe(10)
      expect(result.row.product_id).toBe(VALID_ROW.product_id)
      expect(result.row.batch_number).toBe('B-001')
    }
  })

  it('rejects a row with a non-numeric/zero/negative qty', () => {
    const zero = validateStockImportRow({ ...VALID_ROW, qty: '0' }, 2)
    expect(zero.ok).toBe(false)
    if (!zero.ok) expect(zero.rowNumber).toBe(2)

    const negative = validateStockImportRow({ ...VALID_ROW, qty: '-5' }, 3)
    expect(negative.ok).toBe(false)

    const nonNumeric = validateStockImportRow({ ...VALID_ROW, qty: 'abc' }, 4)
    expect(nonNumeric.ok).toBe(false)
  })

  it('rejects a row with an unrecognized/malformed uom code (not alphanumeric/underscore)', () => {
    const result = validateStockImportRow({ ...VALID_ROW, uom: 'pcs!' }, 5)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.toLowerCase()).toContain('uom')
  })

  it('rejects a row missing product_id or with a malformed uuid', () => {
    const missing = validateStockImportRow({ ...VALID_ROW, product_id: '' }, 6)
    expect(missing.ok).toBe(false)

    const malformed = validateStockImportRow({ ...VALID_ROW, product_id: 'not-a-uuid' }, 7)
    expect(malformed.ok).toBe(false)
  })

  it('accepts a row with batch_number/expires_at omitted (opening-balance-style row)', () => {
    const result = validateStockImportRow({ product_id: VALID_ROW.product_id, variant_id: null, qty: '5', uom: 'kg', batch_number: null, expires_at: null }, 8)
    expect(result.ok).toBe(true)
  })
})

describe('assertWithinRowCap', () => {
  it('does not throw when row count is at or under the cap', () => {
    expect(() => assertWithinRowCap(10_000, 10_000)).not.toThrow()
    expect(() => assertWithinRowCap(1, 10_000)).not.toThrow()
  })

  it('throws StockImportRowCapExceededError (413-style rejection) when row count exceeds the cap', () => {
    expect(() => assertWithinRowCap(10_001, 10_000)).toThrow(StockImportRowCapExceededError)
    try {
      assertWithinRowCap(10_001, 10_000)
    } catch (err) {
      expect(err).toBeInstanceOf(StockImportRowCapExceededError)
      expect((err as StockImportRowCapExceededError).maxRows).toBe(10_000)
      expect((err as StockImportRowCapExceededError).actualRows).toBe(10_001)
    }
  })
})

describe('buildStockImportSummary (partial-summary contract, task 2.2 review follow-up)', () => {
  it('reports the full imported/failed counts with capExceeded: false on a normal run', () => {
    const summary = buildStockImportSummary({
      importedCount: 2,
      errors: [{ row: 3, error: 'qty: Number must be greater than 0' }],
      capExceeded: false,
    })
    expect(summary).toEqual({
      imported: 2,
      failed: 1,
      capExceeded: false,
      errors: [{ row: 3, error: 'qty: Number must be greater than 0' }],
    })
  })

  it('still reports the REAL partial imported/failed counts (not zero, not a bare error) when capExceeded is true', () => {
    // Simulates 200 rows already imported via 1 prior batch before a later
    // batch tripped the row cap — the route must never collapse this into
    // "imported: 0" once real receipts have already been committed.
    const summary = buildStockImportSummary({
      importedCount: 200,
      errors: [],
      capExceeded: true,
    })
    expect(summary.imported).toBe(200)
    expect(summary.failed).toBe(0)
    expect(summary.capExceeded).toBe(true)
    expect(summary.errors).toEqual([])
  })

  it('derives `failed` from errors.length rather than a separately-tracked counter (single source of truth)', () => {
    const errors = [
      { row: 2, error: 'a' },
      { row: 5, error: 'b' },
      { row: 9, error: 'c' },
    ]
    const summary = buildStockImportSummary({ importedCount: 7, errors, capExceeded: false })
    expect(summary.failed).toBe(errors.length)
  })
})
