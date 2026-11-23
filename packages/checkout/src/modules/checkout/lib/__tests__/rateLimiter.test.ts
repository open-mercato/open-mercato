import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { RateLimitResult } from '@open-mercato/shared/lib/ratelimit/types'
import type { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'
import {
  buildCheckoutRateLimitKey,
  checkoutSubmitRateLimitConfig,
  enforceCheckoutRateLimit,
} from '../rateLimiter'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(),
}))

const POLISH_UNAVAILABLE = 'Usługa jest chwilowo niedostępna. Spróbuj ponownie później.'

function mockPolishTranslations() {
  jest.mocked(resolveTranslations).mockResolvedValue({
    translate: (key: string, fallback?: string) =>
      key === 'api.errors.rateLimitUnavailable' ? POLISH_UNAVAILABLE : (fallback ?? key),
  } as unknown as Awaited<ReturnType<typeof resolveTranslations>>)
}

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

  beforeEach(() => {
    jest.mocked(resolveTranslations).mockRejectedValue(new Error('outside a request scope'))
  })

  function makeContainer(consume: jest.Mock | null) {
    return {
      hasRegistration: (name: string) => name !== 'rateLimiterService' || consume !== null,
      resolve: (name: string) => {
        if (name === 'rateLimiterService' && consume) return { trustProxyDepth: 0, consume }
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

  it('rejects with 503 when no limiter is registered and the endpoint fails closed', async () => {
    const response = await enforce(makeContainer(null), 'fail-closed')

    expect(response?.status).toBe(503)
  })

  it('localizes the 503 for the request locale when no limiter is registered', async () => {
    mockPolishTranslations()

    const response = await enforce(makeContainer(null), 'fail-closed')

    expect(response?.status).toBe(503)
    expect(await response?.json()).toEqual({ error: POLISH_UNAVAILABLE })
  })

  it('localizes the 503 when the limiter is degraded or throws', async () => {
    mockPolishTranslations()

    const degraded = await enforce(makeContainer(jest.fn().mockResolvedValue(degradedResult)), 'fail-closed')
    const thrown = await enforce(makeContainer(jest.fn().mockRejectedValue(new Error('down'))), 'fail-closed')

    expect(await degraded?.json()).toEqual({ error: POLISH_UNAVAILABLE })
    expect(await thrown?.json()).toEqual({ error: POLISH_UNAVAILABLE })
  })

  it('falls back to the English 503 message when the translation lookup fails', async () => {
    const response = await enforce(makeContainer(null), 'fail-closed')

    expect(await response?.json()).toEqual({
      error: 'Service temporarily unavailable. Please try again later.',
    })
  })

  it('skips the check when no limiter is registered and the endpoint fails open', async () => {
    expect(await enforce(makeContainer(null), 'fail-open')).toBeNull()
  })

  it('rejects with 503 when resolving the limiter throws and the endpoint fails closed', async () => {
    const container = {
      resolve: () => {
        throw new Error('AwilixResolutionError: could not resolve rateLimiterService')
      },
    }

    expect((await enforce(container, 'fail-closed'))?.status).toBe(503)
    expect(await enforce(container, 'fail-open')).toBeNull()
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
