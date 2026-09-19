import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const documents = readFileSync(join(__dirname, '..', 'documents.ts'), 'utf8')
const returns = readFileSync(join(__dirname, '..', 'returns.ts'), 'utf8')

/**
 * Amounts and provenance must be written together. A totals write that forgets
 * the tax columns would leave a document holding the amounts of one calculation
 * and the provenance of another, which no later read could detect.
 */
describe('tax column persistence', () => {
  it('writes the tax columns beside every quote and order totals write', () => {
    const quoteWrites = documents.match(/applyQuoteTotals\(quote, calculation\.totals/g) ?? []
    const orderWrites = documents.match(/applyOrderTotals\(order, calculation\.totals/g) ?? []
    const taxWrites = documents.match(/applyTaxColumns\((?:quote|order), calculation\);/g) ?? []
    expect(quoteWrites.length + orderWrites.length).toBeGreaterThanOrEqual(12)
    expect(taxWrites.length).toBe(quoteWrites.length + orderWrites.length)
  })

  it('writes the tax columns on every persisting return recalculation', () => {
    // The fourth call site, recalculateOrderTotalsForDisplay, returns totals
    // without persisting anything, so it correctly writes no column.
    const orderWrites = returns.match(/applyOrderTotals\(order, calculation\.totals/g) ?? []
    const taxWrites = returns.match(/applyTaxColumns\(order, calculation\)/g) ?? []
    expect(orderWrites.length).toBe(3)
    expect(taxWrites.length).toBe(3)
  })

  it('leaves the columns untouched for a calculation that ran no tax stage', () => {
    // Both helpers return early on a missing tax block rather than clearing the
    // columns: wiping a previous provider's result would be a silent data loss.
    expect(documents).toContain('const info = (calculation.metadata ?? {}).tax as TaxInfo | undefined;\n  if (!info) return;')
    expect(returns).toContain("const info = (calculation.metadata ?? {}).tax as TaxInfo | undefined\n  if (!info) return")
  })

  it('stores all five columns', () => {
    for (const column of [
      'taxStrategyKey',
      'taxInfo',
      'taxStatus',
      'taxCalculatedAt',
      'taxTransactionRef',
    ]) {
      expect(documents).toContain(`document.${column} =`)
      expect(returns).toContain(`order.${column} =`)
    }
  })
})
