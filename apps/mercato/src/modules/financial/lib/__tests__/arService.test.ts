/** @jest-environment node */
/**
 * Pins the aging boundaries and the reconciliation figure.
 *
 * An off-by-one at a bucket edge is invisible in the UI — the row still appears,
 * just in the neighbouring column — and a plugged reconciliation delta is worse
 * than none, so both are asserted directly.
 */
import { buildAging, bucketForDueDate, type ArInvoiceRow } from '../arService'

const TODAY = '2026-10-19'

function invoice(overrides: Partial<ArInvoiceRow> = {}): ArInvoiceRow {
  return {
    id: 'inv-1',
    invoiceNumber: 'INV-1',
    customerEntityId: 'customer-1',
    customerName: 'Customer',
    issueDate: '2026-09-01',
    dueDate: TODAY,
    currencyCode: 'SAR',
    grossAmount: '1150.00',
    outstandingAmount: '1150.00',
    bucket: 'current',
    ...overrides,
  }
}

describe('aging buckets', () => {
  it('puts a due-today or future invoice in current', () => {
    expect(bucketForDueDate(TODAY, TODAY)).toBe('current')
    expect(bucketForDueDate('2026-11-01', TODAY)).toBe('current')
    expect(bucketForDueDate(null, TODAY)).toBe('current')
  })

  it('places each boundary in the bucket it names', () => {
    expect(bucketForDueDate('2026-10-18', TODAY)).toBe('days1to30')
    expect(bucketForDueDate('2026-09-19', TODAY)).toBe('days1to30')
    expect(bucketForDueDate('2026-09-18', TODAY)).toBe('days31to60')
    expect(bucketForDueDate('2026-08-20', TODAY)).toBe('days31to60')
    expect(bucketForDueDate('2026-08-19', TODAY)).toBe('days61to90')
    expect(bucketForDueDate('2026-07-21', TODAY)).toBe('days61to90')
    expect(bucketForDueDate('2026-07-20', TODAY)).toBe('days90plus')
  })
})

describe('aging totals', () => {
  it('counts and sums each bucket and reports the ledger delta', () => {
    const result = buildAging([
      invoice({ id: 'a', outstandingAmount: '100.00', bucket: 'current' }),
      invoice({ id: 'b', outstandingAmount: '200.00', bucket: 'current' }),
      invoice({ id: 'c', outstandingAmount: '50.00', bucket: 'days31to60' }),
    ], '375.00', TODAY)
    expect(result.buckets.current).toEqual({ count: 2, amount: '300.00' })
    expect(result.buckets.days31to60).toEqual({ count: 1, amount: '50.00' })
    expect(result.buckets.days90plus).toEqual({ count: 0, amount: '0.00' })
    expect(result.totalOutstanding).toBe('350.00')
    expect(result.reconciliationDelta).toBe('25.00')
  })

  it('reports a zero delta when the ledger agrees', () => {
    const result = buildAging([invoice({ outstandingAmount: '1150.00' })], '1150.00', TODAY)
    expect(result.reconciliationDelta).toBe('0.00')
  })
})
