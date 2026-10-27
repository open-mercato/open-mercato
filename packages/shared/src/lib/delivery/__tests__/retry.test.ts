import { calculateBackoffDelayMs } from '../retry'

describe('calculateBackoffDelayMs', () => {
  const originalRandom = Math.random

  afterEach(() => {
    Math.random = originalRandom
  })

  it('grows exponentially by the default factor of 2 from a 1000ms base (jitter pinned to 0)', () => {
    Math.random = () => 0
    expect(calculateBackoffDelayMs(1)).toBe(1000)
    expect(calculateBackoffDelayMs(2)).toBe(2000)
    expect(calculateBackoffDelayMs(3)).toBe(4000)
    expect(calculateBackoffDelayMs(4)).toBe(8000)
  })

  it('adds jitter drawn from [0, maxJitterMs) on top of the exponential term', () => {
    // Math.floor(0.5 * 1000) = 500 added to the 2000ms exponential term for attempt 2.
    Math.random = () => 0.5
    expect(calculateBackoffDelayMs(2)).toBe(2500)
  })

  it('clamps non-positive attempt numbers so the exponent never goes negative', () => {
    Math.random = () => 0
    // attemptNumber 1, 0 and -5 all collapse to factor^0 = the base delay.
    expect(calculateBackoffDelayMs(0)).toBe(1000)
    expect(calculateBackoffDelayMs(-5)).toBe(1000)
  })

  it('is fully deterministic when maxJitterMs is 0 (no Math.random call)', () => {
    const randomSpy = jest.fn(() => 0.999)
    Math.random = randomSpy
    expect(calculateBackoffDelayMs(3, { maxJitterMs: 0 })).toBe(4000)
    expect(randomSpy).not.toHaveBeenCalled()
  })

  it('honours custom base delay and factor', () => {
    Math.random = () => 0
    expect(calculateBackoffDelayMs(1, { baseDelayMs: 250, factor: 3 })).toBe(250)
    expect(calculateBackoffDelayMs(2, { baseDelayMs: 250, factor: 3 })).toBe(750)
    expect(calculateBackoffDelayMs(3, { baseDelayMs: 250, factor: 3 })).toBe(2250)
  })

  it('keeps the jitter bound below maxJitterMs across the random range', () => {
    for (const sample of [0, 0.25, 0.5, 0.9999999]) {
      Math.random = () => sample
      const delay = calculateBackoffDelayMs(1, { maxJitterMs: 1000 })
      // Base (1000) + jitter in [0, 1000): never reaches base + maxJitterMs.
      expect(delay).toBeGreaterThanOrEqual(1000)
      expect(delay).toBeLessThan(2000)
    }
  })
})
