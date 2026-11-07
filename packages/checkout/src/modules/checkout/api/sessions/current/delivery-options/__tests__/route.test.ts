/** @jest-environment node */
// Step 2.13 — route-level coverage for `GET /sessions/current/delivery-options`: the
// binding/scope resolution, the 30/min-per-session rate limit wiring (§13), and the HTTP
// mapping of `computeDeliveryOptions`'s own 422. Business logic (origin/packages/carrier/
// fallback) is covered by `lib/__tests__/deliveryRateQuote.test.ts`.

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
jest.mock('../../../../../lib/cartLinesPeer', () => ({ lookupCartLinePeers: jest.fn(async () => []) }))
jest.mock('../../../../../lib/deliveryRateCache', () => ({ getOrComputeDeliveryOptions: jest.fn() }))

import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { checkRateLimit, getClientIp } from '@open-mercato/shared/lib/ratelimit/helpers'
import { readCheckoutSessionToken, resolveCurrentSession } from '../../../../../lib/currentSessionRoute'
import { getOrComputeDeliveryOptions } from '../../../../../lib/deliveryRateCache'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { GET } from '../route'

function makeRequest(headers: Record<string, string> = {}) {
  return new Request('https://merchant.example/api/checkout/sessions/current/delivery-options', { headers })
}

describe('GET /api/checkout/sessions/current/delivery-options', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(checkRateLimit as jest.Mock).mockResolvedValue(null)
    ;(getClientIp as jest.Mock).mockReturnValue('127.0.0.1')
    ;(createRequestContainer as jest.Mock).mockResolvedValue({
      resolve: (name: string) => {
        if (name === 'rateLimiterService') return { trustProxyDepth: 0 }
        if (name === 'em') return {}
        throw new Error(`Unknown dependency: ${name}`)
      },
    })
    ;(readCheckoutSessionToken as jest.Mock).mockReturnValue('plaintext-token')
    ;(resolveCurrentSession as jest.Mock).mockResolvedValue({
      ok: true,
      session: {
        id: 'session-1',
        tenantId: 't',
        organizationId: 'o',
        cartId: 'cart-1',
        storeId: 'store-1',
        linkId: null,
        channel: 'storefront',
        currencyCode: 'USD',
        shippingAddress: { countryCode: 'US', postalCode: '10001', city: 'New York', line1: '5th Ave' },
      },
      scope: { tenantId: 't', organizationId: 'o' },
    })
    ;(getOrComputeDeliveryOptions as jest.Mock).mockResolvedValue([])
  })

  it('answers 404 when no X-Checkout-Session-Token header is supplied', async () => {
    ;(readCheckoutSessionToken as jest.Mock).mockReturnValue(null)

    const response = await GET(makeRequest())

    expect(response.status).toBe(404)
  })

  it('enforces the 30/min-per-session fail-closed limit (§13)', async () => {
    await GET(makeRequest({ 'X-Checkout-Session-Token': 'token-1' }))

    expect(checkRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ failClosed: true }),
    )
  })

  it('returns the 429 the limiter produces and never resolves the session', async () => {
    ;(checkRateLimit as jest.Mock).mockResolvedValue(new Response(JSON.stringify({ error: 'Too many' }), { status: 429 }))

    const response = await GET(makeRequest({ 'X-Checkout-Session-Token': 'token-1' }))

    expect(response.status).toBe(429)
    expect(resolveCurrentSession).not.toHaveBeenCalled()
  })

  it('returns the binding/scope-mismatch 404 from resolveCurrentSession unchanged', async () => {
    ;(resolveCurrentSession as jest.Mock).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: 'not found' }), { status: 404 }),
    })

    const response = await GET(makeRequest({ 'X-Checkout-Session-Token': 'token-1' }))

    expect(response.status).toBe(404)
  })

  it('answers 422 delivery_unavailable when the session has no shipping address', async () => {
    ;(resolveCurrentSession as jest.Mock).mockResolvedValue({
      ok: true,
      session: { id: 's', tenantId: 't', organizationId: 'o', cartId: 'c', storeId: null, linkId: null, channel: 'storefront', currencyCode: 'USD', shippingAddress: null },
      scope: { tenantId: 't', organizationId: 'o' },
    })

    const response = await GET(makeRequest({ 'X-Checkout-Session-Token': 'token-1' }))

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ code: 'delivery_unavailable' })
  })

  it('maps computeDeliveryOptions\'s 422 delivery_unavailable straight through, never a 500', async () => {
    ;(getOrComputeDeliveryOptions as jest.Mock).mockRejectedValue(
      new CrudHttpError(422, { error: 'no delivery rate', code: 'delivery_unavailable' }),
    )

    const response = await GET(makeRequest({ 'X-Checkout-Session-Token': 'token-1' }))

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ code: 'delivery_unavailable' })
  })

  it('returns the computed options on success', async () => {
    ;(getOrComputeDeliveryOptions as jest.Mock).mockResolvedValue([
      { deliveryMethodCode: 'acme:express', providerKey: 'acme', serviceCode: 'express', label: 'Express', cost: '12.50', currencyCode: 'USD', estimatedDays: 2, source: 'carrier' },
    ])

    const response = await GET(makeRequest({ 'X-Checkout-Session-Token': 'token-1' }))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.options).toHaveLength(1)
    expect(body.options[0].deliveryMethodCode).toBe('acme:express')
  })
})
