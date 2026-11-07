/** @jest-environment node */
// Step 4.5 — route-level coverage for `POST /api/assisted_selling/storefront/thread/messages`.

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

const mockCommandExecute = jest.fn()

import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { checkRateLimit, getClientIp } from '@open-mercato/shared/lib/ratelimit/helpers'
import { readAssistedSellingCartToken, resolveIdentifiedBuyerBasket } from '../../../../../lib/buyerIdentity'
import { POST } from '../route'

function makeRequest(headers: Record<string, string> = {}, body?: unknown) {
  return new Request('https://merchant.example/api/assisted_selling/storefront/thread/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

const GUEST_BASKET = { id: 'cart-1', tenantId: 'tenant-1', organizationId: 'org-1', storeId: 'store-1', status: 'active', customerId: null, customerUserId: null }

describe('POST /api/assisted_selling/storefront/thread/messages', () => {
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
    mockCommandExecute.mockResolvedValue({ result: { messageId: 'message-1', threadId: 'thread-1' } })
  })

  it('answers 404 when no X-Cart-Token header is supplied', async () => {
    ;(readAssistedSellingCartToken as jest.Mock).mockReturnValue(null)

    const response = await POST(makeRequest({}, { body: 'hi' }))

    expect(response.status).toBe(404)
    expect(mockCommandExecute).not.toHaveBeenCalled()
  })

  it('enforces the 30/min message rate limit', async () => {
    await POST(makeRequest({ 'X-Cart-Token': 'token-1' }, { body: 'hi' }))

    expect(checkRateLimit).toHaveBeenCalledTimes(1)
  })

  it('posts the message and returns 201 with the result', async () => {
    const response = await POST(makeRequest({ 'X-Cart-Token': 'token-1' }, { body: 'hello rep' }))
    const json = await response.json()

    expect(response.status).toBe(201)
    expect(json.result.messageId).toBe('message-1')
    expect(mockCommandExecute.mock.calls[0][1].input).toMatchObject({ body: 'hello rep', buyerCartId: 'cart-1' })
  })

  it('rejects bodyFormat other than text with 400 (S24)', async () => {
    const response = await POST(makeRequest({ 'X-Cart-Token': 'token-1' }, { body: 'hello', bodyFormat: 'markdown' }))

    expect(response.status).toBe(400)
    expect(mockCommandExecute).not.toHaveBeenCalled()
  })

  it('rejects an empty body with 400', async () => {
    const response = await POST(makeRequest({ 'X-Cart-Token': 'token-1' }, { body: '' }))

    expect(response.status).toBe(400)
  })

  it('answers 404 when identity binding refuses the token', async () => {
    ;(resolveIdentifiedBuyerBasket as jest.Mock).mockResolvedValue(null)

    const response = await POST(makeRequest({ 'X-Cart-Token': 'token-1' }, { body: 'hello' }))

    expect(response.status).toBe(404)
    expect(mockCommandExecute).not.toHaveBeenCalled()
  })

  it('answers 404 (passed through unchanged) when the command itself finds no open thread', async () => {
    const { CrudHttpError } = jest.requireActual('@open-mercato/shared/lib/crud/errors')
    mockCommandExecute.mockRejectedValue(new CrudHttpError(404, { error: '[internal] no open thread' }))

    const response = await POST(makeRequest({ 'X-Cart-Token': 'token-1' }, { body: 'hello' }))

    expect(response.status).toBe(404)
  })
})
