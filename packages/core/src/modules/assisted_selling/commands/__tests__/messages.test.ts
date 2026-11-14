jest.mock('../../events', () => ({ emitAssistedSellingEvent: jest.fn(async () => undefined) }))

import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { AssistedSellingThread, AssistedSellingParticipant, AssistedSellingMessage } from '../../data/entities'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { emitAssistedSellingEvent as mockedEmit } from '../../events'
import { postMessageCommand } from '../messages'

const emitMock = mockedEmit as jest.MockedFunction<typeof mockedEmit>

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_ORG_ID = '99999999-9999-4999-8999-999999999999'
const THREAD_ID = '66666666-6666-4666-8666-666666666666'
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
  const services: Record<string, unknown> = { em: options.em, rbacService: options.rbac }
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
    storeId: 'store-1',
    buyerCartId: 'cart-1',
    status: 'open',
    modeSnapshot: 'rep',
    liveProposalCount: 0,
    lastActivityAt: new Date('2026-10-26T00:00:00.000Z'),
    updatedAt: new Date('2026-10-26T00:00:00.000Z'),
    createdAt: new Date('2026-10-26T00:00:00.000Z'),
    __key: 'threads',
    ...overrides,
  }
}

beforeEach(() => {
  emitMock.mockClear()
})

describe('assisted_selling.message.post', () => {
  test('posts a plain-text message authored by the caller, bumping thread activity (§6.1)', async () => {
    const { em, stores } = makeFakeEm({ threads: [makeThreadRow()], users: [{ id: REP_USER_ID, name: 'Rep One', email: 'rep@example.com' }] })
    const rbac = makeRbac(['assisted_selling.messages.post'])
    const ctx = makeCtx({ em, rbac, organizationIds: [ORG_ID] })

    const result = await postMessageCommand.execute({ tenantId: TENANT_ID, organizationIds: [ORG_ID], threadId: THREAD_ID, body: 'Hello there' }, ctx)

    expect(stores.messages).toHaveLength(1)
    expect(stores.messages[0].body).toBe('Hello there')
    expect(stores.messages[0].bodyFormat).toBe('text')
    expect(result.messageId).toBe(stores.messages[0].id)
    expect(emitMock).toHaveBeenCalledWith('assisted_selling.message.posted', expect.objectContaining({ threadId: THREAD_ID, messageId: result.messageId }))
  })

  test('refuses a thread outside the caller\'s organizationIds with 404 (S9)', async () => {
    const { em } = makeFakeEm({ threads: [makeThreadRow()] })
    const rbac = makeRbac(['assisted_selling.*'])
    const ctx = makeCtx({ em, rbac, organizationIds: [OTHER_ORG_ID] })

    await expect(
      postMessageCommand.execute({ tenantId: TENANT_ID, organizationIds: [OTHER_ORG_ID], threadId: THREAD_ID, body: 'Hi' }, ctx),
    ).rejects.toMatchObject({ status: 404 })
  })

  test('refuses a principal missing assisted_selling.messages.post (S21)', async () => {
    const { em } = makeFakeEm({ threads: [makeThreadRow()] })
    const rbac = makeRbac(['assisted_selling.threads.view'])
    const ctx = makeCtx({ em, rbac, organizationIds: [ORG_ID] })

    await expect(
      postMessageCommand.execute({ tenantId: TENANT_ID, organizationIds: [ORG_ID], threadId: THREAD_ID, body: 'Hi' }, ctx),
    ).rejects.toMatchObject({ status: 403 })
  })

  test('a wildcard ACL grant (assisted_selling.*) still permits posting (S21)', async () => {
    const { em } = makeFakeEm({ threads: [makeThreadRow()], users: [{ id: REP_USER_ID, name: 'Rep One', email: 'rep@example.com' }] })
    const rbac = makeRbac(['assisted_selling.*'])
    const ctx = makeCtx({ em, rbac, organizationIds: [ORG_ID] })

    const result = await postMessageCommand.execute({ tenantId: TENANT_ID, organizationIds: [ORG_ID], threadId: THREAD_ID, body: 'Hi' }, ctx)
    expect(result.threadId).toBe(THREAD_ID)
  })

  test('refuses a cross-tenant input before touching the thread (tenant isolation)', async () => {
    const { em } = makeFakeEm({ threads: [makeThreadRow()] })
    const rbac = makeRbac(['assisted_selling.*'])
    const ctx = makeCtx({ em, rbac, organizationIds: [ORG_ID], tenantId: TENANT_ID })

    await expect(
      postMessageCommand.execute({ tenantId: OTHER_ORG_ID, organizationIds: [ORG_ID], threadId: THREAD_ID, body: 'Hi' }, ctx),
    ).rejects.toMatchObject({ status: 403 })
    expect(em.findOne).not.toHaveBeenCalled()
  })

  test('isCrudHttpError helper confirms the 404 is a structured CrudHttpError, not a generic throw', async () => {
    const { em } = makeFakeEm()
    const rbac = makeRbac(['assisted_selling.*'])
    const ctx = makeCtx({ em, rbac, organizationIds: [ORG_ID] })

    const err = await postMessageCommand
      .execute({ tenantId: TENANT_ID, organizationIds: [ORG_ID], threadId: THREAD_ID, body: 'Hi' }, ctx)
      .catch((e) => e)
    expect(isCrudHttpError(err)).toBe(true)
  })
})
