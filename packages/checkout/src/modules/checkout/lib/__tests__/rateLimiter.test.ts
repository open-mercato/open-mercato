import type { RateLimitResult } from '@open-mercato/shared/lib/ratelimit/types'
import type { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'
import {
  buildCheckoutRateLimitKey,
  checkoutPasswordRateLimitConfig,
  checkoutPublicViewRateLimitConfig,
  checkoutStatusRateLimitConfig,
  checkoutSubmitRateLimitConfig,
  enforceCheckoutRateLimit,
} from '../rateLimiter'

function makeRateLimiter(trustProxyDepth: number): RateLimiterService {
  return { trustProxyDepth } as RateLimiterService
}

describe('buildCheckoutRateLimitKey', () => {
  it('ignores spoofed forwarding headers in direct mode and uses the bounded fallback', () => {
    const req = new Request('http://localhost', {
      headers: {
        'x-forwarded-for': 'attacker-controlled',
        'x-real-ip': 'attacker-controlled',
      },
    })

    expect(buildCheckoutRateLimitKey(req, makeRateLimiter(0), 'checkout-submit'))
      .toBe('checkout-submit:global')
  })

  it('uses the trusted right edge with one proxy', () => {
    const req = new Request('http://localhost', {
      headers: { 'x-forwarded-for': 'spoofed, 203.0.113.10' },
    })

    expect(buildCheckoutRateLimitKey(req, makeRateLimiter(1), 'checkout-password'))
      .toBe('checkout-password:203.0.113.10')
  })

  it('uses the configured trusted depth with multiple proxies', () => {
    const req = new Request('http://localhost', {
      headers: { 'x-forwarded-for': 'spoofed, 203.0.113.10, 192.0.2.5' },
    })

    expect(buildCheckoutRateLimitKey(req, makeRateLimiter(2), 'checkout-status'))
      .toBe('checkout-status:203.0.113.10')
  })

  it('uses the bounded fallback when the forwarded chain is undersized', () => {
    const req = new Request('http://localhost', {
      headers: { 'x-forwarded-for': '203.0.113.10' },
    })

    expect(buildCheckoutRateLimitKey(req, makeRateLimiter(2), 'checkout-public-view'))
      .toBe('checkout-public-view:global')
  })
})

describe('enforceCheckoutRateLimit', () => {
  const allowedResult: RateLimitResult = {
    allowed: true,
    remainingPoints: 9,
    msBeforeNext: 0,
    consumedPoints: 1,
  }
  const degradedResult: RateLimitResult = { ...allowedResult, degraded: true }
  const rejectedResult: RateLimitResult = {
    allowed: false,
    remainingPoints: 0,
    msBeforeNext: 30_000,
    consumedPoints: 11,
  }

  function makeContainer(consume: jest.Mock | null, trustProxyDepth = 0) {
    return {
      hasRegistration: (name: string) => name !== 'rateLimiterService' || consume !== null,
      resolve: (name: string) => {
        if (name === 'rateLimiterService' && consume) return { trustProxyDepth, consume }
        throw new Error(`Unknown dependency: ${name}`)
      },
    }
  }

  type TestContainer = {
    resolve: (name: string) => unknown
    hasRegistration?: (name: string) => boolean
  }

  function enforce(container: TestContainer, posture: 'fail-open' | 'fail-closed') {
    return enforceCheckoutRateLimit({
      req: new Request('https://merchant.example/api/checkout/pay/donate/submit', { method: 'POST' }),
      container,
      config: checkoutSubmitRateLimitConfig,
      namespace: 'checkout-submit',
      errorMessage: 'Too many payment attempts. Please try again later.',
      posture,
    })
  }

  it.each([
    ['checkout-public-view', checkoutPublicViewRateLimitConfig, 'fail-open'],
    ['checkout-status', checkoutStatusRateLimitConfig, 'fail-open'],
    ['checkout-submit', checkoutSubmitRateLimitConfig, 'fail-closed'],
    ['checkout-password', checkoutPasswordRateLimitConfig, 'fail-closed'],
  ] as const)('isolates fallback resource decisions for %s', async (namespace, config, posture) => {
    const consume = jest.fn().mockResolvedValue(allowedResult)
    const resource = { tenantId: 'tenant-a', organizationId: 'org-a', id: 'link-a' }
    const check = (slug: string, forwarded: string, resolvedResource: typeof resource | null) => (
      enforceCheckoutRateLimit({
        req: new Request(`https://merchant.example/api/checkout/pay/${slug}`, {
          headers: { 'x-forwarded-for': forwarded },
        }),
        container: makeContainer(consume),
        config,
        namespace,
        errorMessage: 'Rate limited',
        posture,
        resolveResource: async () => resolvedResource,
      })
    )

    await check('link-a-slug', '203.0.113.10', resource)
    const resourceKey = consume.mock.calls[0][0]
    expect(resourceKey).toMatch(new RegExp(`^${namespace}:link:[a-f0-9]{64}$`))
    consume.mockImplementation(async (key) => key === resourceKey ? rejectedResult : allowedResult)

    const rejected = await check('link-a-slug', '203.0.113.11', resource)
    expect(rejected?.status).toBe(429)
    expect(rejected?.headers.get('Retry-After')).toBe('30')
    expect(await rejected?.json()).toEqual({ error: 'Rate limited' })
    expect(await check('link-b-slug', '203.0.113.10', { ...resource, tenantId: 'tenant-b', id: 'link-b' }))
      .toBeNull()
    await check('unresolved-slug-a', '203.0.113.10', null)
    await check('unresolved-slug-b', '203.0.113.11', null)

    expect(consume.mock.calls.slice(-2).map(([key]) => key)).toEqual([
      `${namespace}:global`,
      `${namespace}:global`,
    ])
  })

  it.each([
    [1, '203.0.113.10'],
    [2, '203.0.113.10, 192.0.2.5'],
  ])('uses the trusted IP without a resource lookup at proxy depth %i', async (depth, forwarded) => {
    const consume = jest.fn().mockResolvedValue(allowedResult)
    const resolveResource = jest.fn()
    await enforceCheckoutRateLimit({
      req: new Request('https://merchant.example', { headers: { 'x-forwarded-for': forwarded } }),
      container: makeContainer(consume, depth),
      config: checkoutSubmitRateLimitConfig,
      namespace: 'checkout-submit',
      errorMessage: 'Rate limited',
      posture: 'fail-closed',
      resolveResource,
    })
    expect(resolveResource).not.toHaveBeenCalled()
    expect(consume.mock.calls[0][0]).toBe('checkout-submit:203.0.113.10')
  })

  it.each([
    [undefined],
    ['203.0.113.10'],
  ])('uses the link bucket when a two-proxy chain is missing or incomplete (%j)', async (forwarded) => {
    const consume = jest.fn().mockResolvedValue(allowedResult)
    const resolveResource = jest.fn().mockResolvedValue({ tenantId: 'tenant-a', organizationId: 'org-a', id: 'link-a' })
    await enforceCheckoutRateLimit({
      req: new Request('https://merchant.example', { headers: forwarded ? { 'x-forwarded-for': forwarded } : undefined }),
      container: makeContainer(consume, 2),
      config: checkoutSubmitRateLimitConfig,
      namespace: 'checkout-submit',
      errorMessage: 'Rate limited',
      posture: 'fail-closed',
      resolveResource,
    })
    expect(resolveResource).toHaveBeenCalledTimes(1)
    expect(consume.mock.calls[0][0]).toMatch(/^checkout-submit:link:[a-f0-9]{64}$/)
  })

  it('rejects with 503 when the limiter reports a degraded decision and the endpoint fails closed', async () => {
    const consume = jest.fn().mockResolvedValue(degradedResult)

    const response = await enforce(makeContainer(consume), 'fail-closed')

    expect(response?.status).toBe(503)
    expect(await response?.json()).toEqual({
      error: 'Service temporarily unavailable. Please try again later.',
    })
  })

  it('rejects with 503 when the limiter throws and the endpoint fails closed', async () => {
    const consume = jest.fn().mockRejectedValue(new Error('backing store unreachable'))

    const response = await enforce(makeContainer(consume), 'fail-closed')

    expect(response?.status).toBe(503)
  })

  // The read-only endpoints deliberately keep the permissive posture: a limiter that
  // cannot decide must not take the public checkout page or its status polling down.
  it('serves the request when the limiter is degraded and the endpoint fails open', async () => {
    const consume = jest.fn().mockResolvedValue(degradedResult)

    expect(await enforce(makeContainer(consume), 'fail-open')).toBeNull()
  })

  it('serves the request when the limiter throws and the endpoint fails open', async () => {
    const consume = jest.fn().mockRejectedValue(new Error('backing store unreachable'))

    expect(await enforce(makeContainer(consume), 'fail-open')).toBeNull()
  })

  // A missing DI registration means the rate-limit configuration is invalid, which lasts
  // until an operator fixes it. Reporting that as "temporarily unavailable" would take
  // checkout down indefinitely, so the check is skipped for both postures instead.
  it('skips the check for both postures when no limiter is registered', async () => {
    expect(await enforce(makeContainer(null), 'fail-closed')).toBeNull()
    expect(await enforce(makeContainer(null), 'fail-open')).toBeNull()
  })

  it('skips the check when resolving the limiter throws', async () => {
    const container = {
      resolve: () => {
        throw new Error('AwilixResolutionError: could not resolve rateLimiterService')
      },
    }

    expect(await enforce(container, 'fail-closed')).toBeNull()
  })

  it('returns the limiter 429 when the quota is exhausted', async () => {
    const consume = jest.fn().mockResolvedValue(rejectedResult)

    const response = await enforce(makeContainer(consume), 'fail-closed')

    expect(response?.status).toBe(429)
    expect(await response?.json()).toEqual({
      error: 'Too many payment attempts. Please try again later.',
    })
  })

  it('allows the request when the limiter decides there is quota left', async () => {
    const consume = jest.fn().mockResolvedValue(allowedResult)

    expect(await enforce(makeContainer(consume), 'fail-closed')).toBeNull()
    expect(consume).toHaveBeenCalledWith('checkout-submit:global', checkoutSubmitRateLimitConfig)
  })
})
