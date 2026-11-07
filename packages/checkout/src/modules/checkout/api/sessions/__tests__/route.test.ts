/** @jest-environment node */
// Step 2.12 — route-level coverage for `POST /api/checkout/sessions`: the rate-limit
// wiring (C14, test priority 6: "rate limiting actually triggers on the create route
// under the configured threshold") and the HTTP-level 503/201/404 mapping. Command
// orchestration itself (token hash, 503 without cart, supersede, etc.) is covered by
// `commands/__tests__/session.test.ts` — this file only proves the ROUTE wires the
// Phase A rate-limit helper correctly and maps command results/errors to the right
// status codes, mirroring `api/pay/[slug]/submit/__tests__/route.test.ts`'s own
// "rate limiting is fail-closed" structure.

const mockCommandExecute = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/ratelimit/helpers', () => ({
  checkRateLimit: jest.fn(),
  getClientIp: jest.fn(),
  RATE_LIMIT_FALLBACK_KEY: 'global',
  RATE_LIMIT_UNAVAILABLE_FALLBACK: 'Service temporarily unavailable. Please try again later.',
}))

import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { checkRateLimit, getClientIp } from '@open-mercato/shared/lib/ratelimit/helpers'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { POST } from '../route'

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://merchant.example/api/checkout/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

describe('POST /api/checkout/sessions', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(checkRateLimit as jest.Mock).mockResolvedValue(null)
    ;(getClientIp as jest.Mock).mockReturnValue('127.0.0.1')
    ;(createRequestContainer as jest.Mock).mockResolvedValue({
      resolve: (name: string) => {
        if (name === 'rateLimiterService') return { trustProxyDepth: 0 }
        if (name === 'commandBus') return { execute: mockCommandExecute }
        throw new Error(`Unknown dependency: ${name}`)
      },
    })
    mockCommandExecute.mockResolvedValue({
      result: { token: 'plaintext-token', session: { id: 'session-1', tenantId: 't', organizationId: 'o', status: 'open', step: 'contact', channel: 'storefront', currencyCode: 'USD', locale: 'en-US', billingSameAsShipping: false, submitAttempt: 0, expiresAt: new Date(), createdAt: new Date(), updatedAt: new Date() } },
    })
  })

  it('asks the limiter to fail closed (C14/§13: 20/min per IP, fail-closed)', async () => {
    await POST(makeRequest({ source: 'cart' }, { 'X-Cart-Token': 'cart-token-1' }))

    expect(checkRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ failClosed: true }),
    )
  })

  it('returns the 429 the limiter produces and never dispatches the command', async () => {
    ;(checkRateLimit as jest.Mock).mockResolvedValue(
      new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429 }),
    )

    const response = await POST(makeRequest({ source: 'cart' }, { 'X-Cart-Token': 'cart-token-1' }))

    expect(response.status).toBe(429)
    expect(mockCommandExecute).not.toHaveBeenCalled()
  })

  it('returns 503 when the limiter cannot decide (fail-closed posture)', async () => {
    ;(checkRateLimit as jest.Mock).mockRejectedValue(new Error('backing store unreachable'))

    const response = await POST(makeRequest({ source: 'cart' }, { 'X-Cart-Token': 'cart-token-1' }))

    expect(response.status).toBe(503)
    expect(mockCommandExecute).not.toHaveBeenCalled()
  })

  it('answers 404 when no X-Cart-Token header is supplied', async () => {
    const response = await POST(makeRequest({ source: 'cart' }))

    expect(response.status).toBe(404)
    expect(mockCommandExecute).not.toHaveBeenCalled()
  })

  it('rejects a malformed body (neither a cart token nor a link slug) with 400, not a silent no-op', async () => {
    const response = await POST(makeRequest({ source: 'link' }))

    expect(response.status).toBe(400)
    expect(mockCommandExecute).not.toHaveBeenCalled()
  })

  // Release 5, Step 3.5 (B.2, D-R5-19) — `{ source: 'link', slug }` now dispatches to the
  // command exactly like `{ source: 'cart' }` does; no `X-Cart-Token` header is read or
  // required for this source.
  it('dispatches { source: "link", slug } to the command with the slug, no cart token required', async () => {
    const response = await POST(makeRequest({ source: 'link', slug: 'donate' }))

    expect(response.status).toBe(201)
    expect(mockCommandExecute).toHaveBeenCalledWith(
      'checkout.session.create',
      expect.objectContaining({ input: expect.objectContaining({ source: 'link', slug: 'donate' }) }),
    )
  })

  it('maps the command 503 (C10/D-R5-18) straight through, never a 500', async () => {
    mockCommandExecute.mockRejectedValue(
      new CrudHttpError(503, { error: 'checkout sessions unavailable', code: 'checkout_sessions_unavailable' }),
    )

    const response = await POST(makeRequest({ source: 'cart' }, { 'X-Cart-Token': 'cart-token-1' }))

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ code: 'checkout_sessions_unavailable' })
  })

  it('returns 201 with the plaintext token once, on success', async () => {
    const response = await POST(makeRequest({ source: 'cart' }, { 'X-Cart-Token': 'cart-token-1' }))

    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.token).toBe('plaintext-token')
    expect(body.session.id).toBe('session-1')
    expect(body.session).not.toHaveProperty('tokenHash')
  })
})
