jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

type FakeCartRow = Record<string, unknown>

const mockFindOneWithDecryption = jest.fn(async (...args: unknown[]) => {
  const where = args[2] as Record<string, unknown>
  return seededCarts.find((row) => Object.entries(where).every(([key, value]) => row[key] === value)) ?? null
})

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { hashCartToken } from '../../lib/token'
import type { ResolvedCartRouteContext } from '../../lib/routeContext'
import type {
  CartCreateCommandInput,
  CartCreateResult,
  CartGetInput,
  CartGetResult,
} from '../cart'
import '../cart'

const TENANT_ID = 'tenant-cart-1'
const ORG_ID = 'org-cart-1'

let seededCarts: FakeCartRow[] = []

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

function makeEm() {
  let created: FakeCartRow | null = null
  const em: any = {
    fork: jest.fn(),
    create: jest.fn((_ctor: unknown, data: FakeCartRow) => {
      created = { id: 'generated-cart-id', ...data }
      return created
    }),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
  }
  em.fork.mockReturnValue(em)
  return { em, getCreated: () => created }
}

function makeDataEngine() {
  return {
    setCustomFields: jest.fn(async () => {}),
    markOrmEntityChange: jest.fn(),
    flushOrmEntityChanges: jest.fn(async () => {}),
  }
}

function makeCtx(opts: {
  em: unknown
  dataEngine: unknown
  rbacService?: unknown
  auth?: CommandRuntimeContext['auth']
  selectedOrganizationId?: string | null
}): CommandRuntimeContext {
  return {
    container: {
      resolve: (token: string): any => {
        if (token === 'em') return opts.em
        if (token === 'dataEngine') return opts.dataEngine
        if (token === 'rbacService') return opts.rbacService ?? null
        throw new Error(`Unexpected DI token: ${token}`)
      },
    } as any,
    auth: opts.auth ?? null,
    selectedOrganizationId: opts.selectedOrganizationId ?? null,
    organizationScope: null,
    organizationIds: null,
    request: undefined as any,
  }
}

function makeCartFixture(overrides: Partial<FakeCartRow> = {}): FakeCartRow {
  const now = new Date('2026-01-01T00:00:00.000Z')
  return {
    id: 'cart-1',
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    tokenHash: 'seeded-token-hash',
    storeId: 'store-1',
    channel: 'storefront',
    kind: 'basket',
    status: 'active',
    currencyCode: 'USD',
    locale: 'en-US',
    customerId: null,
    customerIds: [],
    customerUserId: null,
    customerGroupIds: [],
    priceKindId: null,
    taxMode: 'gross',
    email: null,
    note: null,
    buyerDigest: 'digest-1',
    assortmentScopeHash: null,
    totals: {
      subtotalNetAmount: 0,
      subtotalGrossAmount: 0,
      discountTotalAmount: 0,
      taxTotalAmount: 0,
      grandTotalNetAmount: 0,
      grandTotalGrossAmount: 0,
    },
    totalsComputedAt: now,
    promotionEffects: null,
    requiresApproval: false,
    approvalId: null,
    metadata: null,
    salesChannelId: null,
    lastActivityAt: now,
    lastPriceChangeAt: null,
    lockedAt: null,
    lockExpiresAt: null,
    checkoutSessionId: null,
    resolvedAt: null,
    expiresAt: new Date('2026-01-08T00:00:00.000Z'),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe('cart.create', () => {
  afterEach(() => {
    jest.clearAllMocks()
    seededCarts = []
  })

  it('storefront path produces an active, basket-kind cart with a real token whose hash matches the persisted tokenHash', async () => {
    const handler = commandRegistry.get<CartCreateCommandInput, CartCreateResult>('cart.create')
    expect(handler).toBeDefined()

    const { em, getCreated } = makeEm()
    const dataEngine = makeDataEngine()
    const ctx = makeCtx({ em, dataEngine })

    const result = await handler!.execute({ routeContext: makeRouteContext() }, ctx)

    expect(result.channel).toBe('storefront')
    expect(result.token).toBeTruthy()

    const created = getCreated()
    expect(created).not.toBeNull()
    expect(created!.status).toBe('active')
    expect(created!.kind).toBe('basket')
    expect(created!.channel).toBe('storefront')
    expect(created!.tokenHash).toBe(hashCartToken(result.token))
    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(dataEngine.markOrmEntityChange).toHaveBeenCalledTimes(1)
  })

  it('authenticated path with the matching feature succeeds for a non-storefront channel', async () => {
    const handler = commandRegistry.get<CartCreateCommandInput, CartCreateResult>('cart.create')
    const { em, getCreated } = makeEm()
    const dataEngine = makeDataEngine()
    const userHasAllFeatures = jest.fn(async () => true)
    const ctx = makeCtx({
      em,
      dataEngine,
      rbacService: { userHasAllFeatures },
      auth: { sub: 'staff-user-1', tenantId: TENANT_ID, orgId: ORG_ID },
      selectedOrganizationId: ORG_ID,
    })

    const result = await handler!.execute(
      {
        channel: 'pos',
        storeId: null,
        salesChannelId: null,
        currencyCode: 'USD',
        locale: 'en-US',
        taxMode: 'gross',
        customerId: null,
        customerUserId: null,
        email: null,
      },
      ctx,
    )

    expect(result.channel).toBe('pos')
    expect(userHasAllFeatures).toHaveBeenCalledWith('staff-user-1', ['cart.channel.pos'], {
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    })
    expect(getCreated()!.channel).toBe('pos')
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it('authenticated path without the matching feature is rejected and persists nothing', async () => {
    const handler = commandRegistry.get<CartCreateCommandInput, CartCreateResult>('cart.create')
    const { em, getCreated } = makeEm()
    const dataEngine = makeDataEngine()
    const userHasAllFeatures = jest.fn(async () => false)
    const ctx = makeCtx({
      em,
      dataEngine,
      rbacService: { userHasAllFeatures },
      auth: { sub: 'staff-user-1', tenantId: TENANT_ID, orgId: ORG_ID },
      selectedOrganizationId: ORG_ID,
    })

    let captured: unknown
    try {
      await handler!.execute(
        {
          channel: 'pos',
          storeId: null,
          salesChannelId: null,
          currencyCode: 'USD',
          locale: 'en-US',
          taxMode: 'gross',
          customerId: null,
          customerUserId: null,
          email: null,
        },
        ctx,
      )
    } catch (err) {
      captured = err
    }

    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as { status: number }).status).toBe(403)
    expect(getCreated()).toBeNull()
    expect(em.persist).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })
})

describe('cart.get', () => {
  afterEach(() => {
    jest.clearAllMocks()
    seededCarts = []
  })

  it('resolves a cart by id and by a re-hashed token identically', async () => {
    const handler = commandRegistry.get<CartGetInput, CartGetResult>('cart.get')
    const plaintextToken = 'plaintext-token-value'
    const cart = makeCartFixture({ tokenHash: hashCartToken(plaintextToken) })
    seededCarts = [cart]

    const { em } = makeEm()
    const dataEngine = makeDataEngine()
    const ctx = makeCtx({ em, dataEngine })

    const byId = await handler!.execute({ tenantId: TENANT_ID, organizationId: ORG_ID, cartId: cart.id as string }, ctx)
    const byToken = await handler!.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, token: plaintextToken },
      ctx,
    )

    expect(byId.found).toBe(true)
    expect(byToken.found).toBe(true)
    if (byId.found && byToken.found) {
      expect(byId.cart).toEqual(byToken.cart)
      expect(byId.cart.id).toBe(cart.id)
      expect((byId.cart as Record<string, unknown>).tokenHash).toBeUndefined()
    }
  })

  it('returns the identical uniform not-found result for a wrong tenant, a wrong token, and a nonexistent id', async () => {
    const handler = commandRegistry.get<CartGetInput, CartGetResult>('cart.get')
    const plaintextToken = 'plaintext-token-value-2'
    const cart = makeCartFixture({ id: 'cart-2', tokenHash: hashCartToken(plaintextToken) })
    seededCarts = [cart]

    const { em } = makeEm()
    const dataEngine = makeDataEngine()
    const ctx = makeCtx({ em, dataEngine })

    const wrongTenant = await handler!.execute(
      { tenantId: 'some-other-tenant', organizationId: ORG_ID, cartId: cart.id as string },
      ctx,
    )
    const wrongToken = await handler!.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, token: 'not-the-right-token' },
      ctx,
    )
    const nonexistentId = await handler!.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, cartId: 'does-not-exist' },
      ctx,
    )

    expect(wrongTenant).toEqual({ found: false })
    expect(wrongToken).toEqual({ found: false })
    expect(nonexistentId).toEqual({ found: false })
  })

  it('never resolves a proposal-kind cart through the basket-only lookup, by id or by token', async () => {
    const handler = commandRegistry.get<CartGetInput, CartGetResult>('cart.get')
    const plaintextToken = 'plaintext-token-value-3'
    const proposalCart = makeCartFixture({
      id: 'cart-proposal-1',
      kind: 'proposal',
      tokenHash: hashCartToken(plaintextToken),
    })
    seededCarts = [proposalCart]

    const { em } = makeEm()
    const dataEngine = makeDataEngine()
    const ctx = makeCtx({ em, dataEngine })

    const byId = await handler!.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, cartId: proposalCart.id as string },
      ctx,
    )
    const byToken = await handler!.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, token: plaintextToken },
      ctx,
    )

    expect(byId).toEqual({ found: false })
    expect(byToken).toEqual({ found: false })
  })
})
