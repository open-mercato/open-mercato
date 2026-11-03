import { deliveryListSchema, deliveryListFields } from '../validators'

describe('deliveryListSchema date-range filters', () => {
  it('accepts an ISO date (YYYY-MM-DD)', () => {
    const parsed = deliveryListSchema.parse({ from: '2026-07-01', to: '2026-07-31' })
    expect(parsed.from).toBe('2026-07-01')
    expect(parsed.to).toBe('2026-07-31')
  })

  it('accepts an ISO datetime with offset', () => {
    const parsed = deliveryListSchema.parse({ from: '2026-07-01T00:00:00Z' })
    expect(parsed.from).toBe('2026-07-01T00:00:00Z')
  })

  it('rejects a malformed date so it never reaches the query engine', () => {
    expect(() => deliveryListSchema.parse({ from: 'not-a-date' })).toThrow()
    expect(() => deliveryListSchema.parse({ to: '2026-13-99' })).toThrow()
  })

  it('leaves from/to optional', () => {
    const parsed = deliveryListSchema.parse({})
    expect(parsed.from).toBeUndefined()
    expect(parsed.to).toBeUndefined()
  })
})

describe('deliveryListFields', () => {
  it('advertises next_retry_at so the list schema and projection do not drift', () => {
    expect(deliveryListFields).toContain('next_retry_at')
  })
})
