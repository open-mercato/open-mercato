import {
  incrementToolCallCount,
  buildMemoryContext,
  buildSearchLabel,
  storeSearchResult,
} from '../session-memory'

describe('session-memory', () => {

  describe('tool call counting', () => {
    it('increments count per session', () => {
      const countToken = `count_${Date.now()}`
      const r1 = incrementToolCallCount(countToken)
      expect(r1.count).toBe(1)
      expect(r1.exceeded).toBe(false)

      const r2 = incrementToolCallCount(countToken)
      expect(r2.count).toBe(2)
      expect(r2.exceeded).toBe(false)
    })

    it('enforces hard cap at 10 calls', () => {
      const capToken = `cap_${Date.now()}`
      for (let i = 0; i < 10; i++) {
        const r = incrementToolCallCount(capToken)
        expect(r.exceeded).toBe(false)
      }
      const r11 = incrementToolCallCount(capToken)
      expect(r11.count).toBe(11)
      expect(r11.exceeded).toBe(true)
    })
  })

  describe('buildMemoryContext', () => {
    it('returns empty for unknown session', () => {
      expect(buildMemoryContext('nonexistent_session_ctx')).toBe('')
    })

    it('returns empty for session with no searches', () => {
      const ctxToken = `ctx_empty_${Date.now()}`
      incrementToolCallCount(ctxToken) // creates session
      expect(buildMemoryContext(ctxToken)).toBe('')
    })

    it('includes search count and labels', () => {
      const ctxToken = `ctx_labels_${Date.now()}`
      storeSearchResult(ctxToken, 'code1', 'r1', 'companies lookup')
      storeSearchResult(ctxToken, 'code2', 'r2', 'orders lookup')
      const ctx = buildMemoryContext(ctxToken)
      expect(ctx).toContain('2 schema searches cached')
      expect(ctx).toContain('companies lookup')
      expect(ctx).toContain('orders lookup')
    })
  })

  describe('buildSearchLabel', () => {
    it('extracts findEndpoints helper call', () => {
      expect(buildSearchLabel('async () => spec.findEndpoints("customer")')).toBe(
        'findEndpoints("customer")'
      )
    })

    it('extracts describeEndpoint helper call', () => {
      expect(
        buildSearchLabel(
          'async () => spec.describeEndpoint("/api/sales/orders", "post")'
        )
      ).toBe('describeEndpoint("/api/sales/orders", "post")')
    })

    it('extracts describeEntity helper call', () => {
      expect(buildSearchLabel('async () => spec.describeEntity("company")')).toBe(
        'describeEntity("company")'
      )
    })

    it('falls back to code prefix for non-helper calls', () => {
      const label = buildSearchLabel('async () => Object.keys(spec.paths)')
      expect(label).toBe('Object.keys(spec.paths)')
    })
  })
})
