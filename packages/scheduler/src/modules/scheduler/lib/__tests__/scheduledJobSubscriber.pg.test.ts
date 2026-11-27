/**
 * BullMQ sync timing of ScheduledJobSubscriber against a real PostgreSQL.
 *
 * Under QUEUE_STRATEGY=async the subscriber mirrors schedule changes to BullMQ. An activation
 * written through `withTenantActiveScheduleSlot` runs inside a transaction that holds the
 * tenant's advisory lock, so the sync must wait for that transaction to commit: Redis is never
 * called before commit, a rollback publishes nothing, and a slow Redis call does not keep the
 * lock. The BullMQ service is a recorder that, on each call, reads the row and probes the lock
 * from another connection.
 *
 * Gated on OM_SCHEDULER_PG_URL — a throwaway database, since the suite drops and recreates the
 * `scheduled_jobs` table. Never point it at a development or shared database. Run it with, for
 * example:
 *
 *   docker run -d --rm --name om-scheduler-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=om \
 *     -p 54374:5432 postgres:16-alpine
 *   OM_SCHEDULER_PG_URL=postgres://postgres:postgres@127.0.0.1:54374/om \
 *     yarn workspace @open-mercato/scheduler jest scheduledJobSubscriber.pg
 */
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy'
import { MikroORM, type EntityManager } from '@mikro-orm/postgresql'
import { ScheduledJob } from '../../data/entities'
import { activeScheduleLockKey, withTenantActiveScheduleSlot } from '../activeScheduleLimits'
import { ScheduledJobSubscriber } from '../scheduledJobSubscriber'

const PG_URL = process.env.OM_SCHEDULER_PG_URL ?? ''
const maybe = PG_URL ? describe : describe.skip

const LOCK_PROBE_SQL = 'select pg_try_advisory_xact_lock(hashtextextended(?, 0)) as locked'

type SyncObservation = {
  method: 'register' | 'unregister'
  scheduleId: string
  committedEnabled: boolean | null
  lockFree: boolean
}

type Deferred = { promise: Promise<void>; resolve: () => void }

function deferred(): Deferred {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function settleWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`[internal] still waiting after ${timeoutMs} ms`)), timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

maybe('ScheduledJobSubscriber BullMQ sync against PostgreSQL', () => {
  jest.setTimeout(60_000)
  let orm: MikroORM
  let previousStrategy: string | undefined
  const observations: SyncObservation[] = []
  let currentTenantId = ''
  let stallNextRegister: { entered: Deferred; release: Deferred } | null = null

  async function readCommittedEnabled(scheduleId: string): Promise<boolean | null> {
    const rows = await orm.em
      .fork()
      .getConnection()
      .execute<Array<{ is_enabled: boolean }>>('select is_enabled from scheduled_jobs where id = ?', [scheduleId])
    return rows[0]?.is_enabled ?? null
  }

  async function isTenantLockFree(tenantId: string): Promise<boolean> {
    return orm.em.fork().transactional(async (probeEm) => {
      const rows = await probeEm.execute<Array<{ locked: boolean }>>(LOCK_PROBE_SQL, [activeScheduleLockKey(tenantId)])
      return rows[0].locked
    })
  }

  async function observe(method: SyncObservation['method'], scheduleId: string): Promise<void> {
    observations.push({
      method,
      scheduleId,
      committedEnabled: await readCommittedEnabled(scheduleId),
      lockFree: await isTenantLockFree(currentTenantId),
    })
  }

  const bullmqService = {
    async register(schedule: ScheduledJob) {
      await observe('register', schedule.id)
      const stall = stallNextRegister
      if (stall) {
        stallNextRegister = null
        stall.entered.resolve()
        await stall.release.promise
      }
    },
    async unregister(scheduleId: string) {
      await observe('unregister', scheduleId)
    },
  }

  function buildSchedule(em: EntityManager, tenantId: string, name: string): ScheduledJob {
    return em.create(ScheduledJob, {
      id: randomUUID(),
      tenantId,
      organizationId: randomUUID(),
      scopeType: 'organization',
      name,
      scheduleType: 'interval',
      scheduleValue: '15m',
      timezone: 'UTC',
      targetType: 'queue',
      targetQueue: 'scheduler-test',
      isEnabled: true,
      sourceType: 'user',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  }

  function activate(em: EntityManager, tenantId: string, name: string): Promise<ScheduledJob> {
    return withTenantActiveScheduleSlot(em, tenantId, true, () => {
      const schedule = buildSchedule(em, tenantId, name)
      em.persist(schedule)
      return schedule
    })
  }

  beforeAll(async () => {
    previousStrategy = process.env.QUEUE_STRATEGY
    process.env.QUEUE_STRATEGY = 'async'
    orm = await MikroORM.init({
      clientUrl: PG_URL,
      entities: [ScheduledJob],
      metadataProvider: ReflectMetadataProvider,
      allowGlobalContext: true,
      debug: false,
      pool: { min: 0, max: 8 },
    })
    await orm.schema.refresh()
    const subscriber = new ScheduledJobSubscriber()
    subscriber.setContainer({
      hasRegistration: () => true,
      resolve: () => bullmqService,
    } as never)
    orm.em.getEventManager().registerSubscriber(subscriber)
  }, 60_000)

  afterAll(async () => {
    await orm?.close(true)
    if (previousStrategy === undefined) delete process.env.QUEUE_STRATEGY
    else process.env.QUEUE_STRATEGY = previousStrategy
  })

  beforeEach(() => {
    observations.length = 0
    stallNextRegister = null
    currentTenantId = randomUUID()
  })

  it('registers an activation only after its transaction commits and releases the tenant lock', async () => {
    const schedule = await activate(orm.em.fork(), currentTenantId, 'committed activation')

    expect(observations).toEqual([
      { method: 'register', scheduleId: schedule.id, committedEnabled: true, lockFree: true },
    ])
  })

  it('publishes nothing when the enclosing transaction rolls back', async () => {
    let scheduleId = ''
    await expect(
      orm.em.fork().transactional(async (trx) => {
        const schedule = await activate(trx, currentTenantId, 'rolled back activation')
        scheduleId = schedule.id
        throw new Error('[internal] enclosing transaction fails after the activation')
      }),
    ).rejects.toThrow('enclosing transaction fails')

    expect(scheduleId).not.toBe('')
    expect(await readCommittedEnabled(scheduleId)).toBeNull()
    expect(observations).toEqual([])
  })

  it('registers an activation that joined an enclosing transaction once that transaction commits', async () => {
    const schedule = await orm.em.fork().transactional(async (trx) => {
      const created = await activate(trx, currentTenantId, 'joined activation')
      expect(observations).toEqual([])
      return created
    })

    expect(observations).toEqual([
      { method: 'register', scheduleId: schedule.id, committedEnabled: true, lockFree: true },
    ])
  })

  it('syncs a committed savepoint with its outer transaction and drops a rolled back one', async () => {
    let rolledBackId = ''
    const [outer, kept] = await orm.em.fork().transactional(async (trx) => {
      const outerSchedule = await activate(trx, currentTenantId, 'outer activation')
      const keptSchedule = await trx.transactional((inner) => activate(inner, currentTenantId, 'kept savepoint'))
      await expect(
        trx.transactional(async (inner) => {
          const dropped = await activate(inner, currentTenantId, 'rolled back savepoint')
          rolledBackId = dropped.id
          throw new Error('[internal] savepoint fails')
        }),
      ).rejects.toThrow('savepoint fails')
      expect(observations).toEqual([])
      return [outerSchedule, keptSchedule]
    })

    expect(rolledBackId).not.toBe('')
    expect(await readCommittedEnabled(rolledBackId)).toBeNull()
    expect(observations.map((entry) => entry.scheduleId).sort()).toEqual([outer.id, kept.id].sort())
    expect(observations.every((entry) => entry.committedEnabled === true && entry.lockFree)).toBe(true)
  })

  it('does not hold the tenant lock while a BullMQ registration is slow', async () => {
    const stall = { entered: deferred(), release: deferred() }
    stallNextRegister = stall

    const slow = activate(orm.em.fork(), currentTenantId, 'slow registration')
    await stall.entered.promise

    const next = await settleWithin(
      activate(orm.em.fork(), currentTenantId, 'activation during slow registration'),
      5_000,
    )
    expect(await readCommittedEnabled(next.id)).toBe(true)
    expect(await isTenantLockFree(currentTenantId)).toBe(true)

    stall.release.resolve()
    const first = await slow
    expect(observations.map((entry) => entry.scheduleId).sort()).toEqual([first.id, next.id].sort())
    expect(observations.every((entry) => entry.committedEnabled === true && entry.lockFree)).toBe(true)
  })

  it('keeps syncing ordinary flushes outside a transaction right away', async () => {
    const em = orm.em.fork()
    const schedule = buildSchedule(em, currentTenantId, 'plain flush')
    em.persist(schedule)
    await em.flush()
    expect(observations).toEqual([
      { method: 'register', scheduleId: schedule.id, committedEnabled: true, lockFree: true },
    ])

    schedule.isEnabled = false
    await em.flush()
    expect(observations[1]).toEqual({
      method: 'unregister',
      scheduleId: schedule.id,
      committedEnabled: false,
      lockFree: true,
    })
  })
})
