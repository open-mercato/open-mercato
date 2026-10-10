/** @jest-environment node */
/**
 * Pins the no-drift invariant of the sales bridge.
 *
 * The sales calculation service recomputes `quantity × unitPriceNet` and derives
 * tax from the rate percent. The draft therefore emits `quantity: 1` with the
 * halala-rounded net as the unit price, which makes the recomputation degenerate
 * to exactly the freight-computed amounts. These tests assert the reconciliation
 * for every rate basis the contracts support, including the minimum-charge case.
 */
import { buildInvoiceDraft } from '../invoiceDraft'
import { toHalalas } from '../money'

describe('buildInvoiceDraft', () => {
  it('emits quantity 1 with the net as the unit price so the sales recomputation matches', () => {
    const draft = buildInvoiceDraft(
      [{ name: 'Trip A', description: '12.5 ton × SAR 100.80', netAmount: 1260, taxRatePercent: '15' }],
      '15',
    )
    const line = draft.lines[0]
    expect(line.quantity).toBe('1')
    expect(line.unitPriceNet).toBe('1260.00')
    expect(Number(line.quantity) * Number(line.unitPriceNet)).toBe(Number(line.totalNetAmount))
    expect(toHalalas(Number(line.totalGrossAmount))).toBe(toHalalas(Number(line.totalNetAmount)) + toHalalas(Number(line.taxAmount)))
  })

  it('reconciles quantity × unit for every basis, including a minimum charge', () => {
    const cases = [
      { label: 'per trip', net: 450 },
      { label: 'per ton', net: 12.5 * 100.8 },
      { label: 'per km', net: 320.4 * 2.35 },
      { label: 'round trip', net: 900 },
      { label: 'flat monthly with minimum applied', net: 1500 },
    ]
    const draft = buildInvoiceDraft(
      cases.map((entry) => ({ name: entry.label, netAmount: entry.net, taxRatePercent: '15' })),
      '15',
    )
    expect(draft.lines).toHaveLength(cases.length)
    for (const line of draft.lines) {
      expect(Number(line.quantity) * Number(line.unitPriceNet)).toBeCloseTo(Number(line.totalNetAmount), 10)
    }
  })

  it('totals are exact sums of the rounded lines', () => {
    const draft = buildInvoiceDraft(
      [
        { name: 'Trip A', netAmount: '1260.005', taxRatePercent: '15' },
        { name: 'Trip B', netAmount: '0.005', taxRatePercent: '15' },
      ],
      '15',
    )
    const lineNetHalalas = draft.lines.reduce((sum, line) => sum + toHalalas(Number(line.totalNetAmount)), 0)
    const lineTaxHalalas = draft.lines.reduce((sum, line) => sum + toHalalas(Number(line.taxAmount)), 0)
    const lineGrossHalalas = draft.lines.reduce((sum, line) => sum + toHalalas(Number(line.totalGrossAmount)), 0)
    expect(toHalalas(Number(draft.subtotalNetAmount))).toBe(lineNetHalalas)
    expect(toHalalas(Number(draft.taxTotalAmount))).toBe(lineTaxHalalas)
    expect(toHalalas(Number(draft.grandTotalGrossAmount))).toBe(lineGrossHalalas)
    expect(toHalalas(Number(draft.grandTotalNetAmount))).toBe(lineNetHalalas)
  })

  it('falls back to the document rate when a line carries no override', () => {
    const draft = buildInvoiceDraft([{ name: 'Trip', netAmount: 100, taxRatePercent: null }], '15')
    expect(draft.lines[0].taxRate).toBe('15.00')
    expect(draft.lines[0].taxAmount).toBe('15.00')
  })

  it('produces an empty draft for an empty line set', () => {
    const draft = buildInvoiceDraft([], '15')
    expect(draft.lines).toEqual([])
    expect(draft.subtotalNetAmount).toBe('0.00')
    expect(draft.grandTotalGrossAmount).toBe('0.00')
  })
})
