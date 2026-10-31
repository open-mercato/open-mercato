/** @jest-environment node */
// Step 4.5 (§6.2, S25) — route-level coverage for `GET /api/assisted_selling/storefront/
// thread/events`: ETag/304 mechanics, the signal-only response shape (no message body,
// line, price, participant name or proposal content), and rate limiting.

jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('@open-mercato/shared/lib/ratelimit/helpers', () => ({
  checkRateLimit: jest.fn(),
  getClientIp: jest.fn(),
  RATE_LIMIT_ERROR_KEY: 'api.errors.rateLimit',
  RATE_LIMIT_ERROR_FALLBACK: 'Too many requests. Please try again later.',
}))
jest.mock('../../../../../lib/buyerIdentity', () => ({
  ASSISTED_SELLING_CART_TOKEN_HEADER: 'X-Cart-Token',
  readAssistedSellingCartToken: jest.fn(),
  resolveIdentifiedBuyerBasket: jest.fn(),
  notFoundThreadResponse: () => new Response(JSON.stringify({ error: '[internal] not found' }), { status: 404 }),
  mapAssistedSellingBuyerRouteError: (err: unknown) => {
    const { isCrudHttpError } = jest.requireActual('@open-mercato/shared/lib/crud/errors')
    if (isCrudHttpError(err)) return new Response(JSON.stringify(err.body), { status: err.status })
    throw err
  },
}))

import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { checkRateLimit, getClientIp } from '@open-mercato/shared/lib/ratelimit/helpers'
import { readAssistedSellingCartToken, resolveIdentifiedBuyerBasket } from '../../../../../lib/buyerIdentity'
import { GET } from '../route'

function makeRequest(headers: Record<string, string> = {}, search = '') {
  return new Request(`https://merchant.example/api/assisted_selling/storefront/thread/events${search}`, { headers })
}

const GUEST_BASKET = { id: 'cart-1', tenantId: 'tenant-1', organizationId: 'org-1', storeId: 'store-1', status: 'active', customerId: null, customerUserId: null }
const THREAD_UPDATED_AT = new Date('2026-01-01T12:00:00.000Z')
const CURSOR = THREAD_UPDATED_AT.toISOString()

function makeEm(proposals: Array<{ id: string; updatedAt: Date }> = []) {
  return {
    findOne: jest.fn(async () => ({ id: 'thread-1', updatedAt: THREAD_UPDATED_AT })),
    find: jest.fn(async () => proposals),
  }
}

function mockContainer(em: ReturnType<typeof makeEm>) {
  ;(createRequestContainer as jest.Mock).mockResolvedValue({
    resolve: (name: string) => {
      if (name === 'rateLimiterService') return { trustProxyDepth: 0 }
      if (name === 'em') return { fork: () => em }
      throw new Error(`Unknown dependency: ${name}`)
    },
  })
}

describe('GET /api/assisted_selling/storefront/thread/events (§6.2, S25)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(checkRateLimit as jest.Mock).mockResolvedValue(null)
    ;(getClientIp as jest.Mock).mockReturnValue('127.0.0.1')
    ;(readAssistedSellingCartToken as jest.Mock).mockReturnValue('plaintext-token')
    ;(resolveIdentifiedBuyerBasket as jest.Mock).mockResolvedValue(GUEST_BASKET)
    mockContainer(makeEm())
  })

  it('answers 404 when no X-Cart-Token header is supplied', async () => {
    ;(readAssistedSellingCartToken as jest.Mock).mockReturnValue(null)

    const response = await GET(makeRequest())

    expect(response.status).toBe(404)
  })

  it('enforces the 240/min events rate limit', async () => {
    await GET(makeRequest({ 'X-Cart-Token': 'token-1' }))

    expect(checkRateLimit).toHaveBeenCalledTimes(1)
  })

  it('answers 404 when the identity-binding check refuses the token', async () => {
    ;(resolveIdentifiedBuyerBasket as jest.Mock).mockResolvedValue(null)

    const response = await GET(makeRequest({ 'X-Cart-Token': 'token-1' }))

    expect(response.status).toBe(404)
  })

  it('answers 404 when the basket has no open thread', async () => {
    mockContainer({ findOne: jest.fn(async () => null), find: jest.fn(async () => []) } as any)

    const response = await GET(makeRequest({ 'X-Cart-Token': 'token-1' }))

    expect(response.status).toBe(404)
  })

  it('first call with no If-None-Match/since returns 200 with an ETag and changed: true', async () => {
    mockContainer(makeEm([{ id: 'proposal-1', updatedAt: THREAD_UPDATED_AT }]))

    const response = await GET(makeRequest({ 'X-Cart-Token': 'token-1' }))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('ETag')).toBe(`"${CURSOR}"`)
    expect(json).toEqual({ cursor: CURSOR, changed: true, threadUpdatedAt: CURSOR, proposalIds: ['proposal-1'] })
  })

  it('the SAME If-None-Match as the current cursor answers 304 with no body, before any proposal read', async () => {
    const em = makeEm([{ id: 'proposal-1', updatedAt: THREAD_UPDATED_AT }])
    mockContainer(em)

    const response = await GET(makeRequest({ 'X-Cart-Token': 'token-1', 'If-None-Match': `"${CURSOR}"` }))

    expect(response.status).toBe(304)
    expect(await response.text()).toBe('')
    expect(em.find).not.toHaveBeenCalled()
  })

  it('a `since` query param equal to the current cursor also answers 304', async () => {
    const response = await GET(makeRequest({ 'X-Cart-Token': 'token-1' }, `?since=${encodeURIComponent(CURSOR)}`))

    expect(response.status).toBe(304)
  })

  it('an older since returns 200 with changed: true and only proposals updated after it', async () => {
    const olderCursor = new Date('2026-01-01T00:00:00.000Z').toISOString()
    mockContainer(
      makeEm([
        { id: 'stale-proposal', updatedAt: new Date('2025-12-31T00:00:00.000Z') },
        { id: 'fresh-proposal', updatedAt: new Date('2026-01-01T06:00:00.000Z') },
      ]),
    )

    const response = await GET(makeRequest({ 'X-Cart-Token': 'token-1' }, `?since=${encodeURIComponent(olderCursor)}`))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.changed).toBe(true)
    expect(json.proposalIds).toEqual(['fresh-proposal'])
  })

  it('never leaks a message body, line, price, participant name or proposal content — the response shape is signal-only', async () => {
    mockContainer(makeEm([{ id: 'proposal-1', updatedAt: THREAD_UPDATED_AT }]))

    const response = await GET(makeRequest({ 'X-Cart-Token': 'token-1' }))
    const json = await response.json()

    expect(Object.keys(json).sort()).toEqual(['changed', 'cursor', 'proposalIds', 'threadUpdatedAt'])
  })
})
