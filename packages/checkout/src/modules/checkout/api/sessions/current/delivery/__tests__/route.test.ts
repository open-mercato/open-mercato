/** @jest-environment node */
// Step 2.13 — route-level coverage for `POST /sessions/current/delivery`: binding,
// the existing mutation rate-limit pair (§13, reused from Step 2.12), body validation,
// and HTTP mapping of the command's own errors. Command orchestration itself is covered
// by `commands/__tests__/delivery.test.ts`.

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

const mockCommandExecute = jest.fn()

import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { checkRateLimit, getClientIp } from '@open-mercato/shared/lib/ratelimit/helpers'
import { readCheckoutSessionToken, resolveCurrentSession } from '../../../../../lib/currentSessionRoute'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { POST } from '../route'

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://merchant.example/api/checkout/sessions/current/delivery', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

describe('POST /api/checkout/sessions/current/delivery', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(checkRateLimit as jest.Mock).mockResolvedValue(null)
    ;(getClientIp as jest.Mock).mockReturnValue('127.0.0.1')
    ;(createRequestContainer as jest.Mock).mockResolvedValue({
      resolve: (name: string) => {
        if (name === 'rateLimiterService') return { trustProxyDepth: 0 }
        if (name === 'commandBus') return { execute: mockCommandExecute }
        if (name === 'em') return {}
        throw new Error(`Unknown dependency: ${name}`)
      },
    })
    ;(readCheckoutSessionToken as jest.Mock).mockReturnValue('plaintext-token')
    ;(resolveCurrentSession as jest.Mock).mockResolvedValue({
      ok: true,
      session: { id: 'session-1', tenantId: 't', organizationId: 'o' },
      scope: { tenantId: 't', organizationId: 'o' },
    })
    mockCommandExecute.mockResolvedValue({
      result: {
        session: { id: 'session-1', tenantId: 't', organizationId: 'o', status: 'open', step: 'delivery', channel: 'storefront', currencyCode: 'USD', locale: 'en-US', billingSameAsShipping: false, submitAttempt: 0, expiresAt: new Date(), createdAt: new Date(), updatedAt: new Date() },
        deliveryDiscount: null,
      },
    })
  })

  it('answers 404 when no X-Checkout-Session-Token header is supplied', async () => {
    ;(readCheckoutSessionToken as jest.Mock).mockReturnValue(null)

    const response = await POST(makeRequest({ deliveryMethodCode: 'acme:express' }))

    expect(response.status).toBe(404)
    expect(mockCommandExecute).not.toHaveBeenCalled()
  })

  it('enforces both the per-session and per-IP mutation limits (§13, reused from Step 2.12)', async () => {
    await POST(makeRequest({ deliveryMethodCode: 'acme:express' }, { 'X-Checkout-Session-Token': 'token-1' }))

    expect(checkRateLimit).toHaveBeenCalledTimes(2)
  })

  it('rejects a missing deliveryMethodCode with 400, never dispatching the command', async () => {
    const response = await POST(makeRequest({}, { 'X-Checkout-Session-Token': 'token-1' }))

    expect(response.status).toBe(400)
    expect(mockCommandExecute).not.toHaveBeenCalled()
  })

  it('maps the command\'s 422 delivery_unavailable straight through, never a 500', async () => {
    mockCommandExecute.mockRejectedValue(
      new CrudHttpError(422, { error: 'not available', code: 'delivery_unavailable' }),
    )

    const response = await POST(makeRequest({ deliveryMethodCode: 'acme:express' }, { 'X-Checkout-Session-Token': 'token-1' }))

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ code: 'delivery_unavailable' })
  })

  it('returns the serialized session and discount on success', async () => {
    const response = await POST(makeRequest({ deliveryMethodCode: 'acme:express' }, { 'X-Checkout-Session-Token': 'token-1' }))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.session.id).toBe('session-1')
    expect(body.deliveryDiscount).toBeNull()
  })
})
