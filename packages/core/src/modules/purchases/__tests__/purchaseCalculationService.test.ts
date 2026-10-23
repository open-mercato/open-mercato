import { PurchaseCalculationService } from '../services/purchaseCalculationService'

describe('PurchaseCalculationService', () => {
  const service = new PurchaseCalculationService()

  it('calculates single line subtotal, tax, and gross with 23% VAT correctly', () => {
    const result = service.calculateLine({
      quantityOrdered: 10,
      unitPriceNet: 50,
      taxRatePercent: 23,
    })

    expect(result.subtotalNet).toBe('500.0000')
    expect(result.totalTax).toBe('115.0000')
    expect(result.totalGross).toBe('615.0000')
  })

  it('handles fractional quantities and zero tax rates', () => {
    const result = service.calculateLine({
      quantityOrdered: 2.5,
      unitPriceNet: 12.4,
      taxRatePercent: 0,
    })

    expect(result.subtotalNet).toBe('31.0000')
    expect(result.totalTax).toBe('0.0000')
    expect(result.totalGross).toBe('31.0000')
  })

  it('accurately sums totals across multiple lines', () => {
    const totals = service.calculateTotals([
      { quantityOrdered: 5, unitPriceNet: 100, taxRatePercent: 23 }, // 500 net, 115 tax, 615 gross
      { quantityOrdered: 2, unitPriceNet: 250, taxRatePercent: 8 },  // 500 net, 40 tax, 540 gross
    ])

    expect(totals.subtotalNet).toBe('1000.0000')
    expect(totals.totalTax).toBe('155.0000')
    expect(totals.totalGross).toBe('1155.0000')
    expect(totals.lineCount).toBe(2)
  })
})
