// Release 5, Step 3.5 (D-R5-19, C9, checkout §4.3/B.2). `checkout.session.create` with
// `{ source: 'link' }` — the merchant-initiated, cart-backed link entry point. Kept in its
// own file rather than extending `session.test.ts`: that file's `findOneWithDecryption`
// mock is entity-blind (searches `seededSessions` regardless of which entity is asked
// for), which this Step's new `CheckoutLink` lookup would silently miscompute against.
jest.mock('../../events', () => ({
  emitCheckoutEvent: jest.fn(async () => undefined),
}))

const mockGetCustomerAuthFromRequest = jest.fn()
jest.mock('@open-mercato/core/modules/customer_accounts/lib/customerAuth', () => ({
  getCustomerAuthFromRequest: (...args: unknown[]) => mockGetCustomerAuthFromRequest(...args),
}))

type FakeRow = Record<string, any>

function matchesWhere(row: FakeRow, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true
    return row[key] === value
  })
}

let seededLinks: FakeRow[] = []
let seededTemplateLines: FakeRow[] = []
let seededSessions: FakeRow[] = []
let seededEvents: FakeRow[] = []

import { CheckoutLink, CheckoutLinkCartTemplate, CheckoutSession, CheckoutSessionEvent } from '../../data/entities'

const mockFindOneWithDecryption = jest.fn(async (_em: unknown, entity: unknown, where: Record<string, unknown>) => {
  if (entity === CheckoutLink) return seededLinks.find((row) => matchesWhere(row, where)) ?? null
  if (entity === CheckoutSession) return seededSessions.find((row) => matchesWhere(row, where)) ?? null
  return null
})

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) =>
    mockFindOneWithDecryption(...(args as [unknown, unknown, Record<string, unknown>])),
}))

import { randomUUID } from 'crypto'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createSessionCommand, type CheckoutSessionCreateCommandInput } from '../session'

const TENANT_ID = 'tenant-link-seed-1'
const ORG_ID = 'org-link-seed-1'
const LINK_ID = 'link-1'

function makeLinkFixture(overrides: FakeRow = {}): FakeRow {
  return {
    id: LINK_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    slug: 'donate',
    status: 'active',
    checkoutType: 'simple_checkout',
    maxCompletions: null,
    completionCount: 0,
    activeReservationCount: 0,
    passwordHash: null,
    deletedAt: null,
    ...overrides,
  }
}

function makeTemplateLineFixture(overrides: FakeRow = {}): FakeRow {
  return {
    id: `template-line-${seededTemplateLines.length + 1}`,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    linkId: LINK_ID,
    productId: 'product-1',
    variantId: null,
    name: 'Widget',
    quantity: 1,
    unitPriceOverride: null,
    currencyCode: 'USD',
    sortOrder: 0,
    deletedAt: null,
    ...overrides,
  }
}

function backingArrayFor(entity: unknown): FakeRow[] {
  if (entity === CheckoutLinkCartTemplate) return seededTemplateLines
  if (entity === CheckoutSessionEvent) return seededEvents
  return seededSessions
}

function makeFakeEm() {
  const em: any = {
    find: jest.fn(async (entity: unknown, where: Record<string, unknown>) =>
      backingArrayFor(entity).filter((row) => matchesWhere(row, where))),
    create: jest.fn((_entity: unknown, data: FakeRow) => ({ id: randomUUID(), createdAt: new Date(), updatedAt: new Date(), ...data })),
    persist: jest.fn((row: FakeRow) => {
      if ('kind' in row && 'actor' in row) seededEvents.push(row)
      else seededSessions.push(row)
    }),
    flush: jest.fn(async () => undefined),
    nativeUpdate: jest.fn(async (entity: unknown, where: Record<string, unknown>, set: FakeRow) => {
      const matched = backingArrayFor(entity).filter((row) => matchesWhere(row, where))
      for (const row of matched) Object.assign(row, set)
      return matched.length
    }),
  }
  return em
}

function makeFakeCommandBus(overrides: { cartCreateResult?: FakeRow } = {}) {
  const calls: Array<{ id: string; input: unknown; ctx: CommandRuntimeContext }> = []
  const execute = jest.fn(async (id: string, options: { input: unknown; ctx: CommandRuntimeContext }) => {
    calls.push({ id, input: options.input, ctx: options.ctx })
    if (id === 'cart.create') {
      return { result: overrides.cartCreateResult ?? { cartId: 'seeded-cart-1' } }
    }
    if (id === 'cart.lines.add') {
      return { result: { status: 'added' } }
    }
    throw new Error(`Unexpected command id: ${id}`)
  })
  return { execute: execute as unknown, calls }
}

function makeCtx(em: unknown, opts: { commandBus?: unknown; storeContextService?: unknown } = {}): CommandRuntimeContext {
  return {
    container: {
      resolve: (token: string): any => {
        if (token === 'em') return em
        if (token === 'cartService') return {}
        if (token === 'commandBus') return opts.commandBus ?? makeFakeCommandBus()
        if (token === 'storeContextService') {
          if (opts.storeContextService !== undefined) return opts.storeContextService
          throw new Error('storeContextService is not registered')
        }
        throw new Error(`Unexpected DI token: ${token}`)
      },
      register: jest.fn(),
    } as any,
    auth: null,
    selectedOrganizationId: null,
    organizationScope: null,
    organizationIds: null,
    request: undefined as any,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  seededLinks = [makeLinkFixture()]
  seededTemplateLines = [makeTemplateLineFixture()]
  seededSessions = []
  seededEvents = []
})

describe('checkout.session.create { source: "link" } — B.2/D-R5-19', () => {
  it('seeds a pay_link cart from the template lines, through the trusted system context, and persists the session with linkId', async () => {
    const em = makeFakeEm()
    const bus = makeFakeCommandBus({ cartCreateResult: { cartId: 'cart-abc' } })
    const ctx = makeCtx(em, { commandBus: bus })
    const input: CheckoutSessionCreateCommandInput = { source: 'link', slug: 'donate' }

    const result = await createSessionCommand.execute(input, ctx)

    expect(result.session).toMatchObject({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      cartId: 'cart-abc',
      linkId: LINK_ID,
      storeId: null,
      channel: 'pay_link',
      currencyCode: 'USD',
      status: 'open',
    })

    const createCall = bus.calls.find((call) => call.id === 'cart.create')
    expect(createCall?.input).toMatchObject({ channel: 'pay_link', storeId: null, currencyCode: 'USD', tenantId: TENANT_ID })
    // Audited as system: no end-user actor, `systemActor` carries the trusted marker.
    expect(createCall?.ctx.auth).toBeNull()
    expect((createCall?.ctx as any).systemActor).toBe(true)

    const addLineCall = bus.calls.find((call) => call.id === 'cart.lines.add')
    expect(addLineCall?.input).toMatchObject({ cartId: 'cart-abc', productId: 'product-1', addedByActorType: 'system' })
    expect((addLineCall?.ctx as any).systemActor).toBe(true)
  })

  it('prices a template line with unitPriceOverride as a fixed gross amount, passed through unchanged', async () => {
    seededTemplateLines = [makeTemplateLineFixture({ unitPriceOverride: '49.00' })]
    const em = makeFakeEm()
    const bus = makeFakeCommandBus()
    const ctx = makeCtx(em, { commandBus: bus })

    await createSessionCommand.execute({ source: 'link', slug: 'donate' }, ctx)

    const addLineCall = bus.calls.find((call) => call.id === 'cart.lines.add')
    expect(addLineCall?.input).toMatchObject({
      unitPriceOverride: { amount: '49.00', basis: 'gross' },
    })
  })

  it('omits unitPriceOverride for a template line with none, so the buyer prices at their own catalog rate', async () => {
    const em = makeFakeEm()
    const bus = makeFakeCommandBus()
    const ctx = makeCtx(em, { commandBus: bus })

    await createSessionCommand.execute({ source: 'link', slug: 'donate' }, ctx)

    const addLineCall = bus.calls.find((call) => call.id === 'cart.lines.add')
    expect((addLineCall?.input as FakeRow).unitPriceOverride).toBeNull()
  })

  it('applies the buyer\'s resolved identity to cart.create when a matching customer session is present (D-R5-13)', async () => {
    mockGetCustomerAuthFromRequest.mockResolvedValue({ sub: 'customer-user-1', tenantId: TENANT_ID, orgId: ORG_ID })
    const resolveForBuyer = jest.fn(async () => ({
      customerId: 'company-1',
      customerIds: ['person-1', 'company-1'],
      customerUserId: 'customer-user-1',
      customerGroupIds: ['group-1'],
      priceKindId: 'price-kind-1',
      taxMode: 'net',
      currencyCode: null,
      buyerDigest: 'digest',
      storeId: null,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    }))
    const em = makeFakeEm()
    const bus = makeFakeCommandBus()
    const ctx = makeCtx(em, { commandBus: bus, storeContextService: { resolveForBuyer } })
    const request = new Request('https://merchant.example/pay/donate')

    const result = await createSessionCommand.execute({ source: 'link', slug: 'donate', request }, ctx)

    expect(resolveForBuyer).toHaveBeenCalledWith({ tenantId: TENANT_ID, organizationId: ORG_ID, customerUserId: 'customer-user-1' })
    const createCall = bus.calls.find((call) => call.id === 'cart.create')
    expect(createCall?.input).toMatchObject({ customerId: 'company-1', customerUserId: 'customer-user-1' })
    expect(result.session.customerId).toBe('company-1')
  })

  it('leaves the cart a guest cart when the customer session belongs to a different tenant/organization', async () => {
    mockGetCustomerAuthFromRequest.mockResolvedValue({ sub: 'customer-user-1', tenantId: 'other-tenant', orgId: 'other-org' })
    const resolveForBuyer = jest.fn()
    const em = makeFakeEm()
    const bus = makeFakeCommandBus()
    const ctx = makeCtx(em, { commandBus: bus, storeContextService: { resolveForBuyer } })
    const request = new Request('https://merchant.example/pay/donate')

    await createSessionCommand.execute({ source: 'link', slug: 'donate', request }, ctx)

    expect(resolveForBuyer).not.toHaveBeenCalled()
    const createCall = bus.calls.find((call) => call.id === 'cart.create')
    expect(createCall?.input).toMatchObject({ customerId: null, customerUserId: null })
  })

  it('never resolves a request-side store context for a link cart — X13, store_id is always null', async () => {
    const em = makeFakeEm()
    const bus = makeFakeCommandBus()
    // No `storeContextService` registered at all — a hard throw if the command ever
    // tried to resolve one for this cart's store comparison (it must not, per X13).
    const ctx = makeCtx(em, { commandBus: bus })

    const result = await createSessionCommand.execute({ source: 'link', slug: 'donate' }, ctx)

    expect(result.session.storeId).toBeNull()
  })

  it('404s for a checkoutType: "pay_link" link — Phase A links never pass through CheckoutSession (C10)', async () => {
    seededLinks = [makeLinkFixture({ checkoutType: 'pay_link' })]
    const em = makeFakeEm()
    const ctx = makeCtx(em)

    await expect(createSessionCommand.execute({ source: 'link', slug: 'donate' }, ctx)).rejects.toMatchObject({ status: 404 })
  })

  it('404s for an unknown slug', async () => {
    seededLinks = []
    const em = makeFakeEm()
    const ctx = makeCtx(em)

    await expect(createSessionCommand.execute({ source: 'link', slug: 'does-not-exist' }, ctx)).rejects.toMatchObject({ status: 404 })
  })

  it('404s for a non-active link (draft/inactive) — mirrors the GET /pay/[slug] not-found body', async () => {
    seededLinks = [makeLinkFixture({ status: 'inactive' })]
    const em = makeFakeEm()
    const ctx = makeCtx(em)

    await expect(createSessionCommand.execute({ source: 'link', slug: 'donate' }, ctx)).rejects.toMatchObject({ status: 404 })
  })

  it('422s when the usage limit is already reached', async () => {
    seededLinks = [makeLinkFixture({ maxCompletions: 5, completionCount: 5, activeReservationCount: 0 })]
    const em = makeFakeEm()
    const ctx = makeCtx(em)

    await expect(createSessionCommand.execute({ source: 'link', slug: 'donate' }, ctx)).rejects.toMatchObject({
      status: 422,
      body: expect.objectContaining({ code: 'checkout_link_unavailable' }),
    })
  })

  it('401s a password-protected link with no access cookie', async () => {
    seededLinks = [makeLinkFixture({ passwordHash: 'hashed' })]
    const em = makeFakeEm()
    const ctx = makeCtx(em)
    const request = new Request('https://merchant.example/pay/donate')

    await expect(createSessionCommand.execute({ source: 'link', slug: 'donate', request }, ctx)).rejects.toMatchObject({ status: 401 })
  })

  it('422s a simple_checkout link with no cart template lines configured', async () => {
    seededTemplateLines = []
    const em = makeFakeEm()
    const ctx = makeCtx(em)

    await expect(createSessionCommand.execute({ source: 'link', slug: 'donate' }, ctx)).rejects.toMatchObject({
      status: 422,
      body: expect.objectContaining({ code: 'checkout_link_cart_template_empty' }),
    })
  })
})
