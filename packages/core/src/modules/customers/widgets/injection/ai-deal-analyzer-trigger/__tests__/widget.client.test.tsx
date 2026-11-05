/**
 * Regression tests for issue #2053. The DataTable host emits selection state
 * into the injection context under bare keys (`selectedRowIds` /
 * `selectedCount`); the AI Deal Analyzer widget must consume the same keys.
 * Each test asserts on the resolved `DealAnalyzerPageContext` so a future
 * renaming on either side (for example re-introducing `_selectedRowIds` on
 * the DataTable while the widget still reads bare keys) breaks the build.
 */
import { buildDealAnalyzerPageContext } from '../widget.client'

describe('buildDealAnalyzerPageContext (regression for #2053)', () => {
  it('joins selectedRowIds into a comma-separated recordId and reports the selection count', () => {
    const ctx = buildDealAnalyzerPageContext({
      selectedRowIds: ['deal-1', 'deal-2', 'deal-3'],
      selectedCount: 3,
      totalMatching: 10,
    })

    expect(ctx.view).toBe('customers.deals.list')
    expect(ctx.recordType).toBeNull()
    expect(ctx.recordId).toBe('deal-1,deal-2,deal-3')
    expect(ctx.extra.selectedCount).toBe(3)
    expect(ctx.extra.totalMatching).toBe(10)
  })

  it('returns null recordId and zero selection count when the host has no selection', () => {
    const ctx = buildDealAnalyzerPageContext({
      selectedRowIds: [],
      selectedCount: 0,
      totalMatching: 10,
    })

    expect(ctx.recordId).toBeNull()
    expect(ctx.extra.selectedCount).toBe(0)
    expect(ctx.extra.totalMatching).toBe(10)
  })

  it('returns null recordId and zero counts when the injection context is empty', () => {
    const ctx = buildDealAnalyzerPageContext({})

    expect(ctx.recordId).toBeNull()
    expect(ctx.extra.selectedCount).toBe(0)
    expect(ctx.extra.totalMatching).toBe(0)
  })

  it('returns null recordId and zero counts when no injection context is supplied at all', () => {
    const ctx = buildDealAnalyzerPageContext(undefined)

    expect(ctx.recordId).toBeNull()
    expect(ctx.extra.selectedCount).toBe(0)
    expect(ctx.extra.totalMatching).toBe(0)
  })

  it('prefers selectedRowIds.length over selectedCount when both are supplied', () => {
    const ctx = buildDealAnalyzerPageContext({
      selectedRowIds: ['deal-1', 'deal-2', 'deal-3'],
      selectedCount: 999,
      totalMatching: 10,
    })

    expect(ctx.extra.selectedCount).toBe(3)
    expect(ctx.recordId).toBe('deal-1,deal-2,deal-3')
  })

  it('falls back to selectedCount when selectedRowIds is missing', () => {
    const ctx = buildDealAnalyzerPageContext({
      selectedCount: 7,
      totalMatching: 12,
    })

    expect(ctx.recordId).toBeNull()
    expect(ctx.extra.selectedCount).toBe(7)
    expect(ctx.extra.totalMatching).toBe(12)
  })

  it('ignores `_selectedRowIds` / `_selectedCount` — the underscore-prefixed shape from before #2053', () => {
    const legacyContext = {
      _selectedRowIds: ['deal-1', 'deal-2'],
      _selectedCount: 2,
      totalMatching: 9,
    } as unknown as Parameters<typeof buildDealAnalyzerPageContext>[0]

    const ctx = buildDealAnalyzerPageContext(legacyContext)

    expect(ctx.recordId).toBeNull()
    expect(ctx.extra.selectedCount).toBe(0)
    expect(ctx.extra.totalMatching).toBe(9)
  })

  it('coerces a stringy selectedCount to a number when selectedRowIds is empty', () => {
    const ctx = buildDealAnalyzerPageContext({
      selectedRowIds: [],
      selectedCount: '4' as unknown as number,
      totalMatching: 20,
    })

    expect(ctx.extra.selectedCount).toBe(4)
  })

  it('falls back to `total` and then `rowCount` for totalMatching', () => {
    const ctxFromTotal = buildDealAnalyzerPageContext({
      total: 17,
    } as unknown as Parameters<typeof buildDealAnalyzerPageContext>[0])
    expect(ctxFromTotal.extra.totalMatching).toBe(17)

    const ctxFromRowCount = buildDealAnalyzerPageContext({
      rowCount: 5,
    } as unknown as Parameters<typeof buildDealAnalyzerPageContext>[0])
    expect(ctxFromRowCount.extra.totalMatching).toBe(5)
  })
})
