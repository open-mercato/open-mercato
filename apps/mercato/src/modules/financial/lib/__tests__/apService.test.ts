/** @jest-environment node */
/**
 * Pins the AP line arithmetic, withholding and aging totals.
 *
 * The vendor invoice totals are computed server-side and posted to the ledger, so
 * an error here pays the wrong amount. Withholding is asserted at the published
 * rates because the net is what the bank transfer carries.
 */
import {
  buildApAging,
  computeApInvoiceTotals,
  computeApLine,
  computeWithholding,
  type ApAgingInvoice,
} from '../apService'

describe('AP line arithmetic', () => {
  it('computes net, tax and gross from quantity and unit price', () => {
    expect(computeApLine({
      description: 'Service',
      expenseAccountId: 'acc-1',
      quantity: '2',
      unitPriceNet: '500',
      taxRate: '15',
    })).toMatchObject({
      totalNetAmount: '1000.00',
      taxAmount: '150.00',
      totalGrossAmount: '1150.00',
    })
  })

  it('uses a stated tax amount when the vendor provides one', () => {
    expect(computeApLine({
      description: 'Service',
      expenseAccountId: 'acc-1',
      quantity: '1',
      unitPriceNet: '1000',
      taxRate: '15',
      taxAmount: '149.99',
    }).totalGrossAmount).toBe('1149.99')
  })

  it('sums the invoice totals from its lines', () => {
    const totals = computeApInvoiceTotals([
      { description: 'A', expenseAccountId: 'acc-1', quantity: '1', unitPriceNet: '100', taxRate: '15' },
      { description: 'B', expenseAccountId: 'acc-1', quantity: '3', unitPriceNet: '50', taxRate: '15' },
    ])
    expect(totals.subtotalNetAmount).toBe('250.00')
    expect(totals.taxTotalAmount).toBe('37.50')
    expect(totals.grandTotalGrossAmount).toBe('287.50')
  })
})

describe('withholding', () => {
  it('withholds the published rate and returns the net payable', () => {
    expect(computeWithholding('1000.00', 0.05)).toEqual({ withholding: '50.00', net: '950.00' })
    expect(computeWithholding('1150.00', 0.15)).toEqual({ withholding: '172.50', net: '977.50' })
  })

  it('withholds nothing at a zero rate', () => {
    expect(computeWithholding('100.00', 0)).toEqual({ withholding: '0.00', net: '100.00' })
  })
})

describe('AP aging', () => {
  const invoice = (overrides: Partial<ApAgingInvoice> = {}): ApAgingInvoice => ({
    id: 'inv-1',
    internalNumber: 'AP-1',
    vendorId: 'vendor-1',
    vendorName: 'Vendor',
    issueDate: '2026-09-01',
    dueDate: '2026-10-19',
    currencyCode: 'SAR',
    grossAmount: '1150.00',
    paidAmount: '0.00',
    outstandingAmount: '1150.00',
    bucket: 'current',
    ...overrides,
  })

  it('sums each bucket and reports the reconciliation delta', () => {
    const result = buildApAging([
      invoice({ id: 'a', outstandingAmount: '100.00' }),
      invoice({ id: 'b', outstandingAmount: '200.00', bucket: 'days31to60' }),
    ], '280.00', '2026-10-19')
    expect(result.buckets.current).toEqual({ count: 1, amount: '100.00' })
    expect(result.buckets.days31to60).toEqual({ count: 1, amount: '200.00' })
    expect(result.totalOutstanding).toBe('300.00')
    expect(result.reconciliationDelta).toBe('-20.00')
  })

  it('reports a zero delta when the ledger agrees', () => {
    expect(buildApAging([invoice()], '1150.00', '2026-10-19').reconciliationDelta).toBe('0.00')
  })
})
