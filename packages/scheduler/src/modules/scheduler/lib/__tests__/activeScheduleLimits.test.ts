import type { EntityManager } from '@mikro-orm/core'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (key: string, _fallback?: string, params?: Record<string, unknown>) => `translated:${key}:max=${params?.max}`,
  }),
}))

import { activeScheduleLockKey, withTenantActiveScheduleSlot } from '../activeScheduleLimits'

const limitError = {
  status: 422,
  body: { error: 'translated:scheduler.error.active_schedule_limit:max=2' },
}

type FakeDatabase = {
  committedActive: number
  lockQueues: Map<string, Promise<void>>
  events: string[]
}

function createDatabase(committedActive: number): FakeDatabase {
  return { committedActive, lockQueues: new Map(), events: [] }
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function createSessionEm(db: FakeDatabase, name: string) {
  let inTransaction = false
  let pendingActivations = 0
  let releaseLock: (() => void) | null = null

  const finish = () => {
    inTransaction = false
    pendingActivations = 0
    const release = releaseLock
    releaseLock = null
    release?.()
  }

  const em = {
    isInTransaction: jest.fn(() => inTransaction),
    begin: jest.fn(async () => {
      inTransaction = true
      db.events.push(`${name}:begin`)
    }),
    commit: jest.fn(async () => {
      db.committedActive += pendingActivations
      db.events.push(`${name}:commit`)
      finish()
    }),
    rollback: jest.fn(async () => {
      db.events.push(`${name}:rollback`)
      finish()
    }),
    getTransactionContext: jest.fn(() => (inTransaction ? { name } : undefined)),
    getConnection: jest.fn(() => ({
      execute: jest.fn(async (_sql: string, params: unknown[]) => {
        const key = String(params[0])
        const previous = db.lockQueues.get(key) ?? Promise.resolve()
        const held = new Promise<void>((resolve) => {
          releaseLock = resolve
        })
        db.lockQueues.set(key, previous.then(() => held))
        await previous
        db.events.push(`${name}:locked`)
        return []
      }),
    })),
    count: jest.fn(async () => {
      await nextTick()
      db.events.push(`${name}:count=${db.committedActive}`)
      return db.committedActive
    }),
    flush: jest.fn(async () => {
      await nextTick()
    }),
    activate: () => {
      pendingActivations += 1
    },
  }
  return em
}

function asEntityManager(em: ReturnType<typeof createSessionEm>): EntityManager {
  return em as unknown as EntityManager
}

describe('withTenantActiveScheduleSlot', () => {
  const originalLimit = process.env.OM_SCHEDULER_MAX_ACTIVE_SCHEDULES_PER_TENANT

  beforeEach(() => {
    process.env.OM_SCHEDULER_MAX_ACTIVE_SCHEDULES_PER_TENANT = '2'
  })

  afterEach(() => {
    if (originalLimit === undefined) delete process.env.OM_SCHEDULER_MAX_ACTIVE_SCHEDULES_PER_TENANT
    else process.env.OM_SCHEDULER_MAX_ACTIVE_SCHEDULES_PER_TENANT = originalLimit
  })

  it('locks the tenant inside the transaction before counting, then writes and commits', async () => {
    const db = createDatabase(1)
    const em = createSessionEm(db, 'a')

    await withTenantActiveScheduleSlot(asEntityManager(em), 'tenant-a', true, () => em.activate())

    const execute = em.getConnection.mock.results[0]?.value.execute as jest.Mock
    expect(execute).toHaveBeenCalledWith(
      'select pg_advisory_xact_lock(hashtextextended(?, 0))',
      ['scheduler:active-schedules:tenant-a'],
      'all',
      { name: 'a' },
    )
    expect(db.events).toEqual(['a:begin', 'a:locked', 'a:count=1', 'a:commit'])
    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(db.committedActive).toBe(2)
  })

  it('rolls back without writing when the tenant is at the cap', async () => {
    const db = createDatabase(2)
    const em = createSessionEm(db, 'a')
    const write = jest.fn(() => em.activate())

    await expect(
      withTenantActiveScheduleSlot(asEntityManager(em), 'tenant-a', true, write),
    ).rejects.toMatchObject(limitError)

    expect(write).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
    expect(em.commit).not.toHaveBeenCalled()
    expect(db.events).toEqual(['a:begin', 'a:locked', 'a:count=2', 'a:rollback'])
    expect(db.committedActive).toBe(2)
  })

  it('lets exactly one of two concurrent activations take the last free slot', async () => {
    const db = createDatabase(1)
    const first = createSessionEm(db, 'a')
    const second = createSessionEm(db, 'b')

    const results = await Promise.allSettled([
      withTenantActiveScheduleSlot(asEntityManager(first), 'tenant-a', true, () => first.activate()),
      withTenantActiveScheduleSlot(asEntityManager(second), 'tenant-a', true, () => second.activate()),
    ])

    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected'])
    expect((results[1] as PromiseRejectedResult).reason).toMatchObject(limitError)
    expect(db.committedActive).toBe(2)
    expect(db.events).toEqual([
      'a:begin',
      'b:begin',
      'a:locked',
      'a:count=1',
      'a:commit',
      'b:locked',
      'b:count=2',
      'b:rollback',
    ])
  })

  it('does not serialize activations of different tenants', async () => {
    const db = createDatabase(0)
    const first = createSessionEm(db, 'a')
    const second = createSessionEm(db, 'b')

    await Promise.all([
      withTenantActiveScheduleSlot(asEntityManager(first), 'tenant-a', true, () => first.activate()),
      withTenantActiveScheduleSlot(asEntityManager(second), 'tenant-b', true, () => second.activate()),
    ])

    expect(db.events.indexOf('b:locked')).toBeLessThan(db.events.indexOf('a:commit'))
    expect(activeScheduleLockKey('tenant-a')).not.toBe(activeScheduleLockKey('tenant-b'))
  })

  it('joins an outer transaction without opening or committing its own', async () => {
    const db = createDatabase(0)
    const em = createSessionEm(db, 'a')
    await em.begin()

    await withTenantActiveScheduleSlot(asEntityManager(em), 'tenant-a', true, () => em.activate())

    expect(em.begin).toHaveBeenCalledTimes(1)
    expect(em.commit).not.toHaveBeenCalled()
    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(db.events).toEqual(['a:begin', 'a:locked', 'a:count=0'])
  })

  it.each([
    ['the write does not activate a schedule', 'tenant-a', false],
    ['the schedule is system-scoped', null, true],
  ])('writes and flushes without a lock or count when %s', async (_label, tenantId, activates) => {
    const db = createDatabase(5)
    const em = createSessionEm(db, 'a')
    const write = jest.fn(() => 'written')

    await expect(
      withTenantActiveScheduleSlot(asEntityManager(em), tenantId, activates, write),
    ).resolves.toBe('written')

    expect(write).toHaveBeenCalledTimes(1)
    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(em.begin).not.toHaveBeenCalled()
    expect(em.getConnection).not.toHaveBeenCalled()
    expect(em.count).not.toHaveBeenCalled()
  })
})
