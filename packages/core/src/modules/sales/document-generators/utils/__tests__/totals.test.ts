import { reconcileDocumentTotals, type ReconciledDocumentTotals } from '../totals'

function sumOfRows(totals: ReconciledDocumentTotals): number {
  return Math.round((totals.subtotal + totals.shipping + totals.surcharge + totals.adjustments + totals.tax) * 10_000) / 10_000
}

describe('reconcileDocumentTotals', () => {
  it('keeps shipping out of the subtotal so the rows add up to the total', () => {
    const totals = reconcileDocumentTotals({ lineTotals: [100], subtotalNet: 120, grandTotalGross: 147.6, shipping: 20 })
    expect(totals).toEqual({ subtotal: 100, shipping: 20, surcharge: 0, adjustments: 0, tax: 27.6, total: 147.6 })
    expect(sumOfRows(totals)).toBe(totals.total)
  })

  it('reports an order discount as a negative adjustment', () => {
    const totals = reconcileDocumentTotals({ lineTotals: [60, 40], subtotalNet: 110, grandTotalGross: 135.3, shipping: 20 })
    expect(totals).toMatchObject({ subtotal: 100, shipping: 20, adjustments: -10, tax: 25.3 })
    expect(sumOfRows(totals)).toBe(totals.total)
  })

  it.each([
    ['surcharge and discount', { lineTotals: [19.99, 0.01], subtotalNet: 24.5, grandTotalGross: 30.14, shipping: 4.99, surcharge: 1.5 }],
    ['a return credit', { lineTotals: [200], subtotalNet: 150, grandTotalGross: 184.5 }],
    ['an untaxed document', { lineTotals: [12.3456, 7.6544], subtotalNet: 20, grandTotalGross: 20 }],
    ['no lines', { lineTotals: [], subtotalNet: 0, grandTotalGross: 0 }],
  ])('always reconciles the rows with the total for %s', (_label, input) => {
    const totals = reconcileDocumentTotals(input)
    expect(sumOfRows(totals)).toBe(totals.total)
  })
})
