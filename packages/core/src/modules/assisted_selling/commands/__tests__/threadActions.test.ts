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
import { AssistedSellingThread, AssistedSellingParticipant } from '../../data/entities'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { resolveEffectiveAssistedSellingSettings as mockedResolveSettings } from '../../lib/settings'
import { emitAssistedSellingEvent as mockedEmit } from '../../events'
import { joinThreadCommand, leaveThreadCommand, assignThreadCommand } from '../threads'

const resolveSettingsMock = mockedResolveSettings as jest.MockedFunction<typeof mockedResolveSettings>
const emitMock = mockedEmit as jest.MockedFunction<typeof mockedEmit>

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_ORG_ID = '99999999-9999-4999-8999-999999999999'
const STORE_ID = '33333333-3333-4333-8333-333333333333'
const THREAD_ID = '66666666-6666-4666-8666-666666666666'
const REP_USER_ID = '55555555-5555-4555-8555-555555555555'
const OTHER_REP_USER_ID = '77777777-7777-4777-8777-777777777777'

type Row = Record<string, any>

function classKeyFor(Cls: unknown): 'threads' | 'participants' | 'users' {
  if (Cls === AssistedSellingThread) return 'threads'
  if (Cls === AssistedSellingParticipant) return 'participants'
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

// Deliberately a SINGLE shared store across every `.fork()` call — `em.findOne` returns the
// SAME row object reference every time, so two "concurrent" command executions against the
// same thread id observe each other's writes exactly like two requests racing against one
// real row would. This is what makes the assign race test below real rather than simulated.
function makeFakeEm(seed: { threads?: Row[]; participants?: Row[]; users?: Row[] } = {}) {
  const stores: Record<string, Row[]> = {
    threads: seed.threads ? [...seed.threads] : [],
    participants: seed.participants ? [...seed.participants] : [],
    users: seed.users ? [...seed.users] : [],
  }
  const em: Row = {
    create: jest.fn((Cls: unknown, data: Row) => {
      const row = { ...data, __key: classKeyFor(Cls) }
      return row
    }),
    persist: jest.fn((entity: Row) => {
      const key = entity.__key
      const existingIndex = stores[key].findIndex((row) => row === entity || row.id === entity.id)
      if (existingIndex === -1) stores[key].push(entity)
      else stores[key][existingIndex] = entity
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

function makeCtx(options: {
  em: unknown
  rbac: ReturnType<typeof makeRbac> | null
  organizationIds: string[] | null
  tenantId?: string
  userId?: string
}): CommandRuntimeContext {
  const services: Record<string, unknown> = {
    em: options.em,
    rbacService: options.rbac,
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

function makeThreadRow(overrides: Partial<Row> = {}): Row {
  return {
    id: THREAD_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    storeId: STORE_ID,
    buyerCartId: 'cart-1',
    status: 'open',
    modeSnapshot: 'rep',
    assignedActorId: null,
    liveProposalCount: 0,
    lastActivityAt: new Date('2026-10-26T00:00:00.000Z'),
    updatedAt: new Date('2026-10-26T00:00:00.000Z'),
    createdAt: new Date('2026-10-26T00:00:00.000Z'),
    __key: 'threads',
    ...overrides,
  }
}

beforeEach(() => {
  resolveSettingsMock.mockClear()
  resolveSettingsMock.mockResolvedValue({
    mode: 'rep',
    proposalTtlSeconds: 259200,
    maxProposalLines: 50,
    conversationRetentionDays: 365,
    idleCloseDays: 30,
  })
  emitMock.mockClear()
})

describe('assisted_selling.thread.join', () => {
  test('adds a rep participant and emits .participant.joined (§6.1, §8.3)', async () => {
    const { em } = makeFakeEm({ threads: [makeThreadRow()], users: [{ id: REP_USER_ID, name: 'Rep One', email: 'rep@example.com' }] })
    const rbac = makeRbac(['assisted_selling.threads.participate'])
    const ctx = makeCtx({ em, rbac, organizationIds: [ORG_ID] })

    const result = await joinThreadCommand.execute({ tenantId: TENANT_ID, organizationIds: [ORG_ID], threadId: THREAD_ID }, ctx)

    expect(result.alreadyJoined).toBe(false)
    expect(emitMock).toHaveBeenCalledWith('assisted_selling.participant.joined', expect.objectContaining({ threadId: THREAD_ID }))
  })

  test('is idempotent — a second join by the same rep reports alreadyJoined, no second event', async () => {
    const { em } = makeFakeEm({ threads: [makeThreadRow()], users: [{ id: REP_USER_ID, name: 'Rep One', email: 'rep@example.com' }] })
    const rbac = makeRbac(['assisted_selling.threads.participate'])
    const ctx = makeCtx({ em, rbac, organizationIds: [ORG_ID] })

    await joinThreadCommand.execute({ tenantId: TENANT_ID, organizationIds: [ORG_ID], threadId: THREAD_ID }, ctx)
    emitMock.mockClear()
    const second = await joinThreadCommand.execute({ tenantId: TENANT_ID, organizationIds: [ORG_ID], threadId: THREAD_ID }, ctx)

    expect(second.alreadyJoined).toBe(true)
    expect(emitMock).not.toHaveBeenCalled()
  })

  test('rejoining after leaving re-emits .participant.joined (a left rep is not "already joined")', async () => {
    const { em } = makeFakeEm({ threads: [makeThreadRow()], users: [{ id: REP_USER_ID, name: 'Rep One', email: 'rep@example.com' }] })
    const rbac = makeRbac(['assisted_selling.threads.participate'])
    const ctx = makeCtx({ em, rbac, organizationIds: [ORG_ID] })

    await joinThreadCommand.execute({ tenantId: TENANT_ID, organizationIds: [ORG_ID], threadId: THREAD_ID }, ctx)
    await leaveThreadCommand.execute({ tenantId: TENANT_ID, organizationIds: [ORG_ID], threadId: THREAD_ID }, ctx)
    emitMock.mockClear()
    const rejoin = await joinThreadCommand.execute({ tenantId: TENANT_ID, organizationIds: [ORG_ID], threadId: THREAD_ID }, ctx)

    expect(rejoin.alreadyJoined).toBe(false)
    expect(emitMock).toHaveBeenCalledWith('assisted_selling.participant.joined', expect.objectContaining({ threadId: THREAD_ID }))
  })

  test('refuses with 409 assisted_selling_unavailable when the live mode is off', async () => {
    resolveSettingsMock.mockResolvedValueOnce({
      mode: 'off',
      proposalTtlSeconds: 259200,
      maxProposalLines: 50,
      conversationRetentionDays: 365,
      idleCloseDays: 30,
    })
    const { em } = makeFakeEm({ threads: [makeThreadRow()] })
    const rbac = makeRbac(['assisted_selling.threads.participate'])
    const ctx = makeCtx({ em, rbac, organizationIds: [ORG_ID] })

    const err = await joinThreadCommand.execute({ tenantId: TENANT_ID, organizationIds: [ORG_ID], threadId: THREAD_ID }, ctx).catch((e) => e)
    expect(isCrudHttpError(err)).toBe(true)
    expect(err.status).toBe(409)
    expect(err.body.code).toBe('assisted_selling_unavailable')
  })

  test('refuses a thread outside the caller\'s organizationIds with 404 (S9)', async () => {
    const { em } = makeFakeEm({ threads: [makeThreadRow()] })
    const rbac = makeRbac(['assisted_selling.*'])
    const ctx = makeCtx({ em, rbac, organizationIds: [OTHER_ORG_ID] })

    await expect(
      joinThreadCommand.execute({ tenantId: TENANT_ID, organizationIds: [OTHER_ORG_ID], threadId: THREAD_ID }, ctx),
    ).rejects.toMatchObject({ status: 404 })
  })

  test('refuses a principal missing the required feature (S21)', async () => {
    const { em } = makeFakeEm({ threads: [makeThreadRow()] })
    const rbac = makeRbac(['assisted_selling.threads.view'])
    const ctx = makeCtx({ em, rbac, organizationIds: [ORG_ID] })

    await expect(
      joinThreadCommand.execute({ tenantId: TENANT_ID, organizationIds: [ORG_ID], threadId: THREAD_ID }, ctx),
    ).rejects.toMatchObject({ status: 403 })
  })
})

describe('assisted_selling.thread.leave', () => {
  test('ends the caller\'s own rep participation and emits .participant.left', async () => {
    const { em } = makeFakeEm({ threads: [makeThreadRow()], users: [{ id: REP_USER_ID, name: 'Rep One', email: 'rep@example.com' }] })
    const rbac = makeRbac(['assisted_selling.threads.participate'])
    const ctx = makeCtx({ em, rbac, organizationIds: [ORG_ID] })
    await joinThreadCommand.execute({ tenantId: TENANT_ID, organizationIds: [ORG_ID], threadId: THREAD_ID }, ctx)
    emitMock.mockClear()

    const result = await leaveThreadCommand.execute({ tenantId: TENANT_ID, organizationIds: [ORG_ID], threadId: THREAD_ID }, ctx)

    expect(result.left).toBe(true)
    expect(emitMock).toHaveBeenCalledWith('assisted_selling.participant.left', expect.objectContaining({ threadId: THREAD_ID }))
  })

  test('is a no-op when the caller never joined — never a 404', async () => {
    const { em } = makeFakeEm({ threads: [makeThreadRow()] })
    const rbac = makeRbac(['assisted_selling.threads.participate'])
    const ctx = makeCtx({ em, rbac, organizationIds: [ORG_ID] })

    const result = await leaveThreadCommand.execute({ tenantId: TENANT_ID, organizationIds: [ORG_ID], threadId: THREAD_ID }, ctx)

    expect(result.left).toBe(false)
    expect(emitMock).not.toHaveBeenCalled()
  })
})

describe('assisted_selling.thread.assign', () => {
  test('assigns to the caller when actorId is omitted ("assign to me")', async () => {
    const { em } = makeFakeEm({ threads: [makeThreadRow()] })
    const rbac = makeRbac(['assisted_selling.threads.participate'])
    const ctx = makeCtx({ em, rbac, organizationIds: [ORG_ID] })

    const result = await assignThreadCommand.execute({ tenantId: TENANT_ID, organizationIds: [ORG_ID], threadId: THREAD_ID }, ctx)

    expect(result.assignedActorId).toBe(REP_USER_ID)
  })

  test('assigns to a named rep when actorId is given', async () => {
    const { em } = makeFakeEm({ threads: [makeThreadRow()] })
    const rbac = makeRbac(['assisted_selling.threads.participate'])
    const ctx = makeCtx({ em, rbac, organizationIds: [ORG_ID] })

    const result = await assignThreadCommand.execute(
      { tenantId: TENANT_ID, organizationIds: [ORG_ID], threadId: THREAD_ID, actorId: OTHER_REP_USER_ID },
      ctx,
    )

    expect(result.assignedActorId).toBe(OTHER_REP_USER_ID)
  })

  test('two concurrent assigns against the same stale updatedAt: one succeeds, one 409 (§6.1)', async () => {
    const thread = makeThreadRow()
    const { em } = makeFakeEm({ threads: [thread] })
    const rbac = makeRbac(['assisted_selling.threads.participate'])
    const staleUpdatedAt = thread.updatedAt.toISOString()
    const ctxOne = makeCtx({ em, rbac, organizationIds: [ORG_ID], userId: REP_USER_ID })
    const ctxTwo = makeCtx({ em, rbac, organizationIds: [ORG_ID], userId: OTHER_REP_USER_ID })

    const first = await assignThreadCommand.execute(
      { tenantId: TENANT_ID, organizationIds: [ORG_ID], threadId: THREAD_ID, updatedAt: staleUpdatedAt },
      ctxOne,
    )
    expect(first.assignedActorId).toBe(REP_USER_ID)

    const second = await assignThreadCommand
      .execute({ tenantId: TENANT_ID, organizationIds: [ORG_ID], threadId: THREAD_ID, updatedAt: staleUpdatedAt }, ctxTwo)
      .catch((e) => e)
    expect(isCrudHttpError(second)).toBe(true)
    expect(second.status).toBe(409)
    // The loser's write never lands — the winner's assignment stands.
    expect(thread.assignedActorId).toBe(REP_USER_ID)
  })

  test('refuses a thread outside the caller\'s organizationIds with 404 (S9)', async () => {
    const { em } = makeFakeEm({ threads: [makeThreadRow()] })
    const rbac = makeRbac(['assisted_selling.*'])
    const ctx = makeCtx({ em, rbac, organizationIds: [OTHER_ORG_ID] })

    await expect(
      assignThreadCommand.execute({ tenantId: TENANT_ID, organizationIds: [OTHER_ORG_ID], threadId: THREAD_ID }, ctx),
    ).rejects.toMatchObject({ status: 404 })
  })
})
