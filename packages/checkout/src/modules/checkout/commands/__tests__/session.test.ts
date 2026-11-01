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
    if (value && typeof value === 'object' && !Array.isArray(value) && '$in' in (value as object)) {
      return ((value as { $in: unknown[] }).$in).includes(row[key])
    }
    return row[key] === value
  })
}

let seededSessions: FakeRow[] = []
let cartPeerRow: FakeRow | undefined

const mockFindOneWithDecryption = jest.fn(async (_em: unknown, _entity: unknown, where: Record<string, unknown>) => {
  return seededSessions.find((row) => matchesWhere(row, where)) ?? null
})

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) =>
    mockFindOneWithDecryption(...(args as [unknown, unknown, Record<string, unknown>])),
}))

jest.mock('@open-mercato/shared/lib/crud/optimistic-lock-command', () => ({
  enforceCommandOptimisticLockWithGuards: jest.fn(async () => undefined),
}))

import { randomUUID } from 'crypto'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CheckoutSession, CheckoutSessionEvent } from '../../data/entities'
import { hashCheckoutSessionToken } from '../../lib/sessionToken'
import {
  createSessionCommand,
  updateSessionCommand,
  type CheckoutSessionCreateCommandInput,
  type CheckoutSessionUpdateCommandInput,
} from '../session'

const TENANT_ID = 'tenant-session-cmd-1'
const ORG_ID = 'org-session-cmd-1'
const CART_TOKEN = 'plain-cart-token'
let seededEvents: FakeRow[] = []

function makeCartPeerRow(overrides: FakeRow = {}): FakeRow {
  return {
    id: 'cart-1',
    tenant_id: TENANT_ID,
    organization_id: ORG_ID,
    store_id: null,
    channel: 'storefront',
    kind: 'basket',
    status: 'active',
    currency_code: 'USD',
    locale: 'en-US',
    customer_id: null,
    customer_user_id: null,
    ...overrides,
  }
}

function backingArrayFor(entity: unknown): FakeRow[] {
  return entity === CheckoutSessionEvent ? seededEvents : seededSessions
}

function makeFakeEm() {
  const em: any = {
    find: jest.fn(async (entity: unknown, where: Record<string, unknown>) =>
      backingArrayFor(entity).filter((row) => matchesWhere(row, where))),
    findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) =>
      backingArrayFor(entity).find((row) => matchesWhere(row, where)) ?? null),
    create: jest.fn((_entity: unknown, data: FakeRow) => {
      const row: FakeRow = {
        id: randomUUID(),
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      }
      return row
    }),
    persist: jest.fn((row: FakeRow, entity: unknown = CheckoutSession) => {
      // `em.create` is called with the real entity class but its RETURN VALUE (a plain
      // object) is what `em.persist` receives — infer which backing array from the row's
      // own shape (`kind`/`payload`/`actor` only exist on an event row) rather than from a
      // second argument `persist` never actually takes, matching the real MikroORM API.
      if ('kind' in row && 'actor' in row) seededEvents.push(row)
      else seededSessions.push(row)
    }),
    flush: jest.fn(async () => undefined),
    nativeUpdate: jest.fn(async (entity: unknown, where: Record<string, unknown>, set: FakeRow) => {
      const matched = backingArrayFor(entity).filter((row) => matchesWhere(row, where))
      for (const row of matched) Object.assign(row, set)
      return matched.length
    }),
    getKysely: jest.fn(() => ({
      selectFrom: () => ({
        select: () => ({
          where: () => ({
            executeTakeFirst: async () => cartPeerRow,
          }),
        }),
      }),
    })),
  }
  return em
}

function makeCtx(
  em: unknown,
  opts: {
    cartServiceAvailable?: boolean
    storeContextService?: unknown
    commandBus?: unknown
    request?: Request
  } = {},
): CommandRuntimeContext {
  const cartServiceAvailable = opts.cartServiceAvailable ?? true
  return {
    container: {
      resolve: (token: string): any => {
        if (token === 'em') return em
        if (token === 'cartService') {
          if (!cartServiceAvailable) throw new Error('cartService is not registered')
          return {}
        }
        if (token === 'storeContextService') {
          if (opts.storeContextService !== undefined) return opts.storeContextService
          throw new Error('storeContextService is not registered')
        }
        if (token === 'commandBus') {
          if (opts.commandBus !== undefined) return opts.commandBus
          throw new Error('commandBus is not registered')
        }
        throw new Error(`Unexpected DI token: ${token}`)
      },
      register: jest.fn(),
    } as any,
    auth: null,
    selectedOrganizationId: null,
    organizationScope: null,
    organizationIds: null,
    request: opts.request as any,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  seededSessions = []
  seededEvents = []
  cartPeerRow = makeCartPeerRow()
})

describe('checkout.session.create (B.1)', () => {
  it('answers 503 checkout_sessions_unavailable when cart is absent (C10/D-R5-18) — never a 500', async () => {
    const em = makeFakeEm()
    const ctx = makeCtx(em, { cartServiceAvailable: false })
    const input: CheckoutSessionCreateCommandInput = { source: 'cart', cartToken: CART_TOKEN }

    await expect(createSessionCommand.execute(input, ctx)).rejects.toMatchObject({
      status: 503,
      body: expect.objectContaining({ code: 'checkout_sessions_unavailable' }),
    })
  })

  it('answers 404 when the cart token does not resolve a basket', async () => {
    cartPeerRow = undefined
    const em = makeFakeEm()
    const ctx = makeCtx(em)
    const input: CheckoutSessionCreateCommandInput = { source: 'cart', cartToken: CART_TOKEN }

    await expect(createSessionCommand.execute(input, ctx)).rejects.toMatchObject({ status: 404 })
  })

  it('answers 409 cart_not_active when the cart is not active', async () => {
    cartPeerRow = makeCartPeerRow({ status: 'locked' })
    const em = makeFakeEm()
    const ctx = makeCtx(em)
    const input: CheckoutSessionCreateCommandInput = { source: 'cart', cartToken: CART_TOKEN }

    await expect(createSessionCommand.execute(input, ctx)).rejects.toMatchObject({
      status: 409,
      body: expect.objectContaining({ code: 'cart_not_active' }),
    })
  })

  it('refuses an identified cart without the matching customer session (D-R5-21 pattern at creation)', async () => {
    cartPeerRow = makeCartPeerRow({ customer_user_id: 'customer-user-owner' })
    mockGetCustomerAuthFromRequest.mockResolvedValue(null)
    const em = makeFakeEm()
    const ctx = makeCtx(em)
    const input: CheckoutSessionCreateCommandInput = {
      source: 'cart',
      cartToken: CART_TOKEN,
      request: new Request('https://example.com'),
    }

    await expect(createSessionCommand.execute(input, ctx)).rejects.toMatchObject({ status: 404 })
  })

  it('stores only the token HASH — never the plaintext — and returns the plaintext exactly once', async () => {
    const em = makeFakeEm()
    const ctx = makeCtx(em)
    const input: CheckoutSessionCreateCommandInput = { source: 'cart', cartToken: CART_TOKEN }

    const result = await createSessionCommand.execute(input, ctx)

    expect(typeof result.token).toBe('string')
    expect(result.token.length).toBeGreaterThan(20)
    expect(result.session.tokenHash).toBe(hashCheckoutSessionToken(result.token))
    expect(result.session.tokenHash).not.toBe(result.token)
    expect(JSON.stringify(result.session)).not.toContain(result.token)
    expect(seededSessions).toHaveLength(1)
    expect(seededSessions[0].tokenHash).toBe(result.session.tokenHash)
    expect(seededSessions[0]).not.toHaveProperty('token')
  })

  it('copies the cart scope and identity onto the new session', async () => {
    cartPeerRow = makeCartPeerRow({ customer_id: 'customer-1', customer_user_id: null, store_id: 'store-1' })
    const em = makeFakeEm()
    // Release 5, Step 3.5 (C9) — a non-null `cart.storeId` now requires a resolvable
    // store context; the resolved store matches the cart's own, so this stays a pass.
    const resolve = jest.fn(async () => ({ store: { id: 'store-1' } }))
    const ctx = makeCtx(em, { storeContextService: { resolve } })
    const input: CheckoutSessionCreateCommandInput = {
      source: 'cart',
      cartToken: CART_TOKEN,
      request: new Request('https://merchant.example'),
    }

    const result = await createSessionCommand.execute(input, ctx)

    expect(result.session).toMatchObject({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      cartId: 'cart-1',
      storeId: 'store-1',
      channel: 'storefront',
      currencyCode: 'USD',
      locale: 'en-US',
      customerId: 'customer-1',
      customerUserId: null,
      status: 'open',
      step: 'contact',
    })
  })

  it('supersedes (cancels) an earlier open session on the same cart — "one live session per cart" (§9.0)', async () => {
    seededSessions = [{
      id: 'session-old',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      cartId: 'cart-1',
      status: 'open',
      tokenHash: 'old-hash',
      createdAt: new Date(),
      updatedAt: new Date(),
    }]
    const em = makeFakeEm()
    const ctx = makeCtx(em)
    const input: CheckoutSessionCreateCommandInput = { source: 'cart', cartToken: CART_TOKEN }

    await createSessionCommand.execute(input, ctx)

    const old = seededSessions.find((row) => row.id === 'session-old')
    expect(old?.status).toBe('canceled')
  })

  it('refuses a new session (409 submit_in_progress) when an earlier session on the cart is already submitting', async () => {
    seededSessions = [{
      id: 'session-old',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      cartId: 'cart-1',
      status: 'submitting',
      tokenHash: 'old-hash',
      createdAt: new Date(),
      updatedAt: new Date(),
    }]
    const em = makeFakeEm()
    const ctx = makeCtx(em)
    const input: CheckoutSessionCreateCommandInput = { source: 'cart', cartToken: CART_TOKEN }

    await expect(createSessionCommand.execute(input, ctx)).rejects.toMatchObject({
      status: 409,
      body: expect.objectContaining({ code: 'submit_in_progress' }),
    })
    // Nothing new was created once the in-flight guard tripped.
    expect(seededSessions).toHaveLength(1)
  })
})

describe('checkout.session.update (§9 PATCH /sessions/current)', () => {
  function seedOpenSession(overrides: FakeRow = {}): FakeRow {
    const row: FakeRow = {
      id: 'session-1',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      status: 'open',
      email: null,
      phone: null,
      shippingAddress: null,
      billingSameAsShipping: false,
      updatedAt: new Date(),
      ...overrides,
    }
    seededSessions.push(row)
    return row
  }

  it('answers 404 when the session does not exist', async () => {
    const em = makeFakeEm()
    const ctx = makeCtx(em)
    const input: CheckoutSessionUpdateCommandInput = {
      sessionId: 'missing',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      patch: { email: 'buyer@example.com' },
    }

    await expect(updateSessionCommand.execute(input, ctx)).rejects.toMatchObject({ status: 404 })
  })

  it('answers 409 session_not_open when the session is not open', async () => {
    seedOpenSession({ status: 'submitting' })
    const em = makeFakeEm()
    const ctx = makeCtx(em)
    const input: CheckoutSessionUpdateCommandInput = {
      sessionId: 'session-1',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      patch: { email: 'buyer@example.com' },
    }

    await expect(updateSessionCommand.execute(input, ctx)).rejects.toMatchObject({
      status: 409,
      body: expect.objectContaining({ code: 'session_not_open' }),
    })
  })

  it('applies the patch and records only the changed field NAMES in the session event, never values', async () => {
    seedOpenSession()
    const em = makeFakeEm()
    const ctx = makeCtx(em)
    const input: CheckoutSessionUpdateCommandInput = {
      sessionId: 'session-1',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      patch: { email: 'buyer@example.com', phone: '+1-555-0100' },
    }

    const result = await updateSessionCommand.execute(input, ctx)

    expect(result.session.email).toBe('buyer@example.com')
    expect(result.session.phone).toBe('+1-555-0100')

    const eventRows = seededEvents.filter((row) => row.kind === 'field_updated')
    expect(eventRows).toHaveLength(1)
    expect(eventRows[0].payload).toEqual({ changedKeys: ['email', 'phone'] })
    expect(JSON.stringify(eventRows[0].payload)).not.toContain('buyer@example.com')
  })
})
