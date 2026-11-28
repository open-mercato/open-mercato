import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
import { Client } from 'pg'
import { expect, test } from '@playwright/test'
import { MikroORM } from '@mikro-orm/postgresql'
import { createTillioLock, tillioOperatorLockKey, tillioPullLockKey } from '../lib/locking'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(currentDir, '..', '..', '..', '..', '..', '..')
const appDir = path.join(repoRoot, 'apps', 'mercato')

if (!process.env.OM_TEST_APP_ROOT?.trim()) {
  loadEnv({ path: path.resolve(appDir, '.env') })
}

type PgClient = InstanceType<typeof Client>
type Latch = { promise: Promise<void>; release: () => void }
type LockRows = { granted: number; waiting: number }

const OBSERVATION_TIMEOUT_MS = 10_000
const CONNECTION_TIMEOUT_MS = 2_000

function databaseUrl(): string {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('[internal] DATABASE_URL is required for TC-PHONE-006')
  return connectionString
}

function createOrm(poolMax: number) {
  return MikroORM.init({
    clientUrl: databaseUrl(),
    discovery: { warnWhenNoEntities: false },
    pool: { min: 0, max: poolMax },
    driverOptions: { connectionTimeoutMillis: CONNECTION_TIMEOUT_MS, statement_timeout: OBSERVATION_TIMEOUT_MS },
  })
}

function createLatch(): Latch {
  let release: () => void = () => {}
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

function scopedKey(): string {
  return tillioPullLockKey({ tenantId: randomUUID(), organizationId: randomUUID() })
}

async function readLockRows(client: PgClient, key: string): Promise<LockRows> {
  const result = await client.query<LockRows>(
    `select count(*) filter (where granted)::int as granted,
            count(*) filter (where not granted)::int as waiting
       from pg_locks
      where locktype = 'advisory'
        and objsubid = 1
        and database = (select oid from pg_database where datname = current_database())
        and ((classid::bigint << 32) | objid::bigint) = hashtext($1::text)::bigint`,
    [key],
  )
  return result.rows[0]
}

async function expectLockRows(client: PgClient, key: string, expected: LockRows, message: string): Promise<void> {
  await expect.poll(() => readLockRows(client, key), { message, timeout: OBSERVATION_TIMEOUT_MS }).toEqual(expected)
}

/**
 * TC-PHONE-006 — the Tillio scope lock excludes a second contender until the holder's
 * transaction ends.
 *
 * The tests use a private pool and random keys. A separate connection observes which
 * transactions hold the key or are waiting for it in PostgreSQL.
 */
test.describe('TC-PHONE-006: Tillio advisory lock', () => {
  let orm: Awaited<ReturnType<typeof createOrm>>
  let observer: PgClient

  test.slow()

  test.beforeEach(async () => {
    orm = await createOrm(4)
    observer = new Client({
      connectionString: databaseUrl(),
      connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
      statement_timeout: OBSERVATION_TIMEOUT_MS,
    })
    await observer.connect()
  })

  test.afterEach(async () => {
    await Promise.all([observer?.end(), orm?.close(true)])
  })

  test('a new contender waits for the legacy advisory lock on the same scope', async () => {
    const key = scopedKey()
    const em = orm.em.fork()
    let entered = false
    let contender: Promise<string> | undefined

    await observer.query('begin')
    try {
      await observer.query('select pg_advisory_xact_lock(hashtext($1::text))', [key])
      contender = createTillioLock(em, key)(async () => {
        entered = true
        return 'new'
      })
      await expectLockRows(observer, key, { granted: 1, waiting: 1 }, 'the contender queues on the legacy key')
      expect(entered).toBe(false)

      await observer.query('commit')
      await expect(contender).resolves.toBe('new')
      await expectLockRows(observer, key, { granted: 0, waiting: 0 }, 'both transactions released the key')
    } finally {
      await observer.query('rollback')
      await Promise.allSettled([contender])
    }
  })

  test('a rollback releases the key to the waiting contender and to a later retry', async () => {
    const em = orm.em
    const key = scopedKey()
    const order: string[] = []
    const failure = new Error('[internal] TC-PHONE-006 deliberate rollback')
    const aEntered = createLatch()
    const aRelease = createLatch()
    let runA: Promise<string> | null = null
    let runB: Promise<string> | null = null

    try {
      runA = createTillioLock(em.fork(), key)(async () => {
        order.push('A:start')
        aEntered.release()
        await aRelease.promise
        order.push('A:throw')
        throw failure
      })
      const settledA = runA.catch((error: unknown) => error)
      await aEntered.promise
      expect(await readLockRows(observer, key), 'A holds the key before it fails').toEqual({ granted: 1, waiting: 0 })

      runB = createTillioLock(em.fork(), key)(async () => {
        order.push('B:start')
        return 'B'
      })
      await expectLockRows(observer, key, { granted: 1, waiting: 1 }, 'B queues on the key A holds')

      aRelease.release()
      expect(await settledA, 'the critical-section failure propagates').toBe(failure)
      await expect(runB).resolves.toBe('B')
      expect(order).toEqual(['A:start', 'A:throw', 'B:start'])

      const retry = await createTillioLock(em.fork(), key)(async () => readLockRows(observer, key))
      expect(retry, 'a retry reacquires the key on its own').toEqual({ granted: 1, waiting: 0 })
      await expectLockRows(observer, key, { granted: 0, waiting: 0 }, 'the retry released the key')
    } finally {
      aEntered.release()
      aRelease.release()
      await Promise.allSettled([runA, runB].filter((run): run is Promise<string> => run !== null))
    }
  })

  test('a different tenant and organization proceeds while another scope is held', async () => {
    const em = orm.em
    const heldKey = scopedKey()
    const otherKey = scopedKey()
    const aEntered = createLatch()
    const aRelease = createLatch()
    let aFinished = false
    let runA: Promise<string> | null = null

    try {
      runA = createTillioLock(em.fork(), heldKey)(async () => {
        aEntered.release()
        await aRelease.promise
        aFinished = true
        return 'A'
      })
      await aEntered.promise
      expect(await readLockRows(observer, heldKey), 'A holds its own scope').toEqual({ granted: 1, waiting: 0 })

      const other = await createTillioLock(em.fork(), otherKey)(async () => readLockRows(observer, otherKey))
      expect(other, 'the unrelated scope takes its own key').toEqual({ granted: 1, waiting: 0 })
      expect(aFinished, 'the unrelated scope finished while A still held its key').toBe(false)
      expect(await readLockRows(observer, heldKey), 'A still holds its scope untouched').toEqual({ granted: 1, waiting: 0 })

      aRelease.release()
      await expect(runA).resolves.toBe('A')
    } finally {
      aEntered.release()
      aRelease.release()
      await Promise.allSettled([runA].filter((run): run is Promise<string> => run !== null))
    }
  })
})

test.describe('TC-PHONE-006: Tillio lock pool budget', () => {
  for (const poolMax of [1, 2, 4]) {
    test(`completes operator and pull work with a pool of ${poolMax}`, async () => {
      const orm = await createOrm(poolMax)
      try {
        const requests = Array.from({ length: poolMax + 1 }, (_, index) => {
          const scope = { tenantId: randomUUID(), organizationId: randomUUID() }
          const key = index % 2 === 0 ? tillioOperatorLockKey(scope) : tillioPullLockKey(scope)
          const requestEm = orm.em.fork({ useContext: true })
          const serviceEm = poolMax === 1 ? requestEm : orm.em.fork()
          return createTillioLock(requestEm, key)(async () => {
            const [row] = await serviceEm.execute<Array<{ holds_lock: boolean }>>(
              `select exists (select 1 from pg_locks where locktype = 'advisory'
                and pid = pg_backend_pid()) as holds_lock`,
            )
            return row.holds_lock
          })
        })

        const results = await Promise.allSettled(requests)
        expect(results).toEqual(
          Array.from({ length: poolMax + 1 }, () => ({ status: 'fulfilled', value: poolMax === 1 })),
        )
      } finally {
        await orm.close(true)
      }
    })
  }
})
