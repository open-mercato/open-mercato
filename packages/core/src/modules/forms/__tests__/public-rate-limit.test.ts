/** @jest-environment node */

jest.mock('@open-mercato/core/bootstrap', () => ({
  getCachedRateLimiterService: jest.fn(),
}))

import { getCachedRateLimiterService } from '@open-mercato/core/bootstrap'
import {
  buildPublicRateLimitKey,
  enforcePublicRateLimit,
  getPublicClientIp,
} from '../api/public/rate-limit'

function limiter(options: {
  trustProxyDepth?: number
  consume?: jest.Mock
}) {
  return {
    trustProxyDepth: options.trustProxyDepth ?? 0,
    consume: options.consume ?? jest.fn(async () => ({
      allowed: true,
      remainingPoints: 29,
      msBeforeNext: 0,
      consumedPoints: 1,
    })),
  }
}

describe('forms public rate limiting', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('ignores spoofed forwarding headers in direct mode and keys by the resource digest', async () => {
    const service = limiter({ trustProxyDepth: 0 })
    ;(getCachedRateLimiterService as jest.Mock).mockReturnValue(service)
    const request = new Request('http://test/api/forms/public/start', {
      headers: { 'x-forwarded-for': '198.51.100.44' },
    })
    const resourceKey = buildPublicRateLimitKey('start', 'public-slug')

    await expect(enforcePublicRateLimit(request, resourceKey)).resolves.toBeNull()

    expect(service.consume).toHaveBeenCalledWith(
      `${resourceKey}:resource`,
      expect.objectContaining({ keyPrefix: 'forms-public', points: 30 }),
    )
    expect(getPublicClientIp(request)).toBeUndefined()
  })

  it('uses only the trusted proxy-depth address when configured', async () => {
    const service = limiter({ trustProxyDepth: 2 })
    ;(getCachedRateLimiterService as jest.Mock).mockReturnValue(service)
    const request = new Request('http://test/api/forms/public/start', {
      headers: { 'x-forwarded-for': 'spoofed, 203.0.113.8, 192.0.2.10' },
    })
    const resourceKey = buildPublicRateLimitKey('start', 'public-slug')

    await enforcePublicRateLimit(request, resourceKey)

    expect(service.consume).toHaveBeenCalledWith(
      `${resourceKey}:client:203.0.113.8`,
      expect.any(Object),
    )
    expect(getPublicClientIp(request)).toBe('203.0.113.8')
  })

  it('hashes resource identifiers so capability tokens are not stored in limiter keys', () => {
    const token = 'secret-invitation-token'
    const first = buildPublicRateLimitKey('invitation-read', token)
    expect(first).toBe(buildPublicRateLimitKey('invitation-read', token))
    expect(first).not.toContain(token)
    expect(first).not.toBe(buildPublicRateLimitKey('invitation-read', 'other-token'))
  })

  it.each([
    ['missing', null],
    ['degraded', limiter({ consume: jest.fn(async () => ({
      allowed: true,
      remainingPoints: 30,
      msBeforeNext: 0,
      consumedPoints: 0,
      degraded: true,
    })) })],
    ['throwing', limiter({ consume: jest.fn(async () => { throw new Error('[internal] limiter unavailable') }) })],
  ])('fails closed when the limiter is %s', async (_label, service) => {
    ;(getCachedRateLimiterService as jest.Mock).mockReturnValue(service)
    const response = await enforcePublicRateLimit(
      new Request('http://test/api/forms/public/start'),
      buildPublicRateLimitKey('start', 'public-slug'),
    )
    expect(response?.status).toBe(503)
    await expect(response?.json()).resolves.toMatchObject({ error: 'RATE_LIMIT_UNAVAILABLE' })
  })

  it('returns 429 with Retry-After when the durable limiter denies the request', async () => {
    const service = limiter({
      consume: jest.fn(async () => ({
        allowed: false,
        remainingPoints: 0,
        msBeforeNext: 1_500,
        consumedPoints: 31,
      })),
    })
    ;(getCachedRateLimiterService as jest.Mock).mockReturnValue(service)

    const response = await enforcePublicRateLimit(
      new Request('http://test/api/forms/public/start'),
      buildPublicRateLimitKey('start', 'public-slug'),
    )

    expect(response?.status).toBe(429)
    expect(response?.headers.get('retry-after')).toBe('2')
  })
})
