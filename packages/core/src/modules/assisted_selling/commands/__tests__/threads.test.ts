jest.mock('../../events', () => ({ emitAssistedSellingEvent: jest.fn(async () => undefined) }))
jest.mock('../../lib/settings', () => ({
  resolveEffectiveAssistedSellingSettings: jest.fn(async () => ({
    mode: 'rep',
    proposalTtlSeconds: 259200,
    maxProposalLines: 50,
    conversationRetentionDays: 365,
    idleCloseDays: 30,
  })),
}))

import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { AssistedSellingThread, AssistedSellingParticipant, AssistedSellingMessage } from '../../data/entities'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { resolveEffectiveAssistedSellingSettings as mockedResolveSettings } from '../../lib/settings'
import { openThreadCommand } from '../threads'

const resolveSettingsMock = mockedResolveSettings as jest.MockedFunction<typeof mockedResolveSettings>

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_ORG_ID = '99999999-9999-4999-8999-999999999999'
const STORE_ID = '33333333-3333-4333-8333-333333333333'
const CART_ID = '44444444-4444-4444-8444-444444444444'
const REP_USER_ID = '55555555-5555-4555-8555-555555555555'

type Row = Record<string, any>

function classKeyFor(Cls: unknown): 'threads' | 'participants' | 'messages' | 'users' {
  if (Cls === AssistedSellingThread) return 'threads'
  if (Cls === AssistedSellingParticipant) return 'participants'
  if (Cls === AssistedSellingMessage) return 'messages'
  if (Cls === User) return 'users'
  throw new Error(`unexpected entity class in fake em: ${String(Cls)}`)
}

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true
    if (value && typeof value === 'object' && !(value instanceof Date) && '$in' in value) {
      return (value as { $in: unknown[] }).$in.includes(row[key])
    }
    return (row[key] ?? null) === (value ?? null)
  })
}

function makeFakeEm(seed: { threads?: Row[]; users?: Row[] } = {}) {
  const stores: Record<string, Row[]> = {
    threads: seed.threads ? [...seed.threads] : [],
    participants: [],
    messages: [],
    users: seed.users ? [...seed.users] : [],
  }
  const em: Row = {
    create: jest.fn((Cls: unknown, data: Row) => ({ ...data, __key: classKeyFor(Cls) })),
    persist: jest.fn((entity: Row) => {
      stores[entity.__key].push(entity)
    }),
    flush: jest.fn(async () => undefined),
    findOne: jest.fn(async (Cls: unknown, where: Row) => {
      const key = classKeyFor(Cls)
      return stores[key].find((row) => matches(row, where)) ?? null
    }),
    // `withAtomicFlush({ transaction: true })` (`commands/threads.ts`) drives these directly.
    begin: jest.fn(async () => undefined),
    commit: jest.fn(async () => undefined),
    rollback: jest.fn(async () => undefined),
    isInTransaction: jest.fn(() => false),
  }
  em.fork = jest.fn(() => em)
  return { em, stores }
}

function makeRbac(grantedFeatures: string[]) {
  return {
    userHasAllFeatures: jest.fn(async (_userId: string, required: string[]) =>
      required.every((feature) =>
        grantedFeatures.some((granted) => {
          if (granted === '*' || granted === feature) return true
          if (granted.endsWith('.*')) return feature.startsWith(granted.slice(0, -1))
          return false
        }),
      ),
    ),
  }
}

function makeCartService(cart: Row | null) {
  return {
    getForOrganizations: jest.fn(async (input: { organizationIds: string[] | null; cartId: string }) => {
      if (!cart || cart.id !== input.cartId) return null
      // S9: the real `cartService.getForOrganizations` scopes the read to the caller's
      // organizationIds list — this fake applies the SAME restriction rather than trusting
      // the caller, so a cross-organization test actually exercises the scoping guarantee.
      if (Array.isArray(input.organizationIds) && !input.organizationIds.includes(cart.organizationId)) return null
      return cart
    }),
    getProposalCartLines: jest.fn(async () => []),
  }
}

function makeCtx(options: {
  em: unknown
  rbac: ReturnType<typeof makeRbac> | null
  cartService: ReturnType<typeof makeCartService>
  organizationIds: string[] | null
  tenantId?: string
  userId?: string
}): CommandRuntimeContext {
  const services: Record<string, unknown> = {
    em: options.em,
    rbacService: options.rbac,
    cartService: options.cartService,
  }
  return {
    container: { resolve: (name: string) => services[name] },
    auth: { sub: options.userId ?? REP_USER_ID, tenantId: options.tenantId ?? TENANT_ID, orgId: ORG_ID },
    selectedOrganizationId: ORG_ID,
    organizationIds: options.organizationIds,
    organizationScope: null,
    request: undefined,
  } as unknown as CommandRuntimeContext
}

describe('assisted_selling.thread.open', () => {
  beforeEach(() => {
    resolveSettingsMock.mockClear()
    resolveSettingsMock.mockResolvedValue({
      mode: 'rep',
      proposalTtlSeconds: 259200,
      maxProposalLines: 50,
      conversationRetentionDays: 365,
      idleCloseDays: 30,
    })
  })

  const activeCart = {
    id: CART_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    storeId: STORE_ID,
    status: 'active',
    customerId: null,
    customerUserId: null,
  }

  test('opens a thread scoped to the caller\'s organizationIds (S9)', async () => {
    const { em } = makeFakeEm({ users: [{ id: REP_USER_ID, name: 'Rep One', email: 'rep@example.com' }] })
    const rbac = makeRbac(['assisted_selling.threads.participate'])
    const cartService = makeCartService(activeCart)
    const ctx = makeCtx({ em, rbac, cartService, organizationIds: [ORG_ID] })

    const result = await openThreadCommand.execute(
      { tenantId: TENANT_ID, organizationIds: [ORG_ID], cartId: CART_ID, message: 'Hi there' },
      ctx,
    )

    expect(result.organizationId).toBe(ORG_ID)
    expect(result.buyerCartId).toBe(CART_ID)
    expect(result.status).toBe('open')
    expect(result.modeSnapshot).toBe('rep')
    expect(cartService.getForOrganizations).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      organizationIds: [ORG_ID],
      cartId: CART_ID,
    })
  })

  test('refuses a cart outside the caller\'s organizationIds — a cross-organization open answers 404, not a different organization\'s thread (S9)', async () => {
    const { em } = makeFakeEm()
    const rbac = makeRbac(['assisted_selling.threads.participate'])
    const cartService = makeCartService(activeCart)
    // The caller's own scope only covers a DIFFERENT organization than the cart's.
    const ctx = makeCtx({ em, rbac, cartService, organizationIds: [OTHER_ORG_ID] })

    await expect(
      openThreadCommand.execute({ tenantId: TENANT_ID, organizationIds: [OTHER_ORG_ID], cartId: CART_ID }, ctx),
    ).rejects.toMatchObject({ status: 404 })
  })

  test('a wildcard ACL grant (assisted_selling.*) still permits opening a thread (S21)', async () => {
    const { em } = makeFakeEm({ users: [{ id: REP_USER_ID, name: 'Rep One', email: 'rep@example.com' }] })
    const rbac = makeRbac(['assisted_selling.*'])
    const cartService = makeCartService(activeCart)
    const ctx = makeCtx({ em, rbac, cartService, organizationIds: [ORG_ID] })

    const result = await openThreadCommand.execute({ tenantId: TENANT_ID, organizationIds: [ORG_ID], cartId: CART_ID }, ctx)
    expect(result.status).toBe('open')
  })

  test('refuses a principal missing the required feature — never a plain array .includes bypass (S21)', async () => {
    const { em } = makeFakeEm()
    const rbac = makeRbac(['assisted_selling.threads.view'])
    const cartService = makeCartService(activeCart)
    const ctx = makeCtx({ em, rbac, cartService, organizationIds: [ORG_ID] })

    await expect(
      openThreadCommand.execute({ tenantId: TENANT_ID, organizationIds: [ORG_ID], cartId: CART_ID }, ctx),
    ).rejects.toMatchObject({ status: 403 })
  })

  test('refuses a cross-tenant input before touching the cart service (tenant isolation)', async () => {
    const { em } = makeFakeEm()
    const rbac = makeRbac(['assisted_selling.*'])
    const cartService = makeCartService(activeCart)
    const ctx = makeCtx({ em, rbac, cartService, organizationIds: [ORG_ID], tenantId: TENANT_ID })

    await expect(
      openThreadCommand.execute({ tenantId: OTHER_ORG_ID, organizationIds: [ORG_ID], cartId: CART_ID }, ctx),
    ).rejects.toMatchObject({ status: 403 })
    expect(cartService.getForOrganizations).not.toHaveBeenCalled()
  })

  test('refuses a non-active cart with 409 cart_not_active', async () => {
    const { em } = makeFakeEm()
    const rbac = makeRbac(['assisted_selling.*'])
    const cartService = makeCartService({ ...activeCart, status: 'abandoned' })
    const ctx = makeCtx({ em, rbac, cartService, organizationIds: [ORG_ID] })

    await expect(
      openThreadCommand.execute({ tenantId: TENANT_ID, organizationIds: [ORG_ID], cartId: CART_ID }, ctx),
    ).rejects.toMatchObject({ status: 409, body: expect.objectContaining({ code: 'cart_not_active' }) })
  })

  test('refuses with 409 assisted_selling_unavailable when the live mode is off', async () => {
    resolveSettingsMock.mockResolvedValueOnce({
      mode: 'off',
      proposalTtlSeconds: 259200,
      maxProposalLines: 50,
      conversationRetentionDays: 365,
      idleCloseDays: 30,
    })
    const { em } = makeFakeEm()
    const rbac = makeRbac(['assisted_selling.*'])
    const cartService = makeCartService(activeCart)
    const ctx = makeCtx({ em, rbac, cartService, organizationIds: [ORG_ID] })

    const err = await openThreadCommand.execute({ tenantId: TENANT_ID, organizationIds: [ORG_ID], cartId: CART_ID }, ctx).catch((e) => e)
    expect(isCrudHttpError(err)).toBe(true)
    expect(err.status).toBe(409)
    expect(err.body.code).toBe('assisted_selling_unavailable')
  })

  test('refuses with 409 thread_already_open when the basket already has an open thread', async () => {
    const existingThread = {
      id: 'existing-thread-id',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      storeId: STORE_ID,
      buyerCartId: CART_ID,
      status: 'open',
      modeSnapshot: 'rep',
      liveProposalCount: 0,
      lastActivityAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      __key: 'threads',
    }
    const { em } = makeFakeEm({ threads: [existingThread] })
    const rbac = makeRbac(['assisted_selling.*'])
    const cartService = makeCartService(activeCart)
    const ctx = makeCtx({ em, rbac, cartService, organizationIds: [ORG_ID] })

    const err = await openThreadCommand.execute({ tenantId: TENANT_ID, organizationIds: [ORG_ID], cartId: CART_ID }, ctx).catch((e) => e)
    expect(isCrudHttpError(err)).toBe(true)
    expect(err.status).toBe(409)
    expect(err.body.code).toBe('thread_already_open')
    expect(err.body.threadId).toBe('existing-thread-id')
  })
})
