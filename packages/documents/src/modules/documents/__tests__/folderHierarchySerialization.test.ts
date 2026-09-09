import type { EntityManager } from '@mikro-orm/postgresql'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import {
  acquireFolderHierarchyMutationLock,
  FOLDER_HIERARCHY_ADVISORY_LOCK_SQL,
  folderHierarchyMutationLockKey,
} from '../lib/folderHierarchySerialization'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_TENANT_ID = '22222222-2222-4222-8222-222222222222'
const ORGANIZATION_ID = '33333333-3333-4333-8333-333333333333'
const OTHER_ORGANIZATION_ID = '44444444-4444-4444-8444-444444444444'

type Deferred = {
  promise: Promise<void>
  resolve: () => void
}

function deferred(): Deferred {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

type LockWaiter = {
  owner: string
  resolve: () => void
}

class AdvisoryTransactionLockHarness {
  private readonly holders = new Map<string, string>()

  private readonly queues = new Map<string, LockWaiter[]>()

  private readonly contentionSignals = new Map<string, Array<() => void>>()

  async acquire(owner: string, key: string): Promise<void> {
    if (!this.holders.has(key)) {
      this.holders.set(key, owner)
      return
    }

    await new Promise<void>((resolve) => {
      const queue = this.queues.get(key) ?? []
      queue.push({ owner, resolve })
      this.queues.set(key, queue)
      for (const signal of this.contentionSignals.get(key) ?? []) signal()
      this.contentionSignals.delete(key)
    })
  }

  waitForContention(key: string): Promise<void> {
    if ((this.queues.get(key)?.length ?? 0) > 0) return Promise.resolve()
    return new Promise<void>((resolve) => {
      const signals = this.contentionSignals.get(key) ?? []
      signals.push(resolve)
      this.contentionSignals.set(key, signals)
    })
  }

  release(owner: string): void {
    for (const [key, holder] of Array.from(this.holders.entries())) {
      if (holder !== owner) continue
      const queue = this.queues.get(key) ?? []
      const next = queue.shift()
      if (!next) {
        this.holders.delete(key)
        this.queues.delete(key)
        continue
      }
      this.holders.set(key, next.owner)
      if (queue.length > 0) this.queues.set(key, queue)
      else this.queues.delete(key)
      next.resolve()
    }
  }
}

function fakeTransactionalEntityManager(
  owner: string,
  locks: AdvisoryTransactionLockHarness,
): EntityManager {
  let inTransaction = false
  return {
    begin: jest.fn(async () => { inTransaction = true }),
    flush: jest.fn(async () => undefined),
    commit: jest.fn(async () => {
      locks.release(owner)
      inTransaction = false
    }),
    rollback: jest.fn(async () => {
      locks.release(owner)
      inTransaction = false
    }),
    isInTransaction: jest.fn(() => inTransaction),
    execute: jest.fn(async (sql: string, params: unknown[]) => {
      expect(inTransaction).toBe(true)
      expect(sql).toBe(FOLDER_HIERARCHY_ADVISORY_LOCK_SQL)
      await locks.acquire(owner, String(params[0]))
      return []
    }),
  } as unknown as EntityManager
}

async function runHierarchyMutation(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  mutation: () => Promise<void>,
): Promise<void> {
  await withAtomicFlush(em, [async () => {
    await acquireFolderHierarchyMutationLock(em, scope)
    await mutation()
  }], { transaction: true, label: 'documents.folder.serialization.test' })
}

describe('folder hierarchy transaction serialization', () => {
  it('uses the EntityManager raw query API that carries the active transaction context', async () => {
    const execute = jest.fn(async () => [])
    const connectionExecute = jest.fn(async () => [])
    const getConnection = jest.fn(() => ({ execute: connectionExecute }))
    const em = {
      execute,
      getConnection,
      isInTransaction: jest.fn(() => true),
    } as unknown as EntityManager
    const scope = { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID }

    await acquireFolderHierarchyMutationLock(em, scope)

    expect(execute).toHaveBeenCalledWith(
      FOLDER_HIERARCHY_ADVISORY_LOCK_SQL,
      [folderHierarchyMutationLockKey(scope)],
    )
    expect(getConnection).not.toHaveBeenCalled()
    expect(connectionExecute).not.toHaveBeenCalled()
  })

  it('fails closed before executing SQL when no transaction is active', async () => {
    const execute = jest.fn(async () => [])
    const em = {
      execute,
      isInTransaction: jest.fn(() => false),
    } as unknown as EntityManager

    await expect(acquireFolderHierarchyMutationLock(em, {
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
    })).rejects.toThrow('Folder hierarchy mutation lock requires an active transaction')
    expect(execute).not.toHaveBeenCalled()
  })

  it('blocks a disjoint concurrent hierarchy mutation in the same tenant and organization', async () => {
    const locks = new AdvisoryTransactionLockHarness()
    const firstEm = fakeTransactionalEntityManager('first', locks)
    const secondEm = fakeTransactionalEntityManager('second', locks)
    const scope = { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID }
    const firstEntered = deferred()
    const releaseFirst = deferred()
    const order: string[] = []

    const first = runHierarchyMutation(firstEm, scope, async () => {
      order.push('first')
      firstEntered.resolve()
      await releaseFirst.promise
    })
    await firstEntered.promise

    let secondEntered = false
    const second = runHierarchyMutation(secondEm, scope, async () => {
      secondEntered = true
      order.push('second')
    })
    await locks.waitForContention(folderHierarchyMutationLockKey(scope))

    expect(secondEntered).toBe(false)
    expect(order).toEqual(['first'])

    releaseFirst.resolve()
    await Promise.all([first, second])
    expect(order).toEqual(['first', 'second'])
  })

  it('does not serialize hierarchy mutations from different tenant or organization scopes', async () => {
    const locks = new AdvisoryTransactionLockHarness()
    const firstEm = fakeTransactionalEntityManager('first', locks)
    const otherOrganizationEm = fakeTransactionalEntityManager('other-organization', locks)
    const otherTenantEm = fakeTransactionalEntityManager('other-tenant', locks)
    const firstScope = { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID }
    const firstEntered = deferred()
    const releaseFirst = deferred()
    const independentScopes: string[] = []

    const first = runHierarchyMutation(firstEm, firstScope, async () => {
      firstEntered.resolve()
      await releaseFirst.promise
    })
    await firstEntered.promise

    await runHierarchyMutation(
      otherOrganizationEm,
      { tenantId: TENANT_ID, organizationId: OTHER_ORGANIZATION_ID },
      async () => { independentScopes.push('organization') },
    )
    await runHierarchyMutation(
      otherTenantEm,
      { tenantId: OTHER_TENANT_ID, organizationId: ORGANIZATION_ID },
      async () => { independentScopes.push('tenant') },
    )

    expect(independentScopes).toEqual(['organization', 'tenant'])
    expect(folderHierarchyMutationLockKey(firstScope)).not.toBe(folderHierarchyMutationLockKey({
      tenantId: TENANT_ID,
      organizationId: OTHER_ORGANIZATION_ID,
    }))
    expect(folderHierarchyMutationLockKey(firstScope)).not.toBe(folderHierarchyMutationLockKey({
      tenantId: OTHER_TENANT_ID,
      organizationId: ORGANIZATION_ID,
    }))

    releaseFirst.resolve()
    await first
  })
})
