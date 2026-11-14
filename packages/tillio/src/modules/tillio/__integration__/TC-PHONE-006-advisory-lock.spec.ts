import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
import { Client } from 'pg'
import { expect, test } from '@playwright/test'
import type { EntityManager } from '@mikro-orm/postgresql'
import { bootstrapFromAppRoot } from '@open-mercato/shared/lib/bootstrap/dynamicLoader'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createTillioLock, tillioPullLockKey } from '../lib/locking'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(currentDir, '..', '..', '..', '..', '..', '..')
const appDir = path.join(repoRoot, 'apps', 'mercato')
const runtimeAppRoot = process.env.OM_TEST_APP_ROOT?.trim()
  ? path.resolve(process.env.OM_TEST_APP_ROOT.trim())
  : appDir

if (!process.env.OM_TEST_APP_ROOT?.trim()) {
  loadEnv({ path: path.resolve(appDir, '.env') })
}

type PgClient = InstanceType<typeof Client>
type Latch = { promise: Promise<void>; release: () => void }
type LockRows = { granted: number; waiting: number }

const OBSERVATION_TIMEOUT_MS = 10_000

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
 * Pull and operator writes read state, call Tillio and write back under `createTillioLock`.
 * The lock is only real when `pg_advisory_xact_lock` runs on the transaction's own connection;
 * taken anywhere else it is released at once and both contenders run the critical section
 * together. The scenario drives the real lock with two forked EntityManagers, so each contender
 * owns its own transaction and pooled connection, and reads `pg_locks` from a third connection
 * to observe who holds the key and who is queued on it. No Tillio credentials or requests are
 * involved: the key is generated per test, so nothing else can contend for it.
 */
test.describe('TC-PHONE-006: Tillio advisory lock', () => {
  let em: EntityManager
  let observer: PgClient

  test.slow()

  test.beforeEach(async () => {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) throw new Error('[internal] DATABASE_URL is required for TC-PHONE-006')
    if (!em) {
      await bootstrapFromAppRoot(runtimeAppRoot)
      const container = await createRequestContainer()
      em = container.resolve<EntityManager>('em')
    }
    observer = new Client({ connectionString })
    await observer.connect()
  })

  test.afterEach(async () => {
    await observer?.end()
  })

  test('a second contender for the same scope waits until the holder commits', async () => {
    const key = scopedKey()
    const order: string[] = []
    const aEntered = createLatch()
    const aRelease = createLatch()
    let bEntered = false
    let runA: Promise<string> | null = null
    let runB: Promise<string> | null = null

    try {
      runA = createTillioLock(em.fork(), key)(async () => {
        order.push('A:start')
        aEntered.release()
        await aRelease.promise
        order.push('A:end')
        return 'A'
      })
      await aEntered.promise
      expect(await readLockRows(observer, key), 'A holds the key inside its critical section').toEqual({ granted: 1, waiting: 0 })

      runB = createTillioLock(em.fork(), key)(async () => {
        bEntered = true
        order.push('B:start')
        order.push('B:end')
        return 'B'
      })
      await expectLockRows(observer, key, { granted: 1, waiting: 1 }, 'B queues on the key A holds')
      expect(bEntered, 'B cannot enter while A holds the key').toBe(false)

      aRelease.release()
      await expect(runA).resolves.toBe('A')
      await expect(runB).resolves.toBe('B')
      expect(order).toEqual(['A:start', 'A:end', 'B:start', 'B:end'])
      await expectLockRows(observer, key, { granted: 0, waiting: 0 }, 'both transactions released the key')
    } finally {
      aEntered.release()
      aRelease.release()
      await Promise.allSettled([runA, runB].filter((run): run is Promise<string> => run !== null))
    }
  })

  test('a rollback releases the key to the waiting contender and to a later retry', async () => {
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
