import { buildMarketingRateLimitKey, enforceMarketingRateLimit, inboundRateLimitConfig, optOutRateLimitConfig, trackingRateLimitConfig } from '../rate-limit'
import type { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'

/**
 * The six unauthenticated routes had no limits at all.
 *
 * Each inbound POST runs a bounded decrypt scan to resolve an address, and every open and click writes a row
 * — so a signed URL out of one recipient's mailbox grew a table without bound, and a leaked hook URL spent the
 * scan on repeat.
 */
const req = new Request('https://shop.example/api/marketing_automation/track/open?t=abc', {
  headers: { 'x-forwarded-for': '203.0.113.7' },
})

function limiter(over: Partial<RateLimiterService> = {}): RateLimiterService {
  return { trustProxyDepth: 1, consume: async () => ({ allowed: true, remainingPoints: 1, msBeforeNext: 0 }), ...over } as unknown as RateLimiterService
}

describe('buildMarketingRateLimitKey', () => {
  it('keys on the address AND the credential', () => {
    // IP alone lets one token be hammered from a botnet and punishes everybody behind a corporate NAT for
    // one colleague's mail client. The credential alone lets anybody mint fresh garbage tokens for ever.
    const key = buildMarketingRateLimitKey(req, limiter(), 'ns', 'token-abc')
    expect(key.startsWith('ns:')).toBe(true)
    expect(key).toContain('203.0.113.7')
    expect(key.split(':')).toHaveLength(3)
  })

  it('fingerprints the credential rather than storing it', () => {
    // A tracking token is a signed blob that appears in logs and Redis keys. The limiter's storage is no
    // place for one.
    const key = buildMarketingRateLimitKey(req, limiter(), 'ns', 'token-abc')
    expect(key).not.toContain('token-abc')
    expect(key.split(':')[2]).toMatch(/^[0-9a-f]{16}$/)
  })

  it('gives the same token the same bucket, and different tokens different ones', () => {
    const first = buildMarketingRateLimitKey(req, limiter(), 'ns', 'token-abc')
    expect(buildMarketingRateLimitKey(req, limiter(), 'ns', 'token-abc')).toBe(first)
    expect(buildMarketingRateLimitKey(req, limiter(), 'ns', 'token-xyz')).not.toBe(first)
  })

  it('has a bucket for a request that presented nothing', () => {
    expect(buildMarketingRateLimitKey(req, limiter(), 'ns', null)).toContain(':anonymous')
  })
})

describe('enforceMarketingRateLimit', () => {
  const base = {
    req,
    config: trackingRateLimitConfig,
    namespace: 'ns',
    credential: 'token-abc',
    errorMessage: 'Too many requests',
  } as const

  it('answers 429 with Retry-After when the quota is spent', async () => {
    const container = { resolve: () => limiter({ consume: async () => ({ allowed: false, remainingPoints: 0, msBeforeNext: 30_000 }) }) }
    const response = await enforceMarketingRateLimit({ ...base, container, posture: 'fail-open' })
    expect(response?.status).toBe(429)
    expect(response?.headers.get('Retry-After')).toBe('30')
  })

  it('lets a degraded limiter through under fail-open, and refuses under fail-closed', async () => {
    const degraded = { resolve: () => limiter({ consume: async () => ({ allowed: true, remainingPoints: 0, msBeforeNext: 0, degraded: true }) }) }
    await expect(enforceMarketingRateLimit({ ...base, container: degraded, posture: 'fail-open' })).resolves.toBeNull()
    const refused = await enforceMarketingRateLimit({ ...base, container: degraded, posture: 'fail-closed' })
    expect(refused?.status).toBe(503)
  })

  /**
   * A limiter that is not registered at all is a misconfigured environment, and that lasts until an operator
   * fixes it — reporting a public endpoint as temporarily unavailable for it would be a lie that never
   * resolves. Distinguished from a registered limiter that cannot decide, which is transient.
   */
  it('skips the check when no limiter is registered, whatever the posture', async () => {
    const missing = { resolve: () => { throw new Error('nope') }, hasRegistration: () => false }
    await expect(enforceMarketingRateLimit({ ...base, container: missing, posture: 'fail-closed' })).resolves.toBeNull()
  })

  it('refuses under fail-closed when the check itself throws', async () => {
    const broken = { resolve: () => limiter({ consume: async () => { throw new Error('redis gone') } }) }
    const response = await enforceMarketingRateLimit({ ...base, container: broken, posture: 'fail-closed' })
    expect(response?.status).toBe(503)
    await expect(enforceMarketingRateLimit({ ...base, container: broken, posture: 'fail-open' })).resolves.toBeNull()
  })
})

describe('the three configs', () => {
  it('lets a recipient open a message many times, because they do', () => {
    // One person legitimately opens a message repeatedly, and image proxies refetch.
    expect(trackingRateLimitConfig.points).toBeGreaterThan(optOutRateLimitConfig.points)
  })

  it('is tightest where the work is most expensive', () => {
    // An inbound POST spends a decrypt scan; an unsubscribe writes one row.
    expect(inboundRateLimitConfig.points).toBeLessThan(trackingRateLimitConfig.points)
  })

  it('blocks for longer on the endpoints that change something', () => {
    expect(optOutRateLimitConfig.blockDuration).toBeGreaterThan(trackingRateLimitConfig.blockDuration ?? 0)
    expect(inboundRateLimitConfig.blockDuration).toBeGreaterThan(trackingRateLimitConfig.blockDuration ?? 0)
  })
})
