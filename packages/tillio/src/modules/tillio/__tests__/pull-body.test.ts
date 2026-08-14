import { pullBodySchema } from '../api/pull/route'

const validBody = { from: '2026-05-01', to: '2026-05-31' }

describe('pullBodySchema', () => {
  it('accepts a well-formed day range', () => {
    expect(pullBodySchema.safeParse(validBody).success).toBe(true)
  })

  it('rejects days that look right but are not on the calendar', () => {
    for (const day of ['2026-02-30', '2026-04-31', '2026-06-31', '2026-09-31', '2026-11-31']) {
      expect(pullBodySchema.safeParse({ ...validBody, from: day }).success).toBe(false)
      expect(pullBodySchema.safeParse({ ...validBody, to: day }).success).toBe(false)
    }
  })

  it('rejects out-of-range month and day numbers', () => {
    for (const day of ['2026-99-99', '2026-13-01', '2026-00-10', '2026-01-00', '2026-01-32']) {
      expect(pullBodySchema.safeParse({ ...validBody, from: day }).success).toBe(false)
    }
  })

  it('follows the leap year rule for February 29th', () => {
    expect(pullBodySchema.safeParse({ from: '2024-02-29', to: '2024-02-29' }).success).toBe(true)
    expect(pullBodySchema.safeParse({ from: '2025-02-29', to: '2025-02-29' }).success).toBe(false)
    expect(pullBodySchema.safeParse({ from: '2000-02-29', to: '2000-02-29' }).success).toBe(true)
    expect(pullBodySchema.safeParse({ from: '1900-02-29', to: '1900-02-29' }).success).toBe(false)
  })

  it('rejects shapes that are not a plain day', () => {
    for (const day of ['2026-5-1', '26-05-01', '2026-05-01T00:00:00Z', '2026-05-01 ', '']) {
      expect(pullBodySchema.safeParse({ ...validBody, from: day }).success).toBe(false)
    }
  })

  it('rejects a range that ends before it starts', () => {
    expect(pullBodySchema.safeParse({ from: '2026-05-31', to: '2026-05-01' }).success).toBe(false)
  })

  it('accepts a single-day range', () => {
    expect(pullBodySchema.safeParse({ from: '2026-05-01', to: '2026-05-01' }).success).toBe(true)
  })
})
