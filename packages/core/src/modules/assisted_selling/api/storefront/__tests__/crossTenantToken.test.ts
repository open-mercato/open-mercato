/** @jest-environment node */
// Scan #12: a guest cart token replayed on ANOTHER tenant's storefront must never reach any
// thread read/write. Every buyer route is exercised with the REAL `resolveIdentifiedBuyerBasket`.

jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('@open-mercato/core/modules/customer_accounts/lib/customerAuth', () => ({
  getCustomerAuthFromRequest: jest.fn(async () => null),
}))
jest.mock('../../../lib/rateLimit', () => ({ enforceAssistedSellingBuyerRateLimit: jest.fn(async () => null) }))

import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { GET as threadGet, POST as threadPost } from '../thread/route'
import { POST as messagesPost } from '../thread/messages/route'
import { GET as eventsGet } from '../thread/events/route'

const VICTIM_TENANT = '11111111-1111-4111-8111-111111111111'
const ATTACKER_TENANT = '99999999-9999-4999-8999-999999999999'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const STORE_ID = '33333333-3333-4333-8333-333333333333'

const VICTIM_BASKET = {
  id: '44444444-4444-4444-8444-444444444444',
  tenantId: VICTIM_TENANT,
  organizationId: ORG_ID,
  storeId: STORE_ID,
  status: 'active',
  customerId: null,
  customerUserId: null,
}

function setupContainer() {
  const em = { fork: jest.fn(), findOne: jest.fn(), find: jest.fn() }
  em.fork.mockReturnValue(em)
  const commandBus = { execute: jest.fn() }
  const cartService = {
    resolveBasketByToken: jest.fn(async (input: { tenantId: string; organizationId: string; storeId: string | null }) =>
      input.tenantId === VICTIM_TENANT && input.organizationId === ORG_ID && input.storeId === STORE_ID ? VICTIM_BASKET : null,
    ),
  }
  const storeContextService = {
    resolve: jest.fn(async () => ({ tenantId: ATTACKER_TENANT, organizationId: ORG_ID, store: { id: STORE_ID } })),
  }
  ;(createRequestContainer as jest.Mock).mockResolvedValue({
    resolve: (name: string) => {
      if (name === 'em') return em
      if (name === 'commandBus') return commandBus
      if (name === 'cartService') return cartService
      if (name === 'storeContextService') return storeContextService
      throw new Error(`Unknown dependency: ${name}`)
    },
  })
  return { em, commandBus, cartService }
}

function makeRequest(method: string, path: string, body?: unknown) {
  return new Request(`https://attacker.example/api/assisted_selling/storefront/${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'X-Cart-Token': 'victim-guest-token' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

describe('buyer routes reject a guest token replayed on another tenant\'s storefront', () => {
  beforeEach(() => jest.clearAllMocks())

  const cases: Array<[string, (request: Request) => Promise<Response>, Request]> = [
    ['GET /thread', (request) => threadGet(request), makeRequest('GET', 'thread')],
    ['POST /thread', (request) => threadPost(request), makeRequest('POST', 'thread', {})],
    ['POST /thread/messages', (request) => messagesPost(request), makeRequest('POST', 'thread/messages', { body: 'hello' })],
    ['GET /thread/events', (request) => eventsGet(request), makeRequest('GET', 'thread/events')],
  ]

  it.each(cases)('%s answers 404 and never touches threads', async (_label, handler, request) => {
    const { em, commandBus, cartService } = setupContainer()

    const response = await handler(request)

    expect(response.status).toBe(404)
    expect(cartService.resolveBasketByToken).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: ATTACKER_TENANT, organizationId: ORG_ID, storeId: STORE_ID }),
    )
    expect(em.findOne).not.toHaveBeenCalled()
    expect(em.find).not.toHaveBeenCalled()
    expect(commandBus.execute).not.toHaveBeenCalled()
  })
})
