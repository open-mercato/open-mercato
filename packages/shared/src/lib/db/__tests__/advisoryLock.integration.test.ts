import { randomUUID } from 'node:crypto'
import { EntitySchema, MikroORM, type EventSubscriber } from '@mikro-orm/core'
import { PostgreSqlDriver, type EntityManager } from '@mikro-orm/postgresql'
import type { StartedTestContainer } from 'testcontainers'
import { withAdvisoryXactLock } from '../advisoryLock'

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

const DATABASE_NAME = 'advisory_lock_test'
const DATABASE_USER = 'advisory_lock'
const DATABASE_PASSWORD = 'advisory_lock'
const PROBE_TABLE = 'advisory_lock_probe_rows'
const LOCK_PROBE_SQL = 'select pg_try_advisory_xact_lock(hashtextextended(?, 0)) as locked'
const ACQUIRE_TIMEOUT_MS = 1000
const HOLD_MS = 3000
const PROBE_INTERVAL_MS = 500
const SHORT_HOLD_MS = 25
const WAITER_COUNT = 10
const CASE_TIMEOUT_MS = 20_000
const POOL_ACQUIRE_TIMEOUT_PATTERN = /timeout exceeded when trying to connect/i

type ProbeRow = { id: string; label: string }

const ProbeRowSchema = new EntitySchema<ProbeRow>({
  name: 'AdvisoryLockProbeRow',
  tableName: PROBE_TABLE,
  properties: {
    id: { type: 'string', primary: true },
    label: { type: 'string' },
  },
})

type TestOrm = MikroORM<PostgreSqlDriver, EntityManager<PostgreSqlDriver>>

type LockProbe = { locked: boolean; pid: number }

type SubscriberCall = { label: string; insideFn: boolean }

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((resolveDeferred) => {
    resolve = resolveDeferred
  })
  return { promise, resolve }
}

describeWithPostgres('withAdvisoryXactLock against real PostgreSQL', () => {
  let postgres: StartedTestContainer | null = null
  let connection: { host: string; port: number } | null = null
  const startedOrms = new Set<TestOrm>()

  async function startOrm(options: { poolMax: number; acquireTimeoutMs?: number }): Promise<TestOrm> {
    if (!connection) throw new Error('[internal] PostgreSQL container is not running')
    const orm = await MikroORM.init<PostgreSqlDriver, EntityManager<PostgreSqlDriver>>({
      driver: PostgreSqlDriver,
      host: connection.host,
      port: connection.port,
      dbName: DATABASE_NAME,
      user: DATABASE_USER,
      password: DATABASE_PASSWORD,
      entities: [ProbeRowSchema],
      debug: false,
      pool: { min: 0, max: options.poolMax },
      driverOptions: { connectionTimeoutMillis: options.acquireTimeoutMs ?? ACQUIRE_TIMEOUT_MS },
    })
    startedOrms.add(orm)
    return orm
  }

  function forkRoot(orm: TestOrm): EntityManager {
    return orm.em.fork({ disableContextResolution: true })
  }

  function createRequestEm(orm: TestOrm): EntityManager {
    return orm.em.fork({ clear: true, freshEventManager: true, useContext: true })
  }

  async function readBackendPid(em: EntityManager): Promise<number> {
    const rows = await em.execute<Array<{ pid: number }>>('select pg_backend_pid() as pid')
    return rows[0].pid
  }

  async function insertProbeRow(em: EntityManager, label: string): Promise<void> {
    em.persist(em.create(ProbeRowSchema, { id: randomUUID(), label }))
    await em.flush()
  }

  async function readLabels(orm: TestOrm, tag: string): Promise<string[]> {
    const rows = await forkRoot(orm).execute<Array<{ label: string }>>(
      `select label from ${PROBE_TABLE} where label like ? order by label`,
      [`${tag}:%`],
    )
    return rows.map((row) => row.label)
  }

  async function probeLock(orm: TestOrm, key: string): Promise<LockProbe> {
    return forkRoot(orm).transactional(async (probeEm) => {
      const rows = await probeEm.execute<Array<{ locked: boolean }>>(LOCK_PROBE_SQL, [key])
      return { locked: rows[0].locked, pid: await readBackendPid(probeEm) }
    })
  }

  function registerCallRecorder(requestEm: EntityManager, calls: SubscriberCall[], isInsideFn: () => boolean): void {
    const recorder: EventSubscriber<ProbeRow> = {
      beforeCreate: (args) => {
        calls.push({ label: args.entity.label, insideFn: isInsideFn() })
      },
    }
    requestEm.getEventManager().registerSubscriber(recorder)
  }

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment({
        POSTGRES_DB: DATABASE_NAME,
        POSTGRES_USER: DATABASE_USER,
        POSTGRES_PASSWORD: DATABASE_PASSWORD,
      })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start()
    connection = { host: postgres.getHost(), port: postgres.getMappedPort(5432) }
    const schemaOrm = await startOrm({ poolMax: 1 })
    await schemaOrm.schema.create()
    startedOrms.delete(schemaOrm)
    await schemaOrm.close(true)
  }, 120_000)

  afterEach(async () => {
    const orms = [...startedOrms]
    startedOrms.clear()
    await Promise.allSettled(orms.map((orm) => orm.close(true)))
  }, 30_000)

  afterAll(async () => {
    const orms = [...startedOrms]
    startedOrms.clear()
    await Promise.allSettled(orms.map((orm) => orm.close(true)))
    await Promise.allSettled([postgres?.stop()])
  }, 30_000)

  it('proves the harness: a pool of 4 times out the fifth concurrent connection after the acquire timeout', async () => {
    const orm = await startOrm({ poolMax: 4 })
    const release = createDeferred()
    const allHeld = createDeferred()
    let held = 0
    const holders = Array.from({ length: 4 }, () =>
      forkRoot(orm).transactional(async (holderEm) => {
        await holderEm.execute('select 1')
        held += 1
        if (held === 4) allHeld.resolve()
        await release.promise
      }),
    )
    await allHeld.promise

    const startedAt = Date.now()
    const fifth = forkRoot(orm).execute('select 1')
    await expect(fifth).rejects.toThrow(POOL_ACQUIRE_TIMEOUT_PATTERN)
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(ACQUIRE_TIMEOUT_MS - 100)

    release.resolve()
    await Promise.all(holders)
  }, CASE_TIMEOUT_MS)

  it('keeps a second connection out for the whole of fn and frees the key when the lock transaction commits', async () => {
    const orm = await startOrm({ poolMax: 4 })
    const key = `lock_suite:${randomUUID()}`
    const otherKey = `lock_suite:${randomUUID()}`
    const probes: LockProbe[] = []
    let holderPid = 0
    let otherKeyProbe: LockProbe | null = null
    let heldForMs = 0

    await withAdvisoryXactLock(createRequestEm(orm), key, async (txEm) => {
      holderPid = await readBackendPid(txEm)
      otherKeyProbe = await probeLock(orm, otherKey)
      const enteredAt = Date.now()
      while (Date.now() - enteredAt < HOLD_MS) {
        probes.push(await probeLock(orm, key))
        await sleep(PROBE_INTERVAL_MS)
      }
      probes.push(await probeLock(orm, key))
      heldForMs = Date.now() - enteredAt
    })

    expect(heldForMs).toBeGreaterThanOrEqual(HOLD_MS)
    expect(probes.length).toBeGreaterThanOrEqual(HOLD_MS / PROBE_INTERVAL_MS)
    expect(probes.map((probe) => probe.locked)).toEqual(probes.map(() => false))
    expect(probes.every((probe) => probe.pid !== holderPid)).toBe(true)
    expect(otherKeyProbe).toMatchObject({ locked: true })
    expect(await probeLock(orm, key)).toMatchObject({ locked: true })
  }, CASE_TIMEOUT_MS)

  it('serves 10 concurrent waiters on one key from a pool of 4 without an acquire timeout', async () => {
    const orm = await startOrm({ poolMax: 4 })
    const key = `lock_suite:${randomUUID()}`
    const tag = randomUUID()
    let inFn = 0
    let peakInFn = 0
    let entered = 0

    const settled = await Promise.allSettled(
      Array.from({ length: WAITER_COUNT }, (_, index) =>
        withAdvisoryXactLock(createRequestEm(orm), key, async (txEm) => {
          const order = entered
          entered += 1
          inFn += 1
          peakInFn = Math.max(peakInFn, inFn)
          try {
            await insertProbeRow(txEm, `${tag}:${index}`)
            await sleep(order === 0 ? HOLD_MS : SHORT_HOLD_MS)
          } finally {
            inFn -= 1
          }
          return index
        }),
      ),
    )

    const failures = settled.flatMap((outcome) => (outcome.status === 'rejected' ? [String(outcome.reason)] : []))
    expect(failures.filter((failure) => POOL_ACQUIRE_TIMEOUT_PATTERN.test(failure))).toEqual([])
    expect(failures).toEqual([])
    expect(entered).toBe(WAITER_COUNT)
    expect(peakInFn).toBe(1)
    expect(await readLabels(orm, tag)).toHaveLength(WAITER_COUNT)
  }, CASE_TIMEOUT_MS)

  it('commits the lock transaction while the outer transaction on the request EntityManager rolls back', async () => {
    const orm = await startOrm({ poolMax: 4 })
    const requestEm = createRequestEm(orm)
    const key = `lock_suite:${randomUUID()}`
    const tag = randomUUID()
    const outerFailure = new Error('[internal] roll back the outer transaction')
    const pids = { outer: 0, lock: 0 }

    await expect(
      requestEm.transactional(async (outerEm) => {
        await insertProbeRow(outerEm, `${tag}:outer`)
        pids.outer = await readBackendPid(outerEm)
        await withAdvisoryXactLock(requestEm, key, async (txEm) => {
          pids.lock = await readBackendPid(txEm)
          await insertProbeRow(txEm, `${tag}:lock`)
        })
        throw outerFailure
      }),
    ).rejects.toBe(outerFailure)

    expect(pids.lock).not.toBe(pids.outer)
    expect(await readLabels(orm, tag)).toEqual([`${tag}:lock`])
  }, CASE_TIMEOUT_MS)

  it('fires a subscriber registered on the request EntityManager inside fn', async () => {
    const orm = await startOrm({ poolMax: 4 })
    const requestEm = createRequestEm(orm)
    const key = `lock_suite:${randomUUID()}`
    const label = `${randomUUID()}:inner`
    const calls: SubscriberCall[] = []
    let insideFn = false
    registerCallRecorder(requestEm, calls, () => insideFn)

    await withAdvisoryXactLock(requestEm, key, async (txEm) => {
      insideFn = true
      try {
        await insertProbeRow(txEm, label)
      } finally {
        insideFn = false
      }
    })

    expect(calls).toEqual([{ label, insideFn: true }])
  }, CASE_TIMEOUT_MS)

  it('fires the request subscriber inside fn under an outer transaction opened on the request EntityManager', async () => {
    const orm = await startOrm({ poolMax: 4 })
    const requestEm = createRequestEm(orm)
    const key = `lock_suite:${randomUUID()}`
    const label = `${randomUUID()}:inner`
    const calls: SubscriberCall[] = []
    let insideFn = false
    registerCallRecorder(requestEm, calls, () => insideFn)

    await requestEm.transactional(async (outerEm) => {
      await readBackendPid(outerEm)
      await withAdvisoryXactLock(requestEm, key, async (txEm) => {
        insideFn = true
        try {
          await insertProbeRow(txEm, label)
        } finally {
          insideFn = false
        }
      })
    })

    expect(calls).toEqual([{ label, insideFn: true }])
  }, CASE_TIMEOUT_MS)

  it('fires the request subscriber inside fn under an outer transaction opened on an EntityManager with a fresh event manager', async () => {
    const orm = await startOrm({ poolMax: 4 })
    const requestEm = createRequestEm(orm)
    const outerEm = createRequestEm(orm)
    const key = `lock_suite:${randomUUID()}`
    const label = `${randomUUID()}:inner`
    const calls: SubscriberCall[] = []
    let insideFn = false
    registerCallRecorder(requestEm, calls, () => insideFn)

    await outerEm.transactional(async (outerTxEm) => {
      await readBackendPid(outerTxEm)
      await withAdvisoryXactLock(requestEm, key, async (txEm) => {
        insideFn = true
        try {
          await insertProbeRow(txEm, label)
        } finally {
          insideFn = false
        }
      })
    })

    expect(calls).toEqual([{ label, insideFn: true }])
  }, CASE_TIMEOUT_MS)
})
