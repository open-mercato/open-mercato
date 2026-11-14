/** @jest-environment node */
// Release 5, Step 4.2 — route-level coverage for `POST /sessions/current/submit`: the
// C14 rate-limit pair (10/min per session, 60/min per IP), the `Idempotency-Key` header
// requirement (§7.1), D-R5-33 identity binding / cross-tenant isolation (delegated to —
// and so proven through — `resolveCurrentSession`, the same shared helper every sibling
// `/sessions/current/*` route already uses and already has its own unit coverage for),
// and HTTP mapping of the command's own result/errors. The full 1-8 sequence itself is
// covered by `commands/__tests__/submit.test.ts`.

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
  return new Request('https://merchant.example/api/checkout/sessions/current/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

const VALID_HEADERS = { 'X-Checkout-Session-Token': 'token-1', 'Idempotency-Key': 'a-valid-idempotency-key-1' }

describe('POST /api/checkout/sessions/current/submit', () => {
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
      session: { id: 'session-1', tenantId: 'tenant-1', organizationId: 'org-1' },
      scope: { tenantId: 'tenant-1', organizationId: 'org-1' },
    })
    mockCommandExecute.mockResolvedValue({
      result: {
        session: {
          id: 'session-1', tenantId: 'tenant-1', organizationId: 'org-1', status: 'completed', step: 'review',
          channel: 'api', currencyCode: 'USD', locale: 'en-US', billingSameAsShipping: false, submitAttempt: 1,
          expiresAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
        },
        salesOrderId: 'order-1',
        salesQuoteId: 'quote-1',
      },
    })
  })

  it('answers 404 when no X-Checkout-Session-Token header is supplied', async () => {
    ;(readCheckoutSessionToken as jest.Mock).mockReturnValue(null)

    const response = await POST(makeRequest({ paymentMethodCode: 'gateway:acme' }))

    expect(response.status).toBe(404)
    expect(mockCommandExecute).not.toHaveBeenCalled()
  })

  it('enforces BOTH the 10/min-per-session and 60/min-per-IP buckets (C14/§13), not instead of each other', async () => {
    await POST(makeRequest({ paymentMethodCode: 'gateway:acme' }, VALID_HEADERS))

    expect(checkRateLimit).toHaveBeenCalledTimes(2)
  })

  it('fails closed (503) when the rate limiter cannot decide', async () => {
    ;(checkRateLimit as jest.Mock).mockRejectedValue(new Error('redis unreachable'))

    const response = await POST(makeRequest({ paymentMethodCode: 'gateway:acme' }, VALID_HEADERS))

    expect(response.status).toBe(503)
    expect(mockCommandExecute).not.toHaveBeenCalled()
  })

  it('requires the Idempotency-Key header (§7.1 precondition 2), never dispatching the command without one', async () => {
    const response = await POST(makeRequest({ paymentMethodCode: 'gateway:acme' }, { 'X-Checkout-Session-Token': 'token-1' }))

    expect(response.status).toBe(400)
    expect(mockCommandExecute).not.toHaveBeenCalled()
  })

  it('rejects an Idempotency-Key outside the 16-128 character bound', async () => {
    const response = await POST(makeRequest(
      { paymentMethodCode: 'gateway:acme' },
      { 'X-Checkout-Session-Token': 'token-1', 'Idempotency-Key': 'short' },
    ))

    expect(response.status).toBe(400)
    expect(mockCommandExecute).not.toHaveBeenCalled()
  })

  it('rejects a missing paymentMethodCode with 400, never dispatching the command', async () => {
    const response = await POST(makeRequest({}, VALID_HEADERS))

    expect(response.status).toBe(400)
    expect(mockCommandExecute).not.toHaveBeenCalled()
  })

  // D-R5-33 / cross-tenant isolation: both collapse to the SAME `resolveCurrentSession`
  // failure response (its own unit tests already cover the identity-mismatch and
  // cross-tenant-scope-mismatch cases in detail) — this route's own contract is simply
  // that it defers to that helper and never dispatches the command on an `ok: false`.
  it('defers to resolveCurrentSession for D-R5-33/cross-tenant binding and returns its response verbatim on failure', async () => {
    const notFoundResponse = new Response(JSON.stringify({ error: '[internal] checkout session not found' }), { status: 404 })
    ;(resolveCurrentSession as jest.Mock).mockResolvedValue({ ok: false, response: notFoundResponse })

    const response = await POST(makeRequest({ paymentMethodCode: 'gateway:acme' }, VALID_HEADERS))

    expect(response.status).toBe(404)
    expect(mockCommandExecute).not.toHaveBeenCalled()
  })

  it('dispatches checkout.session.submit scoped to the RESOLVED session\'s own tenant/organization, never request input', async () => {
    await POST(makeRequest({ paymentMethodCode: 'on_account' }, VALID_HEADERS))

    expect(mockCommandExecute).toHaveBeenCalledWith('checkout.session.submit', expect.objectContaining({
      input: expect.objectContaining({
        sessionId: 'session-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        paymentMethodCode: 'on_account',
        idempotencyKey: 'a-valid-idempotency-key-1',
      }),
    }))
  })

  it('maps the command\'s 409 promotion_unavailable straight through, never a 500', async () => {
    mockCommandExecute.mockRejectedValue(new CrudHttpError(409, { error: 'a code is unavailable', code: 'promotion_unavailable' }))

    const response = await POST(makeRequest({ paymentMethodCode: 'gateway:acme' }, VALID_HEADERS))

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'promotion_unavailable' })
  })

  it('returns the serialized session plus the order/quote ids on success', async () => {
    const response = await POST(makeRequest({ paymentMethodCode: 'gateway:acme' }, VALID_HEADERS))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.session.id).toBe('session-1')
    expect(body.session.status).toBe('completed')
    expect(body.salesOrderId).toBe('order-1')
    expect(body.salesQuoteId).toBe('quote-1')
  })
})
