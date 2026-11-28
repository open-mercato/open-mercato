/**
 * Undo of `forms.distribution.update` vs a concurrent close, against a real PostgreSQL.
 * The undo must never reopen the distribution, whether the close commits before the undo
 * reads the row or while the undo is between its read and its write, and a failed undo
 * must release the row.
 *
 * Gated on OM_FORMS_PG_URL — a throwaway database, since the suite drops and
 * recreates the `forms_distribution` table. Never point it at a development or
 * shared database. Run it with, for example:
 *
 *   docker run -d --rm --name om-forms-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=om \
 *     -p 54373:5432 postgres:18-alpine
 *   OM_FORMS_PG_URL=postgres://postgres:postgres@127.0.0.1:54373/om \
 *     yarn workspace @open-mercato/core jest undo-stale-check.pg
 */
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy'
import { MikroORM, type EntityManager } from '@mikro-orm/postgresql'
import { FormDistribution } from '../data/entities'
import { updateDistributionCommand } from '../commands/distribution'

const PG_URL = process.env.OM_FORMS_PG_URL ?? ''
const maybe = PG_URL ? describe : describe.skip

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'

type Deferred = { promise: Promise<void>; resolve: () => void }

function deferred(): Deferred {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function delay(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms))
}

function withGatedFlush(em: EntityManager, beforeFlush: () => Promise<void>): EntityManager {
  return new Proxy(em, {
    get(target, property, receiver) {
      if (property === 'flush') {
        return async () => {
          await beforeFlush()
          return target.flush()
        }
      }
      if (property === 'fork') {
        return (options?: unknown) => withGatedFlush(target.fork(options as never) as EntityManager, beforeFlush)
      }
      if (property === 'transactional') {
        return (callback: (trx: EntityManager) => Promise<unknown>, options?: unknown) =>
          target.transactional((trx) => callback(withGatedFlush(trx as EntityManager, beforeFlush)), options as never)
      }
      const value = Reflect.get(target, property, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

maybe('forms undo vs a concurrent write against PostgreSQL', () => {
  jest.setTimeout(120_000)
  let orm: MikroORM

  beforeAll(async () => {
    orm = await MikroORM.init({
      clientUrl: PG_URL,
      entities: [FormDistribution],
      metadataProvider: ReflectMetadataProvider,
      allowGlobalContext: true,
      debug: false,
      pool: { min: 0, max: 8 },
    })
    await orm.schema.refresh()
  }, 60_000)

  afterAll(async () => {
    await orm?.close(true)
  })

  async function seedUpdatedDistribution(): Promise<{ id: string; updatedAt: string }> {
    const em = orm.em.fork()
    const now = new Date()
    const distribution = em.create(FormDistribution, {
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      formId: randomUUID(),
      mode: 'open',
      publicSlug: `slug-${randomUUID()}`,
      defaultLocale: 'en',
      maxResponses: 20,
      createdBy: randomUUID(),
      createdAt: now,
      updatedAt: now,
    })
    em.persist(distribution)
    await em.flush()
    return { id: distribution.id, updatedAt: now.toISOString() }
  }

  function undoUpdate(
    seeded: { id: string; updatedAt: string },
    emFactory: () => EntityManager = () => orm.em.fork(),
  ): Promise<unknown> {
    const scope = { id: seeded.id, organizationId: ORG_ID, tenantId: TENANT_ID }
    const fields = { status: 'active', title: null, maxResponses: 10, opensAt: null, closesAt: null, redirectUrl: null }
    const before = { ...scope, ...fields, allowMultipleSubmissions: false, requireCustomerAuth: false, settings: null }
    const after = { ...before, maxResponses: 20 }
    return updateDistributionCommand.undo!({
      logEntry: { commandPayload: { undo: { before, after, staleCheck: true } } },
      ctx: { container: { resolve: () => emFactory(), hasRegistration: () => false } },
    } as never)
  }

  function close(id: string): Promise<number> {
    return orm.em.fork().nativeUpdate(FormDistribution, { id }, { status: 'closed', updatedAt: new Date() })
  }

  async function readRow(id: string): Promise<FormDistribution> {
    return orm.em.fork().findOneOrFail(FormDistribution, { id })
  }

  async function waitForLockWaiter(): Promise<number> {
    const deadline = Date.now() + 3_000
    for (;;) {
      const rows = await orm.em.getConnection().execute<Array<{ count: string }>>(
        `select count(*)::text as count from pg_stat_activity
          where wait_event_type = 'Lock' and query ilike 'update "forms_distribution"%'`,
      )
      const count = Number(rows[0]?.count ?? 0)
      if (count === 1 || Date.now() > deadline) return count
      await delay(50)
    }
  }

  it('refuses an update undo after the distribution was closed and keeps it closed', async () => {
    const seeded = await seedUpdatedDistribution()
    await close(seeded.id)

    await expect(undoUpdate(seeded)).rejects.toMatchObject({
      status: 409,
      body: { code: 'forms.errors.undo_conflict' },
    })
    expect(await readRow(seeded.id)).toMatchObject({ status: 'closed', maxResponses: 20 })
  })

  it('a close that arrives while the undo is between its read and its write waits and wins', async () => {
    const seeded = await seedUpdatedDistribution()
    const writeReached = deferred()
    const releaseWrite = deferred()
    const undoing = undoUpdate(seeded, () =>
      withGatedFlush(orm.em.fork(), async () => {
        writeReached.resolve()
        await releaseWrite.promise
      }),
    )
    await writeReached.promise
    let closeSettled = false
    const closing = close(seeded.id).finally(() => {
      closeSettled = true
    })
    const waitingOnLock = await waitForLockWaiter()
    const closeFinishedBeforeUndoWrite = closeSettled
    releaseWrite.resolve()
    await expect(undoing).resolves.toBeUndefined()
    await closing

    expect(closeFinishedBeforeUndoWrite).toBe(false)
    expect(waitingOnLock).toBe(1)
    expect((await readRow(seeded.id)).status).toBe('closed')
  })

  it('a failed undo rolls back, releases the row and can be retried', async () => {
    const seeded = await seedUpdatedDistribution()
    const writeReached = deferred()
    const failWrite = deferred()
    const failing = undoUpdate(seeded, () =>
      withGatedFlush(orm.em.fork(), async () => {
        writeReached.resolve()
        await failWrite.promise
        throw new Error('[internal] injected flush failure')
      }),
    )
    await writeReached.promise
    const blockedReader = orm.em
      .fork()
      .getConnection()
      .execute(`select status from forms_distribution where id = ? for update nowait`, [seeded.id])
    await expect(blockedReader).rejects.toThrow(/could not obtain lock/)
    failWrite.resolve()
    await expect(failing).rejects.toThrow('injected flush failure')

    const untouched = await readRow(seeded.id)
    expect(untouched.maxResponses).toBe(20)
    expect(untouched.updatedAt.toISOString()).toBe(seeded.updatedAt)

    await expect(undoUpdate(seeded)).resolves.toBeUndefined()
    expect((await readRow(seeded.id)).maxResponses).toBe(10)
  })
})
