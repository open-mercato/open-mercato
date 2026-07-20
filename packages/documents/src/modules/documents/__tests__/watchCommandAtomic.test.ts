import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { DocumentWatcher } from '../data/entities'
import { DOCUMENTS_MAX_ACTIVE_WATCHERS } from '../lib/watchers'

const mockFindOneWithDecryption = jest.fn()
const mockFindWithDecryption = jest.fn()
const mockLockDocumentAggregateRoot = jest.fn()
const mockAssertDocumentCommandCapability = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))

jest.mock('../commands/aggregate', () => ({
  lockDocumentAggregateRoot: (...args: unknown[]) => mockLockDocumentAggregateRoot(...args),
}))

jest.mock('../commands/shared', () => {
  const actual = jest.requireActual('../commands/shared')
  return {
    ...actual,
    assertDocumentCommandCapability: (...args: unknown[]) => mockAssertDocumentCommandCapability(...args),
  }
})

import { createWatchCommand } from '../commands/watchers'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const documentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const actorUserId = '33333333-3333-4333-8333-333333333333'
const secondActorUserId = '99999999-9999-4999-8999-999999999999'
const watcherId = '44444444-4444-4444-8444-444444444444'
const secondWatcherId = '55555555-5555-4555-8555-555555555555'

function watchInput(overrides: Partial<Record<string, string>> = {}) {
  return {
    tenantId,
    organizationId,
    documentId,
    watcherId,
    actorUserId,
    ...overrides,
  }
}

function makeWatcher(deletedAt: Date | null): DocumentWatcher {
  return Object.assign(new DocumentWatcher(), {
    id: watcherId,
    documentId,
    userId: actorUserId,
    tenantId,
    organizationId,
    deletedAt,
  })
}

/**
 * Models the parent row's pessimistic write lock: a second subscription cannot
 * count active watchers until the holding transaction commits or rolls back.
 */
function createAggregateRowLock() {
  const waiters: Array<() => void> = []
  let held = false
  return {
    async acquire(): Promise<void> {
      if (!held) {
        held = true
        return
      }
      await new Promise<void>((resolve) => {
        waiters.push(resolve)
      })
    },
    release(): void {
      const next = waiters.shift()
      if (next) next()
      else held = false
    },
  }
}

function buildHarness(subjectUserId: string = actorUserId) {
  const order: string[] = []
  const em = {
    fork: jest.fn(() => em),
    begin: jest.fn(async () => { order.push('begin') }),
    flush: jest.fn(async () => { order.push('flush') }),
    commit: jest.fn(async () => { order.push('commit') }),
    rollback: jest.fn(async () => { order.push('rollback') }),
    create: jest.fn((entity: unknown, data: Record<string, unknown>) => {
      if (entity !== DocumentWatcher) throw new Error('Unexpected entity')
      order.push('create')
      return Object.assign(new DocumentWatcher(), data)
    }),
    persist: jest.fn(() => { order.push('persist') }),
  } as unknown as EntityManager
  const ctx: CommandRuntimeContext = {
    container: {
      resolve: (token: string) => {
        if (token === 'em') return em
        throw new Error(`Unexpected dependency: ${token}`)
      },
    } as CommandRuntimeContext['container'],
    auth: {
      sub: subjectUserId,
      userId: subjectUserId,
      tenantId,
      orgId: organizationId,
      features: ['documents.view'],
    } as CommandRuntimeContext['auth'],
    organizationScope: null,
    selectedOrganizationId: organizationId,
    organizationIds: [organizationId],
    request: new Request('http://localhost/api/documents/watch'),
  }
  return { ctx, em, order }
}

describe('documents.watch.create subscription cap', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockLockDocumentAggregateRoot.mockImplementation(async () => {
      return { id: documentId, tenantId, organizationId }
    })
    mockAssertDocumentCommandCapability.mockResolvedValue(['documents.view'])
    mockFindOneWithDecryption.mockResolvedValue(null)
    mockFindWithDecryption.mockResolvedValue([])
  })

  it('is idempotent for an already active subscription', async () => {
    const harness = buildHarness()
    mockFindOneWithDecryption.mockResolvedValue(makeWatcher(null))

    await expect(createWatchCommand.execute(watchInput(), harness.ctx)).resolves.toEqual({
      id: watcherId,
      active: true,
      changed: false,
    })

    expect(mockFindWithDecryption).not.toHaveBeenCalled()
    expect(harness.em.persist).not.toHaveBeenCalled()
    expect(harness.em.create).not.toHaveBeenCalled()
  })

  it('revives a soft-deleted subscription instead of inserting a duplicate row', async () => {
    const harness = buildHarness()
    const revived = makeWatcher(new Date('2026-07-10T12:00:00.000Z'))
    mockFindOneWithDecryption.mockResolvedValue(revived)

    await expect(createWatchCommand.execute(watchInput(), harness.ctx)).resolves.toEqual({
      id: watcherId,
      active: true,
      changed: true,
    })

    expect(revived.deletedAt).toBeNull()
    expect(harness.em.create).not.toHaveBeenCalled()
    expect(harness.em.persist).not.toHaveBeenCalled()
  })

  it('rejects a new subscription once the cap is reached', async () => {
    const harness = buildHarness()
    mockFindWithDecryption.mockResolvedValue(
      Array.from({ length: DOCUMENTS_MAX_ACTIVE_WATCHERS }, (_, index) => ({ id: `watcher-${index}` })),
    )

    await expect(createWatchCommand.execute(watchInput(), harness.ctx)).rejects.toMatchObject({
      status: 422,
      body: { error: 'documents.errors.watcherLimitReached' },
    })

    expect(harness.em.persist).not.toHaveBeenCalled()
  })

  it('counts active watchers with a fully scoped, bounded query taken under the parent lock', async () => {
    const harness = buildHarness()

    await createWatchCommand.execute(watchInput(), harness.ctx)

    expect(mockLockDocumentAggregateRoot).toHaveBeenCalledWith(
      harness.em,
      documentId,
      { tenantId, organizationId },
    )
    expect(mockFindWithDecryption).toHaveBeenCalledWith(
      harness.em,
      DocumentWatcher,
      { documentId, tenantId, organizationId, deletedAt: null },
      { fields: ['id'], limit: DOCUMENTS_MAX_ACTIVE_WATCHERS },
      { tenantId, organizationId },
    )
    expect(mockLockDocumentAggregateRoot.mock.invocationCallOrder[0])
      .toBeLessThan(mockFindWithDecryption.mock.invocationCallOrder[0])
  })

  it('refuses to subscribe on behalf of another user', async () => {
    const harness = buildHarness()

    await expect(
      createWatchCommand.execute(watchInput({ actorUserId: secondActorUserId }), harness.ctx),
    ).rejects.toMatchObject({ status: 403 })

    expect(harness.em.persist).not.toHaveBeenCalled()
  })

  it('admits only one of two concurrent subscriptions that both start one below the cap', async () => {
    const first = buildHarness(actorUserId)
    const second = buildHarness(secondActorUserId)
    const lock = createAggregateRowLock()
    let activeCount = DOCUMENTS_MAX_ACTIVE_WATCHERS - 1

    for (const harness of [first, second]) {
      ;(harness.em.commit as jest.Mock).mockImplementation(async () => { lock.release() })
      ;(harness.em.rollback as jest.Mock).mockImplementation(async () => { lock.release() })
      ;(harness.em.persist as jest.Mock).mockImplementation(() => { activeCount += 1 })
    }
    mockLockDocumentAggregateRoot.mockImplementation(async () => {
      await lock.acquire()
      return { id: documentId, tenantId, organizationId }
    })
    mockFindWithDecryption.mockImplementation(async () => (
      Array.from({ length: activeCount }, (_, index) => ({ id: `watcher-${index}` }))
    ))

    const settled = await Promise.allSettled([
      createWatchCommand.execute(watchInput(), first.ctx),
      createWatchCommand.execute(
        watchInput({ watcherId: secondWatcherId, actorUserId: secondActorUserId }),
        second.ctx,
      ),
    ])

    expect(settled.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    const rejections = settled.filter(
      (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
    )
    expect(rejections).toHaveLength(1)
    expect(rejections[0].reason).toMatchObject({
      status: 422,
      body: { error: 'documents.errors.watcherLimitReached' },
    })
    expect(activeCount).toBe(DOCUMENTS_MAX_ACTIVE_WATCHERS)
  })
})
