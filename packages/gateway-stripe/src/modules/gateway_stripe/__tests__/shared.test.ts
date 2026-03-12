import { describe, expect, it } from '@jest/globals'
import { fromCents, toCents } from '../lib/shared'

describe('gateway_stripe amount helpers', () => {
  it('uses minor units for two-decimal currencies', () => {
    expect(toCents(10.25, 'USD')).toBe(1025)
    expect(fromCents(1025, 'USD')).toBe(10.25)
  })

  it('preserves zero-decimal currencies', () => {
    expect(toCents(1000, 'JPY')).toBe(1000)
    expect(fromCents(1000, 'JPY')).toBe(1000)
  })
})
