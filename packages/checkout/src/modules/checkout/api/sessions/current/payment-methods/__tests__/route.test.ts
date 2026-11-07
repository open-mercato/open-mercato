/** @jest-environment node */
// Step 2.13 — route-level coverage for `GET /sessions/current/payment-methods`:
// binding, the "other GET" fail-open rate limit (§13), link-vs-non-link restriction
// wiring. Listing logic itself is covered by `lib/__tests__/paymentMethods.test.ts`.

jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('@open-mercato/shared/lib/ratelimit/helpers', () => ({
  checkRateLimit: jest.fn(),
  getClientIp: jest.fn(),
  RATE_LIMIT_FALLBACK_KEY: 'global',
  RATE_LIMIT_UNAVAILABLE_FALLBACK: 'Service temporarily unavailable. Please try again later.',
}))
jest.mock('../../../../../lib/currentSessionRoute', () => ({
  readCheckoutSessionToken: jest.fn(),
  resolveCurrentSession: jest.fn(),
}))
jest.mock('../../../../../lib/paymentMethods', () => ({ listCheckoutPaymentMethods: jest.fn() }))

import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { checkRateLimit, getClientIp } from '@open-mercato/shared/lib/ratelimit/helpers'
import { readCheckoutSessionToken, resolveCurrentSession } from '../../../../../lib/currentSessionRoute'
import { listCheckoutPaymentMethods } from '../../../../../lib/paymentMethods'
import { GET } from '../route'

function makeRequest(headers: Record<string, string> = {}) {
  return new Request('https://merchant.example/api/checkout/sessions/current/payment-methods', { headers })
}

describe('GET /api/checkout/sessions/current/payment-methods', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(checkRateLimit as jest.Mock).mockResolvedValue(null)
    ;(getClientIp as jest.Mock).mockReturnValue('127.0.0.1')
    ;(createRequestContainer as jest.Mock).mockResolvedValue({
      resolve: (name: string) => {
        if (name === 'rateLimiterService') return { trustProxyDepth: 0 }
        if (name === 'em') return { findOne: jest.fn(async () => null) }
        throw new Error(`Unknown dependency: ${name}`)
      },
    })
    ;(readCheckoutSessionToken as jest.Mock).mockReturnValue('plaintext-token')
    ;(resolveCurrentSession as jest.Mock).mockResolvedValue({
      ok: true,
      session: { id: 's', tenantId: 't', organizationId: 'o', linkId: null, currencyCode: 'USD' },
      scope: { tenantId: 't', organizationId: 'o' },
    })
    ;(listCheckoutPaymentMethods as jest.Mock).mockResolvedValue([])
  })

  it('answers 404 when no X-Checkout-Session-Token header is supplied', async () => {
    ;(readCheckoutSessionToken as jest.Mock).mockReturnValue(null)

    const response = await GET(makeRequest())

    expect(response.status).toBe(404)
  })

  it('enforces the "other GET" rate limit fail-open (§13)', async () => {
    ;(checkRateLimit as jest.Mock).mockRejectedValue(new Error('backing store unreachable'))

    const response = await GET(makeRequest({ 'X-Checkout-Session-Token': 'token-1' }))

    // fail-open: a limiter failure never blocks this read.
    expect(response.status).toBe(200)
  })

  it('returns the listed methods on success', async () => {
    ;(listCheckoutPaymentMethods as jest.Mock).mockResolvedValue([{ providerKey: 'stripe', label: 'Stripe', kind: 'gateway' }])

    const response = await GET(makeRequest({ 'X-Checkout-Session-Token': 'token-1' }))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.methods).toEqual([{ providerKey: 'stripe', label: 'Stripe', kind: 'gateway' }])
  })
})
