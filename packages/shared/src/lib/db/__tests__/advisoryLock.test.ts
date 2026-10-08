import type { EntityManager } from '@mikro-orm/postgresql'
import {
  AdvisoryLockUnavailableError,
  isTransientLockDbError,
  withAdvisoryXactLock,
  type AdvisoryLockWaitResult,
} from '../advisoryLock'
import { isTransientLockDbError as pgErrorsTransientLockDbError } from '../pg-errors'

type AdvisoryLockModule = typeof import('../advisoryLock')

const GLOBAL_SLOTS_KEY = '__openMercatoAdvisoryLockSlots__'
const LOCK_SQL = 'select pg_try_advisory_xact_lock(hashtextextended(?, 0)) as locked'
const LOCK_FORK_OPTIONS = { disableContextResolution: true, clear: true, useContext: false, cloneEventManager: true }

type TransactionFaults = {
  begin?: unknown
  lock?: unknown
  commit?: unknown
}

type LockQuery = { sql: string; params: unknown[]; at: number }

type FakeDatabase = {
  em: EntityManager
  fork: jest.Mock
  transactional: jest.Mock
  heldKeys: Set<string>
  lockQueries: LockQuery[]
  outcomes: Array<'commit' | 'rollback'>
  transactionEms: EntityManager[]
  queueFaults: (faults: TransactionFaults) => void
  openTransactions: () => number
}

function createFakeDatabase(): FakeDatabase {
  const heldKeys = new Set<string>()
  const lockQueries: LockQuery[] = []
  const outcomes: Array<'commit' | 'rollback'> = []
  const transactionEms: EntityManager[] = []
  const pendingFaults: TransactionFaults[] = []
  let open = 0

  const transactional = jest.fn(async (callback: (txEm: EntityManager) => Promise<unknown>) => {
    const faults = pendingFaults.shift() ?? {}
    if (faults.begin !== undefined) throw faults.begin
    open += 1
    const ownedKeys: string[] = []
    const finish = (outcome: 'commit' | 'rollback') => {
      for (const ownedKey of ownedKeys) heldKeys.delete(ownedKey)
      open -= 1
      outcomes.push(outcome)
    }
    const txEm = {
      execute: async (sql: string, params: unknown[]) => {
        lockQueries.push({ sql, params, at: Date.now() })
        if (faults.lock !== undefined) throw faults.lock
        const lockKey = String(params[0])
        if (heldKeys.has(lockKey)) return [{ locked: false }]
        heldKeys.add(lockKey)
        ownedKeys.push(lockKey)
        return [{ locked: true }]
      },
    } as unknown as EntityManager
    transactionEms.push(txEm)
    let result: unknown
    try {
      result = await callback(txEm)
    } catch (error) {
      finish('rollback')
      throw error
    }
    if (faults.commit !== undefined) {
      finish('rollback')
      throw faults.commit
    }
    finish('commit')
    return result
  })
  const lockEm = { transactional }
  const fork = jest.fn(() => lockEm)

  return {
    em: { fork } as unknown as EntityManager,
    fork,
    transactional,
    heldKeys,
    lockQueries,
    outcomes,
    transactionEms,
    queueFaults: (faults) => {
      pendingFaults.push(faults)
    },
    openTransactions: () => open,
  }
}

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

type Settled<T> = { value?: T; error?: unknown; settledAt: number }

function track<T>(promise: Promise<T>): { result: () => Settled<T> | null; done: Promise<Settled<T>> } {
  let settled: Settled<T> | null = null
  const done = promise.then(
    (value) => {
      settled = { value, settledAt: Date.now() }
      return settled
    },
    (error: unknown) => {
      settled = { error, settledAt: Date.now() }
      return settled
    },
  )
  return { result: () => settled, done }
}

let namespaceCounter = 0

function freshNamespace(): string {
  namespaceCounter += 1
  return `lock_case_${namespaceCounter}`
}

function loadIsolatedAdvisoryLockModule(): AdvisoryLockModule {
  let loaded: AdvisoryLockModule | undefined
  jest.isolateModules(() => {
    loaded = jest.requireActual<AdvisoryLockModule>('../advisoryLock')
  })
  if (!loaded) throw new Error('[internal] advisoryLock module did not load')
  return loaded
}

describe('withAdvisoryXactLock', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: 1_000_000 })
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('forks the request EntityManager with the detached options and runs the lock query and fn on the transaction', async () => {
    const db = createFakeDatabase()
    const key = `${freshNamespace()}:tenant:org`
    const fn = jest.fn(async (txEm: EntityManager) => {
      expect(txEm).toBe(db.transactionEms[0])
      expect(db.heldKeys.has(key)).toBe(true)
      return 'value'
    })

    await expect(withAdvisoryXactLock(db.em, key, fn)).resolves.toBe('value')

    expect(db.fork).toHaveBeenCalledTimes(1)
    expect(db.fork.mock.calls[0]).toStrictEqual([LOCK_FORK_OPTIONS])
    expect(db.lockQueries).toEqual([{ sql: LOCK_SQL, params: [key], at: expect.any(Number) }])
    expect(fn).toHaveBeenCalledTimes(1)
    expect(db.outcomes).toEqual(['commit'])
    expect(db.openTransactions()).toBe(0)
    expect(db.heldKeys.size).toBe(0)
  })

  it('ends the empty transaction when the lock is taken elsewhere and fails with deadline once the budget is gone', async () => {
    const db = createFakeDatabase()
    const key = `${freshNamespace()}:owner`
    db.heldKeys.add(key)
    const fn = jest.fn(async () => 'never')

    const error = await withAdvisoryXactLock(db.em, key, fn, { waitDeadlineMs: 0 }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(AdvisoryLockUnavailableError)
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({ name: 'AdvisoryLockUnavailableError', reason: 'deadline', key })
    expect((error as Error).message.startsWith('[internal]')).toBe(true)
    expect(fn).not.toHaveBeenCalled()
    expect(db.outcomes).toEqual(['commit'])
    expect(db.openTransactions()).toBe(0)
  })

  it('retries after the back-off and runs fn once the other holder releases', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0)
    const db = createFakeDatabase()
    const key = `${freshNamespace()}:owner`
    db.heldKeys.add(key)
    const start = Date.now()
    const fn = jest.fn(async () => 'acquired')
    const call = track(withAdvisoryXactLock(db.em, key, fn))

    await jest.advanceTimersByTimeAsync(100)
    db.heldKeys.delete(key)
    await jest.advanceTimersByTimeAsync(50)
    const settled = await call.done

    expect(settled.value).toBe('acquired')
    expect(db.lockQueries.map((query) => query.at - start)).toEqual([0, 50, 150])
    expect(fn).toHaveBeenCalledTimes(1)
    expect(db.outcomes).toEqual(['commit', 'commit', 'commit'])
  })

  it('doubles the back-off from 50 ms up to attempt 5 and never waits past the deadline', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0)
    const db = createFakeDatabase()
    const key = `${freshNamespace()}:owner`
    db.heldKeys.add(key)
    const start = Date.now()
    const call = track(withAdvisoryXactLock(db.em, key, async () => 'never', { waitDeadlineMs: 3_000 }))

    await jest.advanceTimersByTimeAsync(2_999)
    expect(call.result()).toBeNull()
    await jest.advanceTimersByTimeAsync(1)
    const settled = await call.done

    expect(db.lockQueries.map((query) => query.at - start)).toEqual([0, 50, 150, 350, 750, 1_550, 2_350])
    expect(settled.error).toMatchObject({ reason: 'deadline', key })
    expect(settled.settledAt - start).toBe(3_000)
    expect(db.openTransactions()).toBe(0)
  })

  it('keeps every back-off at or below 824 ms with the largest jitter', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.999)
    const db = createFakeDatabase()
    const key = `${freshNamespace()}:owner`
    db.heldKeys.add(key)
    const start = Date.now()
    const call = track(withAdvisoryXactLock(db.em, key, async () => 'never', { waitDeadlineMs: 5_000 }))

    await jest.advanceTimersByTimeAsync(5_000)
    await call.done

    const attemptTimes = db.lockQueries.map((query) => query.at - start)
    const gaps = attemptTimes.slice(1).map((time, index) => time - attemptTimes[index])
    expect(gaps.slice(0, 6)).toEqual([74, 124, 224, 424, 824, 824])
    expect(Math.max(...gaps)).toBe(824)
  })

  it('measures the default 15 s deadline from the call start', async () => {
    const db = createFakeDatabase()
    const key = `${freshNamespace()}:owner`
    db.heldKeys.add(key)
    const start = Date.now()
    const call = track(withAdvisoryXactLock(db.em, key, async () => 'never'))

    await jest.advanceTimersByTimeAsync(14_999)
    expect(call.result()).toBeNull()
    await jest.advanceTimersByTimeAsync(1)
    const settled = await call.done

    expect(settled.error).toBeInstanceOf(AdvisoryLockUnavailableError)
    expect(settled.error).toMatchObject({ reason: 'deadline', key })
    expect(settled.settledAt - start).toBe(15_000)
  })

  it('calls onWait after each failed attempt and back-off with no connection held, and short-circuits on done', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0)
    const db = createFakeDatabase()
    const key = `${freshNamespace()}:owner`
    db.heldKeys.add(key)
    const start = Date.now()
    const observed: Array<{ at: number; open: number }> = []
    const onWait = jest.fn(async (): Promise<AdvisoryLockWaitResult<string>> => {
      observed.push({ at: Date.now() - start, open: db.openTransactions() })
      return observed.length === 2 ? { done: true, value: 'from-wait' } : { done: false }
    })
    const fn = jest.fn(async () => 'from-lock')
    const call = track(withAdvisoryXactLock(db.em, key, fn, { onWait }))

    await jest.advanceTimersByTimeAsync(1_000)
    const settled = await call.done

    expect(settled.value).toBe('from-wait')
    expect(observed).toEqual([{ at: 50, open: 0 }, { at: 150, open: 0 }])
    expect(db.lockQueries).toHaveLength(2)
    expect(fn).not.toHaveBeenCalled()
  })

  it('propagates an onWait error unchanged, even one that looks transient', async () => {
    const db = createFakeDatabase()
    const key = `${freshNamespace()}:owner`
    db.heldKeys.add(key)
    const failure = Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' })
    const call = track(withAdvisoryXactLock(db.em, key, async () => 'never', {
      onWait: async () => {
        throw failure
      },
    }))

    await jest.advanceTimersByTimeAsync(1_000)
    const settled = await call.done

    expect(settled.error).toBe(failure)
    expect(db.lockQueries).toHaveLength(1)
  })

  it('rolls back, releases the lock and its slot, and propagates an fn error unchanged', async () => {
    const db = createFakeDatabase()
    const key = `${freshNamespace()}:owner`
    const failure = Object.assign(new Error('could not obtain lock on row'), { code: '55P03' })

    await expect(
      withAdvisoryXactLock(db.em, key, async () => {
        throw failure
      }, { maxConcurrentHolders: 1 }),
    ).rejects.toBe(failure)

    expect(db.outcomes).toEqual(['rollback'])
    expect(db.openTransactions()).toBe(0)
    expect(db.heldKeys.size).toBe(0)
    await expect(
      withAdvisoryXactLock(db.em, key, async () => 'next', { maxConcurrentHolders: 1, waitDeadlineMs: 0 }),
    ).resolves.toBe('next')
  })

  it.each([
    ['begin', { begin: new Error('timeout exceeded when trying to connect') }],
    ['lock query', { lock: Object.assign(new Error('wrapped by the ORM'), { previous: { code: '57P01' } }) }],
    ['commit', { commit: new Error('Client has encountered a connection error and is not queryable') }],
  ])('maps a transient %s failure to transient_db with the original error as cause', async (_stage, faults: TransactionFaults) => {
    const db = createFakeDatabase()
    const key = `${freshNamespace()}:owner`
    db.queueFaults(faults)
    const original = faults.begin ?? faults.lock ?? faults.commit

    const error = await withAdvisoryXactLock(db.em, key, async () => 'value').catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(AdvisoryLockUnavailableError)
    expect(error).toMatchObject({ reason: 'transient_db', key })
    expect((error as Error).cause).toBe(original)
    expect((error as Error).message.startsWith('[internal]')).toBe(true)
    expect(db.openTransactions()).toBe(0)
  })

  it.each([
    ['begin', { begin: new Error('permission denied for database') }],
    ['lock query', { lock: Object.assign(new Error('function hashtextextended does not exist'), { code: '42883' }) }],
    ['commit', { commit: new Error('[internal] tenant data encryption failed') }],
  ])('propagates a non-transient %s failure unchanged', async (_stage, faults: TransactionFaults) => {
    const db = createFakeDatabase()
    const key = `${freshNamespace()}:owner`
    db.queueFaults(faults)
    const original = faults.begin ?? faults.lock ?? faults.commit

    await expect(withAdvisoryXactLock(db.em, key, async () => 'value')).rejects.toBe(original)
  })

  it.each(['', 'no_separator', 'Upper:x', '1abc:x', 'a-b:x', ':x', 'abc:', ' abc:x'])(
    'rejects the key %p with a TypeError before forking',
    async (key) => {
      const db = createFakeDatabase()

      const error = await withAdvisoryXactLock(db.em, key, async () => 'value').catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(TypeError)
      expect((error as Error).message.startsWith('[internal]')).toBe(true)
      expect(db.fork).not.toHaveBeenCalled()
    },
  )

  it('accepts a key whose parts contain further separators', async () => {
    const db = createFakeDatabase()

    await expect(withAdvisoryXactLock(db.em, 'oauth_grant:id:tenant:org:-', async () => 'value')).resolves.toBe('value')
  })

  it.each([
    [{ maxConcurrentHolders: 0 }],
    [{ maxConcurrentHolders: 1.5 }],
    [{ waitDeadlineMs: -1 }],
    [{ waitDeadlineMs: Number.NaN }],
    [{ waitDeadlineMs: Number.POSITIVE_INFINITY }],
  ])('rejects the invalid options %p with a TypeError before forking', async (options) => {
    const db = createFakeDatabase()

    const error = await withAdvisoryXactLock(db.em, `${freshNamespace()}:owner`, async () => 'value', options)
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(TypeError)
    expect((error as Error).message.startsWith('[internal]')).toBe(true)
    expect(db.fork).not.toHaveBeenCalled()
  })

  it('re-exports the pg-errors matcher', () => {
    expect(isTransientLockDbError).toBe(pgErrorsTransientLockDbError)
  })

  describe('maxConcurrentHolders', () => {
    it('makes a third attempt wait for a slot without a connection and fail with deadline', async () => {
      const db = createFakeDatabase()
      const namespace = freshNamespace()
      const release = createDeferred()
      const holderFn = jest.fn(async () => {
        await release.promise
        return 'held'
      })
      const first = track(withAdvisoryXactLock(db.em, `${namespace}:a`, holderFn, { maxConcurrentHolders: 2 }))
      const second = track(withAdvisoryXactLock(db.em, `${namespace}:b`, holderFn, { maxConcurrentHolders: 2 }))
      await jest.advanceTimersByTimeAsync(0)
      expect(db.openTransactions()).toBe(2)

      const start = Date.now()
      const thirdFn = jest.fn(async () => 'third')
      const third = track(withAdvisoryXactLock(db.em, `${namespace}:c`, thirdFn, { maxConcurrentHolders: 2, waitDeadlineMs: 1_000 }))
      await jest.advanceTimersByTimeAsync(999)
      expect(third.result()).toBeNull()
      expect(db.transactional).toHaveBeenCalledTimes(2)
      expect(db.openTransactions()).toBe(2)
      await jest.advanceTimersByTimeAsync(1)
      const thirdSettled = await third.done

      expect(thirdSettled.error).toBeInstanceOf(AdvisoryLockUnavailableError)
      expect(thirdSettled.error).toMatchObject({ reason: 'deadline', key: `${namespace}:c` })
      expect(thirdSettled.settledAt - start).toBe(1_000)
      expect(thirdFn).not.toHaveBeenCalled()
      expect(db.lockQueries.map((query) => query.params[0])).toEqual([`${namespace}:a`, `${namespace}:b`])

      await expect(withAdvisoryXactLock(db.em, `${namespace}:d`, async () => 'no slot taken')).resolves.toBe('no slot taken')
      await expect(
        withAdvisoryXactLock(db.em, `${namespace}:e`, async () => 'own limit', { maxConcurrentHolders: 3, waitDeadlineMs: 0 }),
      ).resolves.toBe('own limit')
      await expect(
        withAdvisoryXactLock(db.em, `${freshNamespace()}:a`, async () => 'other namespace', { maxConcurrentHolders: 2, waitDeadlineMs: 0 }),
      ).resolves.toBe('other namespace')

      release.resolve()
      expect((await first.done).value).toBe('held')
      expect((await second.done).value).toBe('held')
      await expect(
        withAdvisoryXactLock(db.em, `${namespace}:c`, async () => 'slot free', { maxConcurrentHolders: 2, waitDeadlineMs: 0 }),
      ).resolves.toBe('slot free')
    })

    it('hands a released slot to the next live waiter', async () => {
      const db = createFakeDatabase()
      const namespace = freshNamespace()
      const release = createDeferred()
      const holder = track(withAdvisoryXactLock(db.em, `${namespace}:holder`, async () => {
        await release.promise
        return 'holder'
      }, { maxConcurrentHolders: 1 }))
      await jest.advanceTimersByTimeAsync(0)
      const start = Date.now()
      const waiter = track(withAdvisoryXactLock(db.em, `${namespace}:waiter`, async () => 'waiter', { maxConcurrentHolders: 1 }))

      await jest.advanceTimersByTimeAsync(200)
      expect(waiter.result()).toBeNull()
      expect(db.transactional).toHaveBeenCalledTimes(1)
      release.resolve()
      await jest.advanceTimersByTimeAsync(0)

      expect((await holder.done).value).toBe('holder')
      const settled = await waiter.done
      expect(settled.value).toBe('waiter')
      expect(settled.settledAt - start).toBe(200)
    })

    it('never hands a slot to a waiter that already reached its deadline', async () => {
      const db = createFakeDatabase()
      const namespace = freshNamespace()
      const release = createDeferred()
      const holder = track(withAdvisoryXactLock(db.em, `${namespace}:holder`, async () => {
        await release.promise
        return 'holder'
      }, { maxConcurrentHolders: 1 }))
      await jest.advanceTimersByTimeAsync(0)
      const expiredFn = jest.fn(async () => 'expired')
      const liveFn = jest.fn(async () => 'live')
      const expired = track(withAdvisoryXactLock(db.em, `${namespace}:expired`, expiredFn, { maxConcurrentHolders: 1, waitDeadlineMs: 100 }))
      const live = track(withAdvisoryXactLock(db.em, `${namespace}:live`, liveFn, { maxConcurrentHolders: 1, waitDeadlineMs: 10_000 }))

      await jest.advanceTimersByTimeAsync(100)
      expect((await expired.done).error).toMatchObject({ reason: 'deadline', key: `${namespace}:expired` })
      release.resolve()
      await jest.advanceTimersByTimeAsync(0)

      expect((await holder.done).value).toBe('holder')
      expect((await live.done).value).toBe('live')
      expect(expiredFn).not.toHaveBeenCalled()
      expect(db.lockQueries.map((query) => query.params[0])).toEqual([`${namespace}:holder`, `${namespace}:live`])
      await expect(
        withAdvisoryXactLock(db.em, `${namespace}:after`, async () => 'after', { maxConcurrentHolders: 1, waitDeadlineMs: 0 }),
      ).resolves.toBe('after')
    })

    it('shares the slot count between isolated module instances through globalThis', async () => {
      const firstInstance = loadIsolatedAdvisoryLockModule()
      const secondInstance = loadIsolatedAdvisoryLockModule()
      expect(firstInstance.withAdvisoryXactLock).not.toBe(secondInstance.withAdvisoryXactLock)
      const db = createFakeDatabase()
      const namespace = freshNamespace()
      const release = createDeferred()
      const holderFn = async () => {
        await release.promise
        return 'held'
      }
      const first = track(firstInstance.withAdvisoryXactLock(db.em, `${namespace}:a`, holderFn, { maxConcurrentHolders: 2 }))
      const second = track(firstInstance.withAdvisoryXactLock(db.em, `${namespace}:b`, holderFn, { maxConcurrentHolders: 2 }))
      await jest.advanceTimersByTimeAsync(0)

      const thirdFn = jest.fn(async () => 'third')
      const third = track(secondInstance.withAdvisoryXactLock(db.em, `${namespace}:c`, thirdFn, { maxConcurrentHolders: 2, waitDeadlineMs: 500 }))
      await jest.advanceTimersByTimeAsync(500)
      const thirdSettled = await third.done

      expect(thirdSettled.error).toBeInstanceOf(secondInstance.AdvisoryLockUnavailableError)
      expect(thirdSettled.error).toMatchObject({ reason: 'deadline' })
      expect(thirdFn).not.toHaveBeenCalled()
      expect(db.openTransactions()).toBe(2)
      const slots = (globalThis as Record<string, unknown>)[GLOBAL_SLOTS_KEY]
      expect(slots).toBeInstanceOf(Map)
      expect((slots as Map<string, unknown>).has(namespace)).toBe(true)

      release.resolve()
      expect((await first.done).value).toBe('held')
      expect((await second.done).value).toBe('held')
    })
  })
})
