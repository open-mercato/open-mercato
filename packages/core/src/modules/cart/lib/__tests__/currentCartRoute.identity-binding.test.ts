/** @jest-environment node */
// Step 2.9 — §8.4/D-R5-21: an identified basket (`customerUserId` set) answers only to its
// own buyer's customer session on every `/current/*` route. `resolveCurrentCart` is the ONE
// seam all eight `/current/*` route files funnel through (`lib/currentCartRoute.ts`), so
// this suite exercises it directly rather than duplicating the check per route file.
//
// X1 regression (the bypass this step closes): through Release 4, an anonymous request
// carrying an identified basket's token reached `cart.get`, whose own trigger 2
// (`applyCartRepriceTriggerFields`) rewrote `customerUserId` to whoever presented the token —
// silently turning a B2B buyer's basket into a guest one. The tests below assert not just
// the right response (`null`, same as an unknown token) but that `commandBus.execute` (i.e.
// `cart.get`) is never even called when the identity check fails — proving the fix runs
// BEFORE the bypass's own write path, not merely papering over its output.

const mockGetCustomerAuthFromRequest = jest.fn()
jest.mock('@open-mercato/core/modules/customer_accounts/lib/customerAuth', () => ({
  getCustomerAuthFromRequest: (...args: unknown[]) => mockGetCustomerAuthFromRequest(...args),
}))

type FakeRow = Record<string, unknown>

function matchesWhere(row: FakeRow, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true
    return row[key] === value
  })
}

let seededCarts: FakeRow[] = []

const mockFindOneWithDecryption = jest.fn(async (_em: unknown, _entity: unknown, where: Record<string, unknown>) => {
  return seededCarts.find((row) => matchesWhere(row, where)) ?? null
})

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) =>
    mockFindOneWithDecryption(...(args as [unknown, unknown, Record<string, unknown>])),
}))

import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { hashCartToken } from '../token'
import type { ResolvedCartRouteContext } from '../routeContext'
import { resolveCurrentCart } from '../currentCartRoute'

const TENANT_ID = 'tenant-cart-bind-1'
const ORG_ID = 'org-cart-bind-1'
const TOKEN = 'plain-cart-token'

function makeRouteContext(overrides: Partial<ResolvedCartRouteContext> = {}): ResolvedCartRouteContext {
  return {
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    storeId: 'store-1',
    channel: 'storefront',
    assortmentScope: null,
    buyerDigest: 'digest-1',
    customerId: null,
    customerIds: [],
    customerGroupIds: [],
    customerUserId: null,
    currencyCode: 'USD',
    locale: 'en-US',
    taxMode: 'gross',
    salesChannelId: 'sales-channel-1',
    priceKindId: null,
    ...overrides,
  }
}

function makeCartRow(overrides: FakeRow = {}): FakeRow {
  return {
    id: 'cart-1',
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    tokenHash: hashCartToken(TOKEN),
    kind: 'basket',
    customerUserId: null,
    ...overrides,
  }
}

function makeFakeCommandBus(): { bus: CommandBus; execute: jest.Mock } {
  const execute = jest.fn(async () => ({
    result: { found: true, cart: { id: 'cart-1' }, priceChanges: [] },
  }))
  return { bus: { execute } as unknown as CommandBus, execute }
}

function makeCtx(request: Request | undefined): CommandRuntimeContext {
  return {
    container: {
      resolve: (token: string): any => {
        if (token === 'em') return { fork: () => ({}) }
        throw new Error(`Unexpected DI token: ${token}`)
      },
      register: jest.fn(),
    } as any,
    auth: null,
    selectedOrganizationId: null,
    organizationScope: null,
    organizationIds: null,
    request,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  seededCarts = []
})

describe('resolveCurrentCart — §8.4/D-R5-21 identity binding', () => {
  it('404-collapses (returns null) when the token does not resolve any cart, without calling the command bus', async () => {
    seededCarts = []
    const { bus, execute } = makeFakeCommandBus()
    const ctx = makeCtx(new Request('https://example.com'))

    const result = await resolveCurrentCart(bus, ctx, makeRouteContext(), TOKEN)

    expect(result).toBeNull()
    expect(execute).not.toHaveBeenCalled()
  })

  it('a guest basket (customerUserId null) stays fully token-only — no session required, cart.get still runs', async () => {
    seededCarts = [makeCartRow({ customerUserId: null })]
    const { bus, execute } = makeFakeCommandBus()
    const ctx = makeCtx(new Request('https://example.com'))

    const result = await resolveCurrentCart(bus, ctx, makeRouteContext(), TOKEN)

    expect(result).not.toBeNull()
    expect(mockGetCustomerAuthFromRequest).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('an identified basket refuses a token-only anonymous request — same null as an unknown token, cart.get never runs (closes X1)', async () => {
    seededCarts = [makeCartRow({ customerUserId: 'customer-user-owner' })]
    mockGetCustomerAuthFromRequest.mockResolvedValue(null)
    const { bus, execute } = makeFakeCommandBus()
    const ctx = makeCtx(new Request('https://example.com'))

    const result = await resolveCurrentCart(bus, ctx, makeRouteContext(), TOKEN)

    expect(result).toBeNull()
    expect(execute).not.toHaveBeenCalled()
  })

  it('an identified basket refuses a DIFFERENT customer\'s valid session — not just "no session"', async () => {
    seededCarts = [makeCartRow({ customerUserId: 'customer-user-owner' })]
    mockGetCustomerAuthFromRequest.mockResolvedValue({ sub: 'customer-user-someone-else', type: 'customer' })
    const { bus, execute } = makeFakeCommandBus()
    const ctx = makeCtx(new Request('https://example.com'))

    const result = await resolveCurrentCart(bus, ctx, makeRouteContext(), TOKEN)

    expect(result).toBeNull()
    expect(execute).not.toHaveBeenCalled()
  })

  it('an identified basket succeeds for its own matching customer session', async () => {
    seededCarts = [makeCartRow({ customerUserId: 'customer-user-owner' })]
    mockGetCustomerAuthFromRequest.mockResolvedValue({ sub: 'customer-user-owner', type: 'customer' })
    const { bus, execute } = makeFakeCommandBus()
    const ctx = makeCtx(new Request('https://example.com'))

    const result = await resolveCurrentCart(bus, ctx, makeRouteContext({ customerUserId: 'customer-user-owner' }), TOKEN)

    expect(result).not.toBeNull()
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('an identified basket refuses a request with no `request` on the command context at all (defensive — every real /current/* route always supplies one)', async () => {
    seededCarts = [makeCartRow({ customerUserId: 'customer-user-owner' })]
    const { bus, execute } = makeFakeCommandBus()
    const ctx = makeCtx(undefined)

    const result = await resolveCurrentCart(bus, ctx, makeRouteContext(), TOKEN)

    expect(result).toBeNull()
    expect(mockGetCustomerAuthFromRequest).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
  })
})
