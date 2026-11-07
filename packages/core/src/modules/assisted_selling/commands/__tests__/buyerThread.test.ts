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
import { resolveEffectiveAssistedSellingSettings as mockedResolveSettings } from '../../lib/settings'
import { openThreadAsBuyerCommand, postMessageAsBuyerCommand } from '../buyerThread'

const resolveSettingsMock = mockedResolveSettings as jest.MockedFunction<typeof mockedResolveSettings>

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const STORE_ID = '33333333-3333-4333-8333-333333333333'
const CART_ID = '44444444-4444-4444-8444-444444444444'
const CUSTOMER_USER_ID = '66666666-6666-4666-8666-666666666666'

type Row = Record<string, any>

function classKeyFor(Cls: unknown): 'threads' | 'participants' | 'messages' {
  if (Cls === AssistedSellingThread) return 'threads'
  if (Cls === AssistedSellingParticipant) return 'participants'
  if (Cls === AssistedSellingMessage) return 'messages'
  throw new Error(`unexpected entity class in fake em: ${String(Cls)}`)
}

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true
    return (row[key] ?? null) === (value ?? null)
  })
}

function makeFakeEm(seed: { threads?: Row[] } = {}) {
  const stores: Record<string, Row[]> = {
    threads: seed.threads ? [...seed.threads] : [],
    participants: [],
    messages: [],
  }
  const em: Row = {
    create: jest.fn((Cls: unknown, data: Row) => ({ ...data, __key: classKeyFor(Cls) })),
    persist: jest.fn((entity: Row) => {
      const key = entity.__key ?? classKeyFor(AssistedSellingThread)
      const list = stores[key]
      if (!list.includes(entity)) list.push(entity)
    }),
    flush: jest.fn(async () => undefined),
    findOne: jest.fn(async (Cls: unknown, where: Row) => {
      const key = classKeyFor(Cls)
      return stores[key].find((row) => matches(row, where)) ?? null
    }),
    begin: jest.fn(async () => undefined),
    commit: jest.fn(async () => undefined),
    rollback: jest.fn(async () => undefined),
    isInTransaction: jest.fn(() => false),
  }
  em.fork = jest.fn(() => em)
  return { em, stores }
}

function makeCtx(em: unknown): CommandRuntimeContext {
  const services: Record<string, unknown> = { em }
  return {
    container: { resolve: (name: string) => services[name] },
    // §6.2: the buyer command context carries NO staff principal — trust comes from the
    // already-resolved basket on the input, never from `ctx.auth`.
    auth: null,
    selectedOrganizationId: ORG_ID,
    organizationIds: null,
    organizationScope: null,
    request: undefined,
  } as unknown as CommandRuntimeContext
}

describe('assisted_selling.thread.openAsBuyer (§6.2)', () => {
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

  test('opens a new thread with a buyer participant (not a staff-authored shape)', async () => {
    const { em, stores } = makeFakeEm()
    const ctx = makeCtx(em)

    const result = await openThreadAsBuyerCommand.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, storeId: STORE_ID, buyerCartId: CART_ID, customerId: null, customerUserId: null },
      ctx,
    )

    expect(result.alreadyOpen).toBe(false)
    expect(result.status).toBe('open')
    expect(stores.threads).toHaveLength(1)
    expect(stores.threads[0].buyerCartId).toBe(CART_ID)
    expect(stores.participants).toHaveLength(1)
    expect(stores.participants[0].actorType).toBe('buyer')
    expect(stores.participants[0].actorId).toBeNull()
  })

  test('an identified buyer gets a participant actorId = their customerUserId', async () => {
    const { em, stores } = makeFakeEm()
    const ctx = makeCtx(em)

    await openThreadAsBuyerCommand.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, storeId: STORE_ID, buyerCartId: CART_ID, customerId: null, customerUserId: CUSTOMER_USER_ID },
      ctx,
    )

    expect(stores.participants[0].actorId).toBe(CUSTOMER_USER_ID)
  })

  test('returns the existing open thread with alreadyOpen: true and creates nothing', async () => {
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
    const { em, stores } = makeFakeEm({ threads: [existingThread] })
    const ctx = makeCtx(em)

    const result = await openThreadAsBuyerCommand.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, storeId: STORE_ID, buyerCartId: CART_ID, customerId: null, customerUserId: null },
      ctx,
    )

    expect(result.alreadyOpen).toBe(true)
    expect(result.threadId).toBe('existing-thread-id')
    expect(stores.threads).toHaveLength(1)
    expect(stores.participants).toHaveLength(0)
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
    const ctx = makeCtx(em)

    const err = await openThreadAsBuyerCommand
      .execute({ tenantId: TENANT_ID, organizationId: ORG_ID, storeId: STORE_ID, buyerCartId: CART_ID, customerId: null, customerUserId: null }, ctx)
      .catch((e) => e)

    expect(isCrudHttpError(err)).toBe(true)
    expect(err.status).toBe(409)
    expect(err.body.code).toBe('assisted_selling_unavailable')
  })

  test('a different tenant\'s identical buyerCartId never matches (tenant isolation)', async () => {
    const otherTenantThread = {
      id: 'other-tenant-thread',
      tenantId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
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
    const { em, stores } = makeFakeEm({ threads: [otherTenantThread] })
    const ctx = makeCtx(em)

    const result = await openThreadAsBuyerCommand.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, storeId: STORE_ID, buyerCartId: CART_ID, customerId: null, customerUserId: null },
      ctx,
    )

    expect(result.alreadyOpen).toBe(false)
    expect(stores.threads).toHaveLength(2)
  })
})

describe('assisted_selling.message.postAsBuyer (§6.2)', () => {
  const openThread = {
    id: 'thread-1',
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    storeId: STORE_ID,
    buyerCartId: CART_ID,
    status: 'open',
    modeSnapshot: 'rep',
    liveProposalCount: 0,
    lastActivityAt: new Date('2026-01-01T00:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    __key: 'threads',
  }

  test('posts a buyer message against the open thread, authored by a buyer participant', async () => {
    const { em, stores } = makeFakeEm({ threads: [{ ...openThread }] })
    const ctx = makeCtx(em)

    const result = await postMessageAsBuyerCommand.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, buyerCartId: CART_ID, customerUserId: null, body: 'hello there' },
      ctx,
    )

    expect(result.threadId).toBe('thread-1')
    expect(stores.messages).toHaveLength(1)
    expect(stores.messages[0].body).toBe('hello there')
    expect(stores.messages[0].bodyFormat).toBe('text')
    expect(stores.participants).toHaveLength(1)
    expect(stores.participants[0].actorType).toBe('buyer')
    expect(stores.messages[0].participantId).toBe(stores.participants[0].id)
  })

  test('404s when the basket has no open thread', async () => {
    const { em } = makeFakeEm()
    const ctx = makeCtx(em)

    const err = await postMessageAsBuyerCommand
      .execute({ tenantId: TENANT_ID, organizationId: ORG_ID, buyerCartId: CART_ID, customerUserId: null, body: 'hello' }, ctx)
      .catch((e) => e)

    expect(isCrudHttpError(err)).toBe(true)
    expect(err.status).toBe(404)
  })

  test('tenant isolation: a thread in another tenant with the same buyerCartId is never found', async () => {
    const { em } = makeFakeEm({ threads: [{ ...openThread, tenantId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', __key: 'threads' }] })
    const ctx = makeCtx(em)

    const err = await postMessageAsBuyerCommand
      .execute({ tenantId: TENANT_ID, organizationId: ORG_ID, buyerCartId: CART_ID, customerUserId: null, body: 'hello' }, ctx)
      .catch((e) => e)

    expect(isCrudHttpError(err)).toBe(true)
    expect(err.status).toBe(404)
  })
})
