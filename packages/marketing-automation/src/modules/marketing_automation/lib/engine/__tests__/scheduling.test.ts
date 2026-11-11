import {
  CLAIM_LEASE_MINUTES,
  MAX_ATTEMPTS,
  computeClaimLeaseCutoff,
  computeNextRetryAt,
  computeRetryDelayMinutes,
  hasExhaustedAttempts,
  withRetryJitter,
} from '../scheduling'

describe('computeRetryDelayMinutes', () => {
  // Carried over verbatim from the Magento original so behaviour under failure is unchanged.
  test.each([
    [1, 5],
    [2, 10],
    [3, 20],
    [4, 40],
    [5, 80],
    [6, 120],
    [7, 120],
    [99, 120],
  ])('attempt %i backs off %i minutes', (attempts, expected) => {
    expect(computeRetryDelayMinutes(attempts)).toBe(expected)
  })

  test('treats a zero or negative attempt count as the first attempt', () => {
    expect(computeRetryDelayMinutes(0)).toBe(5)
    expect(computeRetryDelayMinutes(-3)).toBe(5)
  })
})

describe('computeNextRetryAt', () => {
  test('adds the backoff to the supplied clock', () => {
    const now = new Date('2026-09-28T12:00:00.000Z')
    expect(computeNextRetryAt(2, now).toISOString()).toBe('2026-09-28T12:10:00.000Z')
  })
})

describe('computeClaimLeaseCutoff', () => {
  test('is the lease window behind the supplied clock', () => {
    const now = new Date('2026-09-28T12:00:00.000Z')
    const cutoff = computeClaimLeaseCutoff(now)
    expect(now.getTime() - cutoff.getTime()).toBe(CLAIM_LEASE_MINUTES * 60_000)
  })
})

describe('withRetryJitter', () => {
  // Bounded: enough to spread a provider-outage retry storm, not enough to be a schedule change.
  test('adds no more than half a minute, and never subtracts', () => {
    for (let i = 0; i < 50; i += 1) {
      const jittered = withRetryJitter(5 * 60_000)
      expect(jittered).toBeGreaterThanOrEqual(5 * 60_000)
      expect(jittered).toBeLessThan(5 * 60_000 + 30_000)
    }
  })

  test('two calls for the same nominal delay are not required to agree', () => {
    // The whole point: synchronized retries after a shared outage must not re-fire in lockstep.
    const samples = new Set(Array.from({ length: 20 }, () => withRetryJitter(80 * 60_000)))
    expect(samples.size).toBeGreaterThan(1)
  })
})

describe('hasExhaustedAttempts', () => {
  test('is false below the cap and true at or above it', () => {
    expect(hasExhaustedAttempts(MAX_ATTEMPTS - 1)).toBe(false)
    expect(hasExhaustedAttempts(MAX_ATTEMPTS)).toBe(true)
    expect(hasExhaustedAttempts(MAX_ATTEMPTS + 1)).toBe(true)
  })
})
