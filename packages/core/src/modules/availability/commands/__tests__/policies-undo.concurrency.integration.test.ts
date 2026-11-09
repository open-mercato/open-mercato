/** @jest-environment node */
import { randomUUID } from 'node:crypto'
import { EntityManager as CoreEntityManager, MikroORM } from '@mikro-orm/core'
import { PostgreSqlDriver, type EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { StartedTestContainer } from 'testcontainers'
import { commandRegistry } from '@open-mercato/shared/lib/commands'
import { AvailabilityPolicy } from '../../data/entities'
import '../policies'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({ translate: (_key: string, fallback?: string) => fallback ?? _key }),
}))

jest.mock('../../lib/catalogTarget', () => ({
  findCatalogTargetIssue: jest.fn(async () => null),
}))

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

const DATABASE_NAME = 'availability_undo_cas_test'
const DATABASE_USER = 'availability_undo_cas'
const DATABASE_PASSWORD = 'availability_undo_cas'
const CASE_TIMEOUT_MS = 30_000
const WAITER_POLL_MS = 25
const WAITER_TIMEOUT_MS = 10_000

type TestOrm = MikroORM<PostgreSqlDriver, EntityManager<PostgreSqlDriver>>

type Deferred = { promise: Promise<void>; resolve: () => void }

type Gate = { armed: boolean; reached: Deferred; release: Deferred }

type CommandError = { status?: number; body?: { code?: string } }

type Outcome<T> = { ok: true; value: T } | { ok: false; error: CommandError }

type Handler = {
  execute: (input: unknown, ctx: unknown) => Promise<unknown>
  undo: (args: { logEntry: unknown; ctx: unknown }) => Promise<void>
  prepare?: (input: unknown, ctx: unknown) => Promise<Record<string, unknown>>
  captureAfter?: (input: unknown, result: unknown, ctx: unknown) => Promise<unknown>
  buildLog?: (args: { snapshots: Record<string, unknown>; result?: unknown; ctx?: unknown }) => Promise<{ payload: unknown } | null>
}

type Seed = { tenantId: string; organizationId: string; userId: string; policyId: string }

type PolicyState = { isActive: boolean; minOrderQuantity: number | null }

function createDeferred(): Deferred {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((resolveDeferred) => {
    resolve = resolveDeferred
  })
  return { promise, resolve }
}

function createGate(): Gate {
  return { armed: true, reached: createDeferred(), release: createDeferred() }
}

async function settle<T>(promise: Promise<T>): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await promise }
  } catch (error) {
    return { ok: false, error: error as CommandError }
  }
}

function handler(id: string): Handler {
  const registered = commandRegistry.get(id) as unknown as Handler | undefined
  if (!registered) throw new Error(`[internal] command ${id} is not registered`)
  return registered
}

describeWithPostgres('availability policy undo against later policy writes on real PostgreSQL', () => {
  let postgres: StartedTestContainer | null = null
  let orm: TestOrm | null = null
  let gate: Gate | null = null
  const dataEngine = {
    markOrmEntityChange: () => undefined,
    flushOrmEntityChanges: async () => undefined,
  }

  function rootEm(): EntityManager {
    if (!orm) throw new Error('[internal] ORM is not started')
    return orm.em.fork()
  }

  function policyCtx(seed: Seed) {
    const root = rootEm()
    return {
      auth: { sub: seed.userId, tenantId: seed.tenantId, orgId: seed.organizationId, roles: [], isSuperAdmin: false },
      selectedOrganizationId: seed.organizationId,
      organizationIds: [seed.organizationId],
      organizationScope: null,
      container: {
        resolve: (name: string) => {
          if (name === 'em') return root
          if (name === 'dataEngine') return dataEngine
          throw new Error(`[internal] unexpected resolve ${name}`)
        },
      } as unknown as AwilixContainer,
    }
  }

  async function seedPolicy(): Promise<Seed> {
    const seed: Seed = { tenantId: randomUUID(), organizationId: randomUUID(), userId: randomUUID(), policyId: randomUUID() }
    const em = rootEm()
    em.create(AvailabilityPolicy, {
      id: seed.policyId,
      tenantId: seed.tenantId,
      organizationId: seed.organizationId,
      productId: randomUUID(),
      isActive: true,
      minOrderQuantity: null,
    })
    await em.flush()
    return seed
  }

  async function runUpdate(seed: Seed, patch: Record<string, unknown>): Promise<unknown> {
    const command = handler('availability.policies.update')
    const input = { id: seed.policyId, tenantId: seed.tenantId, organizationId: seed.organizationId, ...patch }
    const ctx = policyCtx(seed)
    const before = await command.prepare!(input, ctx)
    const result = await command.execute(input, ctx)
    const after = await command.captureAfter!(input, result, ctx)
    const log = await command.buildLog!({ snapshots: { ...before, after }, result, ctx })
    return { commandPayload: log?.payload }
  }

  async function readState(seed: Seed): Promise<PolicyState> {
    const [row] = await rootEm().execute<Array<{ is_active: boolean; min_order_quantity: number | null }>>(
      'select is_active, min_order_quantity from availability_policies where id = ?',
      [seed.policyId],
    )
    return { isActive: row.is_active, minOrderQuantity: row.min_order_quantity }
  }

  async function waitForLockWaiterOrSettled(pending: Promise<unknown>): Promise<void> {
    let settled = false
    void pending.then(() => {
      settled = true
    })
    const deadline = Date.now() + WAITER_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (settled) return
      const rows = await rootEm().execute<Array<{ waiting: number }>>(
        `select count(*)::int as waiting from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`,
      )
      if (rows[0].waiting >= 1) return
      await new Promise((resolve) => setTimeout(resolve, WAITER_POLL_MS))
    }
    throw new Error(`[internal] the concurrent update neither finished nor waited on a lock within ${WAITER_TIMEOUT_MS}ms`)
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
      entities: [AvailabilityPolicy],
      debug: false,
      pool: { min: 0, max: 8 },
    })
    await orm.schema.create()
    const originalFindOne = CoreEntityManager.prototype.findOne
    jest.spyOn(CoreEntityManager.prototype, 'findOne').mockImplementation(async function gatedFindOne(
      this: CoreEntityManager,
      ...args: Parameters<CoreEntityManager['findOne']>
    ) {
      const result = await (originalFindOne as (...callArgs: unknown[]) => Promise<unknown>).apply(this, args)
      const current = gate
      if (current?.armed && args[0] === AvailabilityPolicy) {
        current.armed = false
        current.reached.resolve()
        await current.release.promise
      }
      return result
    } as unknown as CoreEntityManager['findOne'])
  }, 120_000)

  afterEach(() => {
    gate = null
  })

  afterAll(async () => {
    jest.restoreAllMocks()
    await Promise.allSettled([orm?.close(true)])
    await Promise.allSettled([postgres?.stop()])
  }, 30_000)

  it('restores an update that nothing changed since, without a false conflict on real timestamps', async () => {
    const seed = await seedPolicy()
    const logEntry = await runUpdate(seed, { minOrderQuantity: 5 })

    const undone = await settle(handler('availability.policies.update').undo({ logEntry, ctx: policyCtx(seed) }))

    expect(undone.ok).toBe(true)
    expect(await readState(seed)).toEqual({ isActive: true, minOrderQuantity: null })
  }, CASE_TIMEOUT_MS)

  it('undoes two updates newest first without a false conflict', async () => {
    const seed = await seedPolicy()
    const first = await runUpdate(seed, { minOrderQuantity: 5 })
    const second = await runUpdate(seed, { minOrderQuantity: 10 })

    const undoneSecond = await settle(handler('availability.policies.update').undo({ logEntry: second, ctx: policyCtx(seed) }))
    const undoneFirst = await settle(handler('availability.policies.update').undo({ logEntry: first, ctx: policyCtx(seed) }))

    expect(undoneSecond.ok).toBe(true)
    expect(undoneFirst.ok).toBe(true)
    expect(await readState(seed)).toEqual({ isActive: true, minOrderQuantity: null })
  }, CASE_TIMEOUT_MS)

  it('refuses the undo of an older update once another actor deactivated the policy', async () => {
    const seed = await seedPolicy()
    const logEntry = await runUpdate(seed, { minOrderQuantity: 5 })
    await runUpdate(seed, { isActive: false })

    const undone = await settle(handler('availability.policies.update').undo({ logEntry, ctx: policyCtx(seed) }))

    expect(undone.ok).toBe(false)
    if (!undone.ok) {
      expect(undone.error.status).toBe(409)
      expect(undone.error.body?.code).toBe('availability.policies.errors.undoConflict')
    }
    expect(await readState(seed)).toEqual({ isActive: false, minOrderQuantity: 5 })
  }, CASE_TIMEOUT_MS)

  it('keeps a quantity change that lands while the undo is between its read and its write', async () => {
    const seed = await seedPolicy()
    const logEntry = await runUpdate(seed, { minOrderQuantity: 5 })
    gate = createGate()

    const undoing = settle(handler('availability.policies.update').undo({ logEntry, ctx: policyCtx(seed) }))
    await gate.reached.promise
    const changing = settle(runUpdate(seed, { minOrderQuantity: 10 }))
    await waitForLockWaiterOrSettled(changing)
    gate.release.resolve()
    const [undone, changed] = await Promise.all([undoing, changing])

    expect(undone.ok).toBe(true)
    expect(changed.ok).toBe(true)
    expect(await readState(seed)).toEqual({ isActive: true, minOrderQuantity: 10 })
  }, CASE_TIMEOUT_MS)

  it('refuses the undo of a create once another actor edited the policy', async () => {
    const seed = await seedPolicy()
    const createLog = await (async () => {
      const command = handler('availability.policies.create')
      const ctx = policyCtx(seed)
      const input = { tenantId: seed.tenantId, organizationId: seed.organizationId, productId: randomUUID(), isActive: true }
      const result = (await command.execute(input, ctx)) as { policyId: string }
      const after = await command.captureAfter!(input, result, ctx)
      const log = await command.buildLog!({ snapshots: { after }, result, ctx })
      return { policyId: result.policyId, logEntry: { commandPayload: log?.payload } }
    })()
    const created: Seed = { ...seed, policyId: createLog.policyId }
    await runUpdate(created, { isActive: false })

    const undone = await settle(handler('availability.policies.create').undo({ logEntry: createLog.logEntry, ctx: policyCtx(created) }))

    expect(undone.ok).toBe(false)
    if (!undone.ok) expect(undone.error.status).toBe(409)
    const [row] = await rootEm().execute<Array<{ deleted_at: Date | null }>>(
      'select deleted_at from availability_policies where id = ?',
      [created.policyId],
    )
    expect(row.deleted_at).toBeNull()
  }, CASE_TIMEOUT_MS)
})
