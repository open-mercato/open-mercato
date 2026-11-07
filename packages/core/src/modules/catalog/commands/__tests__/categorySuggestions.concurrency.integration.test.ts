/** @jest-environment node */
import { randomUUID } from 'node:crypto'
import { LockMode, MikroORM } from '@mikro-orm/core'
import { PostgreSqlDriver, type EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { StartedTestContainer } from 'testcontainers'
import {
  CatalogProduct,
  CatalogProductCategory,
  CatalogProductCategoryAssignment,
  CatalogProductCategorySuggestion,
} from '../../data/entities'
import { persistCategorySuggestion } from '../../lib/aiCategorization/suggestionPersistence'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({ translate: (_key: string, fallback?: string) => fallback ?? _key }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn((em: { find: (...args: unknown[]) => unknown }, ...args: unknown[]) => em.find(...args.slice(0, 3))),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  emitCrudSideEffects: jest.fn().mockResolvedValue(undefined),
  emitCrudUndoSideEffects: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('../../events', () => ({
  emitCatalogEvent: jest.fn().mockResolvedValue(undefined),
}))

// Imported after the mocks above so the module picks up the mocked deps.
import { acceptCategorySuggestionCommand, rejectCategorySuggestionCommand } from '../categorySuggestions'

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

const DATABASE_NAME = 'catalog_suggestion_lock_test'
const DATABASE_USER = 'catalog_suggestion_lock'
const DATABASE_PASSWORD = 'catalog_suggestion_lock'
const CASE_TIMEOUT_MS = 30_000
const WAITER_POLL_MS = 25
const WAITER_TIMEOUT_MS = 10_000

type TestOrm = MikroORM<PostgreSqlDriver, EntityManager<PostgreSqlDriver>>

type Deferred = { promise: Promise<void>; resolve: () => void }

type GateSpec = { method: 'findOne'; entity: string; lockMode?: LockMode }
type Gate = GateSpec & { fired: boolean; reached: Deferred; release: Deferred }

type CommandError = { status?: number; body?: { code?: string } }
type Outcome<T> = { ok: true; value: T } | { ok: false; error: CommandError }

type Seed = { tenantId: string; organizationId: string; userId: string; productId: string; categoryId: string }

function createDeferred(): Deferred {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((resolveDeferred) => { resolve = resolveDeferred })
  return { promise, resolve }
}

function createGate(spec: GateSpec): Gate {
  return { ...spec, fired: false, reached: createDeferred(), release: createDeferred() }
}

function entityNameOf(value: unknown): string | null {
  return typeof value === 'function' ? value.name : null
}

function gateMatches(gate: Gate, method: string, args: unknown[]): boolean {
  if (gate.fired || gate.method !== method) return false
  if (entityNameOf(args[0]) !== gate.entity) return false
  const options = args[2] as { lockMode?: LockMode } | undefined
  return (options?.lockMode ?? null) === (gate.lockMode ?? null)
}

function gatedFork(root: EntityManager, gate: Gate | null): EntityManager {
  const target = root.fork()
  return new Proxy(target, {
    get(object, property) {
      const value = Reflect.get(object, property, object)
      if (typeof value !== 'function') return value
      const bound = (value as (...args: unknown[]) => unknown).bind(object)
      if (!gate || property !== gate.method) return bound
      return async (...args: unknown[]) => {
        const matched = gateMatches(gate, property as string, args)
        const result = await bound(...args)
        if (matched) {
          gate.fired = true
          gate.reached.resolve()
          await gate.release.promise
        }
        return result
      }
    },
  })
}

async function settle<T>(promise: Promise<T>): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await promise }
  } catch (error) {
    return { ok: false, error: error as CommandError }
  }
}

describeWithPostgres('catalog category suggestions against real PostgreSQL concurrency', () => {
  let postgres: StartedTestContainer | null = null
  let orm: TestOrm | null = null

  function rootEm(): EntityManager {
    if (!orm) throw new Error('[internal] ORM is not started')
    return orm.em.fork()
  }

  async function waitForLockWaiters(count: number): Promise<void> {
    const deadline = Date.now() + WAITER_TIMEOUT_MS
    while (Date.now() < deadline) {
      const rows = await rootEm().execute<Array<{ waiting: number }>>(
        `select count(*)::int as waiting from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`,
      )
      if (rows[0].waiting >= count) return
      await new Promise((resolve) => setTimeout(resolve, WAITER_POLL_MS))
    }
    throw new Error(`[internal] no transaction started waiting on a row lock within ${WAITER_TIMEOUT_MS}ms`)
  }

  function catalogCtx(seed: Seed, gate: Gate | null = null) {
    const root = rootEm()
    return {
      auth: { sub: seed.userId, tenantId: seed.tenantId, orgId: seed.organizationId, isSuperAdmin: false },
      organizationScope: null,
      selectedOrganizationId: seed.organizationId,
      organizationIds: [seed.organizationId],
      request: undefined,
      container: {
        resolve: (name: string) => {
          if (name === 'em') {
            return new Proxy(root, {
              get(object, property) {
                if (property === 'fork') return () => gatedFork(root, gate)
                const value = Reflect.get(object, property, object)
                return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(object) : value
              },
            })
          }
          if (name === 'dataEngine') return { markOrmEntityChange: () => undefined }
          throw new Error(`[internal] unexpected resolve ${name}`)
        },
      } as unknown as AwilixContainer,
    }
  }

  async function seed(): Promise<Seed> {
    const seedData: Seed = {
      tenantId: randomUUID(),
      organizationId: randomUUID(),
      userId: randomUUID(),
      productId: randomUUID(),
      categoryId: randomUUID(),
    }
    const scope = { organizationId: seedData.organizationId, tenantId: seedData.tenantId }
    const em = rootEm()
    em.create(CatalogProduct, { ...scope, id: seedData.productId, title: 'Concurrency test product' })
    em.create(CatalogProductCategory, { ...scope, id: seedData.categoryId, name: 'Concurrency test category' })
    await em.flush()
    return seedData
  }

  async function pendingSuggestionId(seedData: Seed): Promise<string> {
    const em = rootEm()
    const rows = await em.execute<Array<{ id: string }>>(
      `select id from catalog_product_category_suggestions where product_id = ? and status = 'pending'`,
      [seedData.productId],
    )
    if (!rows[0]) throw new Error('[internal] no pending suggestion found')
    return rows[0].id
  }

  async function suggestionStatuses(productId: string): Promise<Array<{ id: string; status: string }>> {
    const em = rootEm()
    return em.execute<Array<{ id: string; status: string }>>(
      `select id, status from catalog_product_category_suggestions where product_id = ? order by created_at asc`,
      [productId],
    )
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
    orm = await MikroORM.init<PostgreSqlDriver, EntityManager<PostgreSqlDriver>>({
      driver: PostgreSqlDriver,
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      dbName: DATABASE_NAME,
      user: DATABASE_USER,
      password: DATABASE_PASSWORD,
      entities: [CatalogProduct, CatalogProductCategory, CatalogProductCategoryAssignment, CatalogProductCategorySuggestion],
      debug: false,
      pool: { min: 0, max: 8 },
    })
    await orm.schema.create()
  }, 120_000)

  afterAll(async () => {
    await Promise.allSettled([orm?.close(true)])
    await Promise.allSettled([postgres?.stop()])
  }, 30_000)

  // Regression for the R2 finding: MikroORM v7's UnitOfWork orders INSERT
  // changesets before UPDATE changesets within one flush. Flushing the
  // supersession and the replacement insert together races the new row's
  // INSERT against the still-`pending` old row and trips the partial unique
  // (product_id) WHERE status='pending' index. A second sequential run for
  // the same product is exactly the shape that hits this: it finds the first
  // run's row still pending and must supersede it before inserting its own.
  it('persists a second sequential suggestion for the same product without a unique-index conflict', async () => {
    const seedData = await seed()

    const first = await persistCategorySuggestion(rootEm(), {
      productId: seedData.productId,
      tenantId: seedData.tenantId,
      organizationId: seedData.organizationId,
      outcome: 'suggested',
      categoryId: seedData.categoryId,
      trigger: 'manual',
    })
    const second = await persistCategorySuggestion(rootEm(), {
      productId: seedData.productId,
      tenantId: seedData.tenantId,
      organizationId: seedData.organizationId,
      outcome: 'no_match',
      trigger: 'manual',
    })

    const rows = await suggestionStatuses(seedData.productId)
    expect(rows).toEqual([
      { id: first.id, status: 'superseded' },
      { id: second.id, status: 'pending' },
    ])
  }, CASE_TIMEOUT_MS)

  // Regression for the R3 finding: accept/reject must be single-winner
  // transactional operations. Two concurrent reviews of the same pending
  // suggestion must not both succeed.
  it('accept and reject racing the same suggestion: the first to lock wins, the second gets 409', async () => {
    const seedData = await seed()
    await persistCategorySuggestion(rootEm(), {
      productId: seedData.productId,
      tenantId: seedData.tenantId,
      organizationId: seedData.organizationId,
      outcome: 'suggested',
      categoryId: seedData.categoryId,
      trigger: 'manual',
    })
    const suggestionId = await pendingSuggestionId(seedData)
    const gate = createGate({ method: 'findOne', entity: 'CatalogProductCategorySuggestion', lockMode: LockMode.PESSIMISTIC_WRITE })

    const accepting = settle(acceptCategorySuggestionCommand.execute({ id: suggestionId }, catalogCtx(seedData, gate)))
    await gate.reached.promise
    const rejecting = settle(rejectCategorySuggestionCommand.execute({ id: suggestionId }, catalogCtx(seedData)))
    await waitForLockWaiters(1)
    gate.release.resolve()
    const [accepted, rejected] = await Promise.all([accepting, rejecting])

    expect(accepted.ok).toBe(true)
    expect(rejected.ok).toBe(false)
    if (!rejected.ok) {
      expect(rejected.error.status).toBe(409)
      expect(rejected.error.body?.code).toBe('suggestion_not_pending')
    }
    const rows = await suggestionStatuses(seedData.productId)
    expect(rows).toEqual([{ id: suggestionId, status: 'accepted' }])
  }, CASE_TIMEOUT_MS)

  it('two concurrent accepts of the same suggestion: one commits, the other gets 409', async () => {
    const seedData = await seed()
    await persistCategorySuggestion(rootEm(), {
      productId: seedData.productId,
      tenantId: seedData.tenantId,
      organizationId: seedData.organizationId,
      outcome: 'suggested',
      categoryId: seedData.categoryId,
      trigger: 'manual',
    })
    const suggestionId = await pendingSuggestionId(seedData)
    const gate = createGate({ method: 'findOne', entity: 'CatalogProductCategorySuggestion', lockMode: LockMode.PESSIMISTIC_WRITE })

    const first = settle(acceptCategorySuggestionCommand.execute({ id: suggestionId }, catalogCtx(seedData, gate)))
    await gate.reached.promise
    const second = settle(acceptCategorySuggestionCommand.execute({ id: suggestionId }, catalogCtx(seedData)))
    await waitForLockWaiters(1)
    gate.release.resolve()
    const [firstOutcome, secondOutcome] = await Promise.all([first, second])

    const outcomes = [firstOutcome, secondOutcome]
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1)
    const failed = outcomes.find((outcome) => !outcome.ok)
    if (failed && !failed.ok) {
      expect(failed.error.status).toBe(409)
      expect(failed.error.body?.code).toBe('suggestion_not_pending')
    }
    const rows = await suggestionStatuses(seedData.productId)
    expect(rows).toEqual([{ id: suggestionId, status: 'accepted' }])
  }, CASE_TIMEOUT_MS)

  // Regression for the R3 finding's undo portion: before the fix, accept's
  // undo synced categories and flushed on the bare EntityManager — no product
  // lock — then restored the suggestion's status in a *separate* transaction
  // that only locked the suggestion row. A concurrent new suggestion for the
  // same product (which locks the product first, same as accept/reject) could
  // insert between those two steps: undo's restore would then count zero
  // newer-pending rows, set the undone suggestion back to `pending`, and the
  // partial unique (product_id) WHERE status='pending' index would already
  // have two pending rows. The fix locks the product first, inside the same
  // transaction as both the category restore and the status restore, so the
  // two operations serialize instead of interleaving.
  it('undoing an accept races a concurrent new suggestion for the same product without corrupting state', async () => {
    const seedData = await seed()
    await persistCategorySuggestion(rootEm(), {
      productId: seedData.productId,
      tenantId: seedData.tenantId,
      organizationId: seedData.organizationId,
      outcome: 'suggested',
      categoryId: seedData.categoryId,
      trigger: 'manual',
    })
    const suggestionId = await pendingSuggestionId(seedData)
    const accepted = await settle(acceptCategorySuggestionCommand.execute({ id: suggestionId }, catalogCtx(seedData)))
    expect(accepted.ok).toBe(true)

    const logEntry = { commandPayload: { undo: { suggestionId, productId: seedData.productId, before: { categoryIds: [] } } } }
    const gate = createGate({ method: 'findOne', entity: 'CatalogProduct', lockMode: LockMode.PESSIMISTIC_WRITE })

    const undoing = settle(acceptCategorySuggestionCommand.undo!({ input: { id: suggestionId }, ctx: catalogCtx(seedData, gate), logEntry }))
    await gate.reached.promise
    const suggesting = settle(persistCategorySuggestion(rootEm(), {
      productId: seedData.productId,
      tenantId: seedData.tenantId,
      organizationId: seedData.organizationId,
      outcome: 'no_match',
      trigger: 'manual',
    }))
    await waitForLockWaiters(1)
    gate.release.resolve()
    const [undoOutcome, suggestOutcome] = await Promise.all([undoing, suggesting])

    expect(undoOutcome.ok).toBe(true)
    expect(suggestOutcome.ok).toBe(true)

    const rows = await suggestionStatuses(seedData.productId)
    expect(rows).toEqual([
      { id: suggestionId, status: 'superseded' },
      { id: suggestOutcome.ok ? suggestOutcome.value.id : '', status: 'pending' },
    ])

    const assignments = await rootEm().find(CatalogProductCategoryAssignment, { product: seedData.productId })
    expect(assignments).toHaveLength(0)
  }, CASE_TIMEOUT_MS)
})
