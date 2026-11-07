/** @jest-environment node */
// Step 4.5 — route-level coverage for `GET/POST /api/assisted_selling/storefront/thread`:
// the D-R5-13/D-R5-21 identity-binding wiring (delegated to, and so proven through,
// `resolveIdentifiedBuyerBasket` — its own unit coverage lives in
// `lib/__tests__/buyerIdentity.test.ts`), the rate-limit wiring, and the HTTP mapping of the
// buyer-open command's own result/errors. The command's own business logic is covered by
// `commands/__tests__/buyerThread.test.ts`.

jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('@open-mercato/shared/lib/ratelimit/helpers', () => ({
  checkRateLimit: jest.fn(),
  getClientIp: jest.fn(),
  RATE_LIMIT_ERROR_KEY: 'api.errors.rateLimit',
  RATE_LIMIT_ERROR_FALLBACK: 'Too many requests. Please try again later.',
}))
jest.mock('../../../../lib/buyerIdentity', () => ({
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
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async () => []),
}))

const mockCommandExecute = jest.fn()

import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { checkRateLimit, getClientIp } from '@open-mercato/shared/lib/ratelimit/helpers'
import { readAssistedSellingCartToken, resolveIdentifiedBuyerBasket } from '../../../../lib/buyerIdentity'
import { GET, POST } from '../route'

function makeRequest(method: string, headers: Record<string, string> = {}, body?: unknown) {
  return new Request('https://merchant.example/api/assisted_selling/storefront/thread', {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

const TENANT_ID = 'tenant-1'
const ORG_ID = 'org-1'
const CART_ID = 'cart-1'

const GUEST_BASKET = { id: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID, storeId: 'store-1', status: 'active', customerId: null, customerUserId: null }

describe('GET /api/assisted_selling/storefront/thread', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(checkRateLimit as jest.Mock).mockResolvedValue(null)
    ;(getClientIp as jest.Mock).mockReturnValue('127.0.0.1')
    ;(createRequestContainer as jest.Mock).mockResolvedValue({
      resolve: (name: string) => {
        if (name === 'rateLimiterService') return { trustProxyDepth: 0 }
        if (name === 'em') return { fork: () => ({ findOne: jest.fn(async () => null), find: jest.fn(async () => []) }) }
        throw new Error(`Unknown dependency: ${name}`)
      },
    })
    ;(readAssistedSellingCartToken as jest.Mock).mockReturnValue('plaintext-token')
    ;(resolveIdentifiedBuyerBasket as jest.Mock).mockResolvedValue(GUEST_BASKET)
  })

  it('answers 404 when no X-Cart-Token header is supplied', async () => {
    ;(readAssistedSellingCartToken as jest.Mock).mockReturnValue(null)

    const response = await GET(makeRequest('GET'))

    expect(response.status).toBe(404)
    expect(resolveIdentifiedBuyerBasket).not.toHaveBeenCalled()
  })

  it('enforces the 120/min read rate limit', async () => {
    await GET(makeRequest('GET', { 'X-Cart-Token': 'token-1' }))

    expect(checkRateLimit).toHaveBeenCalledTimes(1)
  })

  it('returns the 429 the limiter produces and never resolves the basket', async () => {
    ;(checkRateLimit as jest.Mock).mockResolvedValue(new Response(JSON.stringify({ error: 'Too many' }), { status: 429, headers: { 'Retry-After': '30' } }))

    const response = await GET(makeRequest('GET', { 'X-Cart-Token': 'token-1' }))

    expect(response.status).toBe(429)
    expect(resolveIdentifiedBuyerBasket).not.toHaveBeenCalled()
  })

  it('answers 404 when the identity-binding check refuses the token (D-R5-21)', async () => {
    ;(resolveIdentifiedBuyerBasket as jest.Mock).mockResolvedValue(null)

    const response = await GET(makeRequest('GET', { 'X-Cart-Token': 'token-1' }))

    expect(response.status).toBe(404)
  })

  it('answers 404 when no open thread exists for the basket', async () => {
    const response = await GET(makeRequest('GET', { 'X-Cart-Token': 'token-1' }))

    expect(response.status).toBe(404)
  })

  it('returns the thread, participants, messages and proposal ids when one exists', async () => {
    ;(createRequestContainer as jest.Mock).mockResolvedValue({
      resolve: (name: string) => {
        if (name === 'rateLimiterService') return { trustProxyDepth: 0 }
        if (name === 'em') {
          return {
            fork: () => ({
              findOne: jest.fn(async () => ({
                id: 'thread-1',
                status: 'open',
                modeSnapshot: 'rep',
                lastActivityAt: new Date('2026-01-01T00:00:00.000Z'),
                createdAt: new Date('2026-01-01T00:00:00.000Z'),
                updatedAt: new Date('2026-01-01T00:00:00.000Z'),
              })),
              find: jest.fn(async () => [{ id: 'proposal-1' }]),
            }),
          }
        }
        throw new Error(`Unknown dependency: ${name}`)
      },
    })

    const response = await GET(makeRequest('GET', { 'X-Cart-Token': 'token-1' }))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.thread.id).toBe('thread-1')
    expect(json.proposalIds).toEqual(['proposal-1'])
  })
})

describe('POST /api/assisted_selling/storefront/thread', () => {
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
    ;(readAssistedSellingCartToken as jest.Mock).mockReturnValue('plaintext-token')
    ;(resolveIdentifiedBuyerBasket as jest.Mock).mockResolvedValue(GUEST_BASKET)
    mockCommandExecute.mockResolvedValue({ result: { threadId: 'thread-1', status: 'open', alreadyOpen: false } })
  })

  it('answers 404 when no X-Cart-Token header is supplied', async () => {
    ;(readAssistedSellingCartToken as jest.Mock).mockReturnValue(null)

    const response = await POST(makeRequest('POST', {}, {}))

    expect(response.status).toBe(404)
    expect(mockCommandExecute).not.toHaveBeenCalled()
  })

  it('enforces the 10/min open rate limit', async () => {
    await POST(makeRequest('POST', { 'X-Cart-Token': 'token-1' }, {}))

    expect(checkRateLimit).toHaveBeenCalledTimes(1)
  })

  it('dispatches the open-as-buyer command and answers 201 on a fresh open', async () => {
    const response = await POST(makeRequest('POST', { 'X-Cart-Token': 'token-1' }, {}))
    const json = await response.json()

    expect(response.status).toBe(201)
    expect(json.result.threadId).toBe('thread-1')
    expect(mockCommandExecute.mock.calls[0][1].input).toMatchObject({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      storeId: 'store-1',
      buyerCartId: CART_ID,
    })
    // §6.2: buyer commands carry NO staff principal.
    expect(mockCommandExecute.mock.calls[0][1].ctx.auth).toBeNull()
  })

  it('answers 200 (creates nothing) when the thread already existed', async () => {
    mockCommandExecute.mockResolvedValue({ result: { threadId: 'thread-1', status: 'open', alreadyOpen: true } })

    const response = await POST(makeRequest('POST', { 'X-Cart-Token': 'token-1' }, {}))

    expect(response.status).toBe(200)
  })

  it('rejects an unexpected body field with 400 (.strict())', async () => {
    const response = await POST(makeRequest('POST', { 'X-Cart-Token': 'token-1' }, { note: 'not allowed' }))

    expect(response.status).toBe(400)
    expect(mockCommandExecute).not.toHaveBeenCalled()
  })

  it('answers 404 when the identity-binding check refuses the token', async () => {
    ;(resolveIdentifiedBuyerBasket as jest.Mock).mockResolvedValue(null)

    const response = await POST(makeRequest('POST', { 'X-Cart-Token': 'token-1' }, {}))

    expect(response.status).toBe(404)
    expect(mockCommandExecute).not.toHaveBeenCalled()
  })
})
