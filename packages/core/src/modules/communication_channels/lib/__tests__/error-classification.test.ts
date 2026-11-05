import { classifyOutboundError, computeBackoffMs, isReauthError } from '../error-classification'

describe('classifyOutboundError', () => {
  it('returns transient: false for unknown error inputs', () => {
    expect(classifyOutboundError(null).transient).toBe(false)
    expect(classifyOutboundError(undefined).transient).toBe(false)
    expect(classifyOutboundError('').transient).toBe(false)
  })

  it('returns the message field for string errors', () => {
    const out = classifyOutboundError('plain string error')
    expect(out.message).toBe('plain string error')
  })

  it('honors explicit `transient` hint on Error instances', () => {
    const err = new Error('boom') as Error & { transient?: boolean }
    err.transient = true
    expect(classifyOutboundError(err).transient).toBe(true)
    err.transient = false
    expect(classifyOutboundError(err).transient).toBe(false)
  })

  it('classifies 429 / 5xx / 408 statuses as transient', () => {
    for (const status of [408, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524]) {
      const err = new Error('http') as Error & { status?: number }
      err.status = status
      expect(classifyOutboundError(err).transient).toBe(true)
      expect(classifyOutboundError(err).status).toBe(status)
    }
  })

  it('classifies 4xx auth/validation statuses as permanent', () => {
    for (const status of [400, 401, 403, 404, 422]) {
      const err = new Error('http') as Error & { status?: number }
      err.status = status
      expect(classifyOutboundError(err).transient).toBe(false)
    }
  })

  it('detects transient network errors via message patterns', () => {
    for (const message of [
      'connect ECONNRESET',
      'connect ETIMEDOUT 1.2.3.4:443',
      'getaddrinfo EAI_AGAIN api.example.com',
      'socket hang up',
      'Service Unavailable',
      'Rate limit exceeded — try again later',
      'request timed out',
    ]) {
      expect(classifyOutboundError(new Error(message)).transient).toBe(true)
    }
  })

  it('treats plain-text errors with no network hints as permanent', () => {
    expect(classifyOutboundError(new Error('bad input')).transient).toBe(false)
    expect(classifyOutboundError(new Error('signature mismatch')).transient).toBe(false)
  })

  // A transient DB failure during inbound ingest MUST be transient so the poll
  // worker aborts without advancing the cursor (no silent mail loss).
  it('classifies transient Postgres errors by SQLSTATE code', () => {
    for (const code of ['40001', '40P01', '55P03', '53300', '08006', '57P03']) {
      const err = new Error('db error') as Error & { code?: string }
      err.code = code
      expect(classifyOutboundError(err).transient).toBe(true)
    }
  })

  it('classifies transient Postgres errors by message text (ORM-wrapped, no code)', () => {
    for (const message of [
      'deadlock detected',
      'could not serialize access due to concurrent update',
      'Connection terminated unexpectedly',
      'sorry, too many clients already',
      'the database system is starting up',
    ]) {
      expect(classifyOutboundError(new Error(message)).transient).toBe(true)
    }
  })

  it('still treats a non-transient SQLSTATE (e.g. 23505) as permanent', () => {
    const err = new Error('duplicate key') as Error & { code?: string }
    err.code = '23505'
    expect(classifyOutboundError(err).transient).toBe(false)
  })
})

describe('isReauthError', () => {
  it('flags a 401 status as a reauth error', () => {
    const err = Object.assign(new Error('nope'), { status: 401 })
    expect(isReauthError(classifyOutboundError(err))).toBe(true)
  })

  it('flags invalid_grant / unauthorized messages as reauth errors', () => {
    expect(isReauthError(classifyOutboundError(new Error('invalid_grant')))).toBe(true)
    expect(isReauthError(classifyOutboundError(new Error('401 Unauthorized')))).toBe(true)
  })

  it('flags the requires_reauth sentinel emitted by Gmail sendMessage on a 401', () => {
    // The provider adapters return `{ status: 'failed', error: 'requires_reauth' }`
    // on a 401; the outbound command rethrows it as a status-less Error.
    expect(isReauthError(classifyOutboundError(new Error('requires_reauth')))).toBe(true)
  })

  it('does NOT flag transient or generic permanent errors as reauth', () => {
    const rate = Object.assign(new Error('slow down'), { status: 429 })
    const forbidden = Object.assign(new Error('forbidden'), { status: 403 })
    expect(isReauthError(classifyOutboundError(rate))).toBe(false)
    expect(isReauthError(classifyOutboundError(forbidden))).toBe(false)
    expect(isReauthError(classifyOutboundError(new Error('bad input')))).toBe(false)
  })
})

describe('computeBackoffMs', () => {
  it('returns base 1000ms + jitter for attempt 1', () => {
    const delay = computeBackoffMs(1)
    expect(delay).toBeGreaterThanOrEqual(1000)
    expect(delay).toBeLessThan(1500)
  })

  it('doubles for each subsequent attempt (with jitter pinned)', () => {
    // Pin Math.random so the assertion is deterministic — base values are
    // 1000ms / 2000ms / 4000ms; jitter is `floor(random()*500)`. With random=0
    // jitter is exactly 0 and the deltas are the base differences.
    const originalRandom = Math.random
    Math.random = () => 0
    try {
      const a1 = computeBackoffMs(1)
      const a2 = computeBackoffMs(2)
      const a3 = computeBackoffMs(3)
      expect(a1).toBe(1000)
      expect(a2 - a1).toBe(1000) // 2000 - 1000
      expect(a3 - a2).toBe(2000) // 4000 - 2000
    } finally {
      Math.random = originalRandom
    }
  })

  it('keeps deltas roughly doubling even with jitter — safe lower bounds', () => {
    // Without pinning Math.random, deltas vary in a known window.
    // Jitter ∈ [0, 499], so:
    //   a2 - a1 ∈ [1000 - 499, 1000 + 499] = [501, 1499]
    //   a3 - a2 ∈ [2000 - 499, 2000 + 499] = [1501, 2499]
    const a1 = computeBackoffMs(1)
    const a2 = computeBackoffMs(2)
    const a3 = computeBackoffMs(3)
    expect(a2 - a1).toBeGreaterThanOrEqual(501)
    expect(a3 - a2).toBeGreaterThanOrEqual(1501)
  })

  it('caps at 60s + jitter', () => {
    const delay = computeBackoffMs(20)
    expect(delay).toBeGreaterThanOrEqual(60_000)
    expect(delay).toBeLessThan(60_500)
  })

  it('clamps attempt 0 and negative to attempt 1 baseline', () => {
    expect(computeBackoffMs(0)).toBeGreaterThanOrEqual(1000)
    expect(computeBackoffMs(-3)).toBeGreaterThanOrEqual(1000)
  })
})
