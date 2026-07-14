/**
 * @jest-environment node
 *
 * `/api/directory/tenants/lookup` is unauthenticated (`requireAuth: false`) because the
 * login and onboarding bootstrap screens resolve the tenant name before the visitor signs
 * in. That makes it a name-disclosure oracle for anyone holding a tenant id (#3850), so the
 * route MUST consume the shared IP rate limiter before it validates input or touches the
 * database. If the throttle is dropped, the 429 assertions below fail.
 */

import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'

const tenantId = randomUUID()

const em = {
  findOne: jest.fn(async () => ({ id: tenantId, name: 'Acme Corp' })),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (name: string) => (name === 'em' ? em : null),
  }),
}))

const checkRateLimit = jest.fn(async (): Promise<NextResponse | null> => null)

jest.mock('@open-mercato/core/bootstrap', () => ({
  getCachedRateLimiterService: () => ({ trustProxyDepth: 0 }),
}))

jest.mock('@open-mercato/shared/lib/ratelimit/helpers', () => ({
  checkRateLimit: (...args: unknown[]) => checkRateLimit(...(args as [])),
  getClientIp: () => '203.0.113.10',
  rateLimitErrorSchema: { _def: {} },
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))

import { GET } from '@open-mercato/core/modules/directory/api/get/tenants/lookup'

function lookupRequest(id: string): Request {
  return new Request(`http://localhost/api/directory/tenants/lookup?tenantId=${encodeURIComponent(id)}`)
}

beforeEach(() => {
  jest.clearAllMocks()
  checkRateLimit.mockResolvedValue(null)
  em.findOne.mockResolvedValue({ id: tenantId, name: 'Acme Corp' })
})

describe('GET /api/directory/tenants/lookup', () => {
  it('resolves the tenant name when the caller is under the rate limit', async () => {
    const res = await GET(lookupRequest(tenantId))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      ok: true,
      tenant: { id: tenantId, name: 'Acme Corp' },
    })
    expect(checkRateLimit).toHaveBeenCalledTimes(1)
  })

  it('returns the limiter 429 and discloses no tenant name once the IP cap is exceeded', async () => {
    checkRateLimit.mockResolvedValue(NextResponse.json({ error: 'Too many requests.' }, { status: 429 }))

    const res = await GET(lookupRequest(tenantId))

    expect(res.status).toBe(429)
    await expect(res.json()).resolves.toEqual({ error: 'Too many requests.' })
  })

  it('consumes the rate limit before touching the database', async () => {
    checkRateLimit.mockResolvedValue(NextResponse.json({ error: 'Too many requests.' }, { status: 429 }))

    await GET(lookupRequest(tenantId))

    expect(em.findOne).not.toHaveBeenCalled()
  })

  it('rate-limits invalid tenant ids too, so the limiter cannot be bypassed with junk input', async () => {
    checkRateLimit.mockResolvedValue(NextResponse.json({ error: 'Too many requests.' }, { status: 429 }))

    const res = await GET(lookupRequest('not-a-uuid'))

    expect(res.status).toBe(429)
  })

  it('still rejects a malformed tenant id with 400 when under the limit', async () => {
    const res = await GET(lookupRequest('not-a-uuid'))

    expect(res.status).toBe(400)
    expect(em.findOne).not.toHaveBeenCalled()
  })

  it('still returns 404 for an unknown tenant id', async () => {
    em.findOne.mockResolvedValue(null as never)

    const res = await GET(lookupRequest(randomUUID()))

    expect(res.status).toBe(404)
  })
})
