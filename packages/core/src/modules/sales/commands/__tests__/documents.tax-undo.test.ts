import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const documents = readFileSync(join(__dirname, '..', 'documents.ts'), 'utf8')

const TAX_COLUMNS = [
  'taxStrategyKey',
  'taxInfo',
  'taxStatus',
  'taxCalculatedAt',
  'taxTransactionRef',
] as const

/**
 * Undo replays a stored graph snapshot; it never calls a provider. A tax column
 * captured into the snapshot but not restored from it — or the reverse — would
 * make an undo silently drop or invent provenance, which no later read could
 * detect. These assertions pin the symmetry.
 */
describe('tax columns through command snapshots and undo', () => {
  it('declares every tax column on both graph snapshot types', () => {
    for (const column of TAX_COLUMNS) {
      // Once on the quote snapshot type, once on the order snapshot type.
      const declarations = documents.match(
        new RegExp(`^    ${column}: (?:string|Record<string, unknown>) \\| null;$`, 'gm')
      ) ?? []
      expect(declarations.length).toBe(2)
    }
  })

  it('captures every tax column from the live quote and order', () => {
    expect(documents).toContain('taxStrategyKey: quote.taxStrategyKey ?? null,')
    expect(documents).toContain('taxStatus: quote.taxStatus ?? null,')
    expect(documents).toContain(
      'taxCalculatedAt: quote.taxCalculatedAt ? quote.taxCalculatedAt.toISOString() : null,'
    )
    expect(documents).toContain('taxTransactionRef: quote.taxTransactionRef ?? null,')

    expect(documents).toContain('taxStrategyKey: order.taxStrategyKey ?? null,')
    expect(documents).toContain('taxStatus: order.taxStatus ?? null,')
    expect(documents).toContain(
      'taxCalculatedAt: order.taxCalculatedAt ? order.taxCalculatedAt.toISOString() : null,'
    )
    expect(documents).toContain('taxTransactionRef: order.taxTransactionRef ?? null,')
  })

  it('restores every tax column onto the live quote and order', () => {
    expect(documents).toContain('quote.taxStrategyKey = snapshot.taxStrategyKey ?? null;')
    expect(documents).toContain('quote.taxStatus = snapshot.taxStatus ?? null;')
    expect(documents).toContain(
      'quote.taxCalculatedAt = snapshot.taxCalculatedAt ? new Date(snapshot.taxCalculatedAt) : null;'
    )
    expect(documents).toContain('quote.taxTransactionRef = snapshot.taxTransactionRef ?? null;')

    expect(documents).toContain('order.taxStatus = snapshot.taxStatus ?? null;')
    expect(documents).toContain(
      'order.taxCalculatedAt = snapshot.taxCalculatedAt ? new Date(snapshot.taxCalculatedAt) : null;'
    )
    expect(documents).toContain('order.taxTransactionRef = snapshot.taxTransactionRef ?? null;')
    // taxStrategyKey on the order predates this spec and was already restored.
    expect(documents).toContain('order.taxStrategyKey = snapshot.taxStrategyKey ?? null;')
  })

  it('carries the quote tax result onto the order on conversion', () => {
    // Before this spec the conversion reset taxStrategyKey to null, which would
    // now leave an order holding a tax_info the key no longer names. The only
    // remaining `taxStrategyKey: null` is the EMPTY_TAX_COLUMNS constant.
    const resets = documents.match(/^\s*taxStrategyKey: null,$/gm) ?? []
    expect(resets.length).toBe(1)
    expect(documents).toContain('const EMPTY_TAX_COLUMNS: InheritedTaxColumns = {\n  taxStrategyKey: null,')
    expect(documents).toContain('taxStrategyKey: snapshot.quote.taxStrategyKey ?? null,')
    expect(documents).toContain('taxStatus: snapshot.quote.taxStatus ?? null,')
    expect(documents).toContain('taxTransactionRef: snapshot.quote.taxTransactionRef ?? null,')
  })

  it('never recalculates from an undo handler, so no provider is called', () => {
    // Every recalculation goes through resolveDocumentCalculationContext, and
    // each one is paired with a calculateDocumentTotals in a forward path. If an
    // undo handler started recalculating, these counts would diverge.
    const contexts = documents.match(/await resolveDocumentCalculationContext\(\{/g) ?? []
    const totals = documents.match(/calculateDocumentTotals\(\{/g) ?? []
    expect(contexts.length).toBeGreaterThanOrEqual(12)
    // The two extras are the pair of adjustment commands that run a baseline
    // calculation against the context they already hold.
    expect(totals.length - contexts.length).toBe(2)
  })
})
