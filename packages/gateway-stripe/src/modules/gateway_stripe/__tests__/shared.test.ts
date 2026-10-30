import { describe, expect, it } from '@jest/globals'
import { fromCents, fromCentsExact, toCents } from '../lib/shared'

describe('gateway_stripe amount helpers', () => {
  it('uses minor units for two-decimal currencies', () => {
    expect(toCents(10.25, 'USD')).toBe(1025)
    expect(fromCents(1025, 'USD')).toBe(10.25)
  })

  it('preserves zero-decimal currencies', () => {
    expect(toCents(1000, 'JPY')).toBe(1000)
    expect(fromCents(1000, 'JPY')).toBe(1000)
  })

  it('converts exact decimal strings without float drift', () => {
    expect(toCents('10.25', 'USD')).toBe(1025)
    expect(toCents('0.29', 'USD')).toBe(29)
    expect(toCents('12345678901.23', 'usd')).toBe(1234567890123)
  })

  it('rounds sub-minor amounts half-up at the boundary', () => {
    expect(toCents('10.004', 'USD')).toBe(1000)
    expect(toCents('10.005', 'USD')).toBe(1001)
    expect(toCents(1.005, 'USD')).toBe(101)
  })

  it('rounds zero-decimal currency amounts to whole units', () => {
    expect(toCents('1000', 'JPY')).toBe(1000)
    expect(toCents('1000.4', 'JPY')).toBe(1000)
    expect(toCents('1000.5', 'jpy')).toBe(1001)
  })

  it('returns exact decimal strings from minor units', () => {
    expect(fromCentsExact(1025, 'USD')).toBe('10.25')
    expect(fromCentsExact(1, 'USD')).toBe('0.01')
    expect(fromCentsExact(1000, 'USD')).toBe('10')
    expect(fromCentsExact(1000, 'JPY')).toBe('1000')
  })
})
