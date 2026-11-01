// Step 4.5 (§6.2, D-R5-13/D-R5-21) — the THIRD application of this run's identity-binding
// mechanism. Mirrors `cart/lib/__tests__/currentCartRoute.identity-binding.test.ts`'s own
// test shape for the SAME rule, applied here against `resolveIdentifiedBuyerBasket`.

const mockGetCustomerAuthFromRequest = jest.fn()
jest.mock('@open-mercato/core/modules/customer_accounts/lib/customerAuth', () => ({
  getCustomerAuthFromRequest: (...args: unknown[]) => mockGetCustomerAuthFromRequest(...args),
}))

import { readAssistedSellingCartToken, resolveIdentifiedBuyerBasket } from '../buyerIdentity'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const CART_ID = '44444444-4444-4444-8444-444444444444'
const CUSTOMER_USER_ID = '66666666-6666-4666-8666-666666666666'
const OTHER_CUSTOMER_USER_ID = '77777777-7777-4777-8777-777777777777'

function makeRequest(headers: Record<string, string> = {}) {
  return new Request('https://merchant.example/api/assisted_selling/storefront/thread', { headers })
}

function makeContainer(resolveBasketByToken: jest.Mock) {
  return { resolve: (name: string) => (name === 'cartService' ? { resolveBasketByToken } : undefined) }
}

const GUEST_BASKET = {
  id: CART_ID,
  tenantId: TENANT_ID,
  organizationId: ORG_ID,
  storeId: 'store-1',
  status: 'active',
  customerId: null,
  customerUserId: null,
}

const IDENTIFIED_BASKET = { ...GUEST_BASKET, customerId: 'customer-1', customerUserId: CUSTOMER_USER_ID }

beforeEach(() => {
  jest.clearAllMocks()
})

describe('readAssistedSellingCartToken', () => {
  it('reads X-Cart-Token, trimmed', () => {
    expect(readAssistedSellingCartToken(makeRequest({ 'X-Cart-Token': '  token-1  ' }))).toBe('token-1')
  })

  it('returns null when absent', () => {
    expect(readAssistedSellingCartToken(makeRequest())).toBeNull()
  })
})

describe('resolveIdentifiedBuyerBasket (D-R5-13/D-R5-21)', () => {
  it('resolves a guest basket with the token alone — no customer session required', async () => {
    const resolveBasketByToken = jest.fn(async () => GUEST_BASKET)
    const container = makeContainer(resolveBasketByToken)

    const result = await resolveIdentifiedBuyerBasket(container, makeRequest(), 'guest-token')

    expect(result).toEqual(GUEST_BASKET)
    expect(mockGetCustomerAuthFromRequest).not.toHaveBeenCalled()
  })

  it('returns null for an unknown token', async () => {
    const resolveBasketByToken = jest.fn(async () => null)
    const container = makeContainer(resolveBasketByToken)

    const result = await resolveIdentifiedBuyerBasket(container, makeRequest(), 'unknown-token')

    expect(result).toBeNull()
  })

  it('an identified basket requires the matching customer session — resolves when present', async () => {
    const resolveBasketByToken = jest.fn(async () => IDENTIFIED_BASKET)
    mockGetCustomerAuthFromRequest.mockResolvedValue({ sub: CUSTOMER_USER_ID })
    const container = makeContainer(resolveBasketByToken)

    const result = await resolveIdentifiedBuyerBasket(container, makeRequest(), 'identified-token')

    expect(result).toEqual(IDENTIFIED_BASKET)
  })

  it('refuses an identified basket with NO customer session — collapses to null, same as an unknown token', async () => {
    const resolveBasketByToken = jest.fn(async () => IDENTIFIED_BASKET)
    mockGetCustomerAuthFromRequest.mockResolvedValue(null)
    const container = makeContainer(resolveBasketByToken)

    const result = await resolveIdentifiedBuyerBasket(container, makeRequest(), 'identified-token')

    expect(result).toBeNull()
  })

  it('refuses an identified basket presented with ANOTHER buyer\'s session (wrong session)', async () => {
    const resolveBasketByToken = jest.fn(async () => IDENTIFIED_BASKET)
    mockGetCustomerAuthFromRequest.mockResolvedValue({ sub: OTHER_CUSTOMER_USER_ID })
    const container = makeContainer(resolveBasketByToken)

    const result = await resolveIdentifiedBuyerBasket(container, makeRequest(), 'identified-token')

    expect(result).toBeNull()
  })

  it('a replayed token after logout (no session) never re-identifies the basket as a guest (§8.12)', async () => {
    // The basket row itself still carries `customerUserId` — `resolveBasketByToken` never
    // rewrites it (it is a pure, read-only lookup) — so presenting the token with no
    // session still refuses, rather than silently falling back to guest access.
    const resolveBasketByToken = jest.fn(async () => IDENTIFIED_BASKET)
    mockGetCustomerAuthFromRequest.mockResolvedValue(null)
    const container = makeContainer(resolveBasketByToken)

    const result = await resolveIdentifiedBuyerBasket(container, makeRequest(), 'stale-token')

    expect(result).toBeNull()
    expect(resolveBasketByToken).toHaveBeenCalledWith({ token: 'stale-token' })
  })
})
