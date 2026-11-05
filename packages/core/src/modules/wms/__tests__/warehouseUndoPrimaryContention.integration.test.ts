/** @jest-environment node */
import { randomUUID } from 'node:crypto'
import { MikroORM } from '@mikro-orm/core'
import { PostgreSqlDriver, type EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { StartedTestContainer } from 'testcontainers'
import { commandRegistry } from '@open-mercato/shared/lib/commands'
import { Warehouse, WarehouseZone } from '../data/entities'
import '../commands/configuration'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({ translate: (_key: string, fallback?: string) => fallback ?? _key }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn((em: { find: (...args: unknown[]) => unknown }, ...args: unknown[]) => em.find(...args.slice(0, 3))),
  findOneWithDecryption: jest.fn((em: { findOne: (...args: unknown[]) => unknown }, ...args: unknown[]) => em.findOne(...args.slice(0, 3))),
}))

jest.mock('@open-mercato/shared/lib/commands/customFieldSnapshots', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/commands/customFieldSnapshots'),
  loadCustomFieldSnapshot: jest.fn(async () => ({})),
}))

jest.mock('../events', () => ({
  emitWmsEvent: jest.fn().mockResolvedValue(undefined),
}))

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

const DATABASE_NAME = 'wms_warehouse_undo_test'
const DATABASE_USER = 'wms_warehouse_undo'
const DATABASE_PASSWORD = 'wms_warehouse_undo'
const CASE_TIMEOUT_MS = 30_000
const WAITER_POLL_MS = 25
const WAITER_TIMEOUT_MS = 10_000

type TestOrm = MikroORM<PostgreSqlDriver, EntityManager<PostgreSqlDriver>>

type Deferred = { promise: Promise<void>; resolve: () => void }

type CommandError = { status?: number; body?: { fieldErrors?: Record<string, string> } }

type Outcome = { ok: true } | { ok: false; error: CommandError }

type Handler = {
  execute: (input: unknown, ctx: unknown) => Promise<Record<string, unknown>>
  undo: (args: { logEntry: unknown; ctx: unknown }) => Promise<void>
  prepare?: (input: unknown, ctx: unknown) => Promise<{ before?: unknown }>
  captureAfter?: (input: unknown, result: unknown, ctx: unknown) => Promise<unknown>
  buildLog?: (args: { input: unknown; result: unknown; ctx: unknown; snapshots: unknown }) => Promise<{ payload?: unknown } | null>
}

type Scope = { tenantId: string; organizationId: string; userId: string }

type WarehouseRow = { id: string; name: string; is_primary: boolean; deleted_at: Date | null }

type Contender = { commit: () => Promise<void> }

function createDeferred(): Deferred {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((resolveDeferred) => {
    resolve = resolveDeferred
  })
  return { promise, resolve }
}

function handler(id: string): Handler {
  const registered = commandRegistry.get(id) as unknown as Handler | undefined
  if (!registered) throw new Error(`[internal] command ${id} is not registered`)
  return registered
}

async function settle(promise: Promise<unknown>): Promise<Outcome> {
  try {
    await promise
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error as CommandError }
  }
}

describeWithPostgres('WMS warehouse undo against a concurrent primary promotion on real PostgreSQL', () => {
  let postgres: StartedTestContainer | null = null
  let orm: TestOrm | null = null
  const dataEngine = {
    setCustomFields: jest.fn().mockResolvedValue(undefined),
    markOrmEntityChange: jest.fn(),
    flushOrmEntityChanges: jest.fn().mockResolvedValue(undefined),
  }

  function rootEm(): EntityManager {
    if (!orm) throw new Error('[internal] ORM is not started')
    return orm.em.fork()
  }

  function commandCtx(scope: Scope) {
    const root = rootEm()
    return {
      auth: { sub: scope.userId, tenantId: scope.tenantId, orgId: scope.organizationId, roles: [], isSuperAdmin: false },
      selectedOrganizationId: scope.organizationId,
      container: {
        resolve: (name: string) => {
          if (name === 'em') return root
          if (name === 'dataEngine') return dataEngine
          throw new Error(`[internal] unexpected resolve ${name}`)
        },
      } as unknown as AwilixContainer,
    }
  }

  async function runCommand(scope: Scope, id: string, input: Record<string, unknown>) {
    const command = handler(id)
    const ctx = commandCtx(scope)
    const commandInput = { tenantId: scope.tenantId, organizationId: scope.organizationId, ...input }
    const prepared = command.prepare ? await command.prepare(commandInput, ctx) : {}
    const result = await command.execute(commandInput, ctx)
    const after = command.captureAfter ? await command.captureAfter(commandInput, result, ctx) : null
    const log = await command.buildLog?.({ input: commandInput, result, ctx, snapshots: { before: prepared?.before ?? null, after } })
    return { result, logEntry: JSON.parse(JSON.stringify({ commandPayload: log?.payload ?? null })) }
  }

  function seedScope(): Scope {
    return { tenantId: randomUUID(), organizationId: randomUUID(), userId: randomUUID() }
  }

  async function seedWarehouse(scope: Scope, code: string, isPrimary: boolean): Promise<string> {
    const em = rootEm()
    const warehouse = em.create(Warehouse, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      name: `Warehouse ${code}`,
      code,
      isActive: true,
      isPrimary,
    })
    await em.flush()
    return warehouse.id
  }

  async function setPrimary(id: string, isPrimary: boolean): Promise<void> {
    await rootEm().execute('update wms_warehouses set is_primary = ? where id = ?', [isPrimary, id])
  }

  async function holdPrimaryPromotion(id: string): Promise<Contender> {
    const acquired = createDeferred()
    const release = createDeferred()
    const done = rootEm().transactional(async (tem) => {
      await tem.execute('update wms_warehouses set is_primary = true where id = ?', [id])
      acquired.resolve()
      await release.promise
    })
    await Promise.race([acquired.promise, done])
    return {
      commit: async () => {
        release.resolve()
        await done
      },
    }
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
    throw new Error(`[internal] no transaction started waiting on the primary index within ${WAITER_TIMEOUT_MS}ms`)
  }

  async function readWarehouses(scope: Scope): Promise<Map<string, WarehouseRow>> {
    const rows = await rootEm().execute<WarehouseRow[]>(
      'select id, name, is_primary, deleted_at from wms_warehouses where organization_id = ?',
      [scope.organizationId],
    )
    return new Map(rows.map((row) => [row.id, row]))
  }

  async function livePrimaryIds(scope: Scope): Promise<string[]> {
    const rows = await readWarehouses(scope)
    return [...rows.values()].filter((row) => row.is_primary && row.deleted_at === null).map((row) => row.id)
  }

  async function undoWhileContenderCommits(scope: Scope, commandId: string, logEntry: unknown, contender: Contender) {
    const undo = settle(handler(commandId).undo({ logEntry, ctx: commandCtx(scope) }))
    await waitForLockWaiters(1)
    await contender.commit()
    return undo
  }

  function expectPrimaryConflict(outcome: Outcome): void {
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error.status).toBe(409)
    expect(outcome.error.body?.fieldErrors?.isPrimary).toBe(
      'Another warehouse was just set as primary for this organization. Please retry.',
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
      entities: [Warehouse, WarehouseZone],
      debug: false,
      pool: { min: 0, max: 6 },
    })
    await orm.schema.create()
  }, 120_000)

  afterAll(async () => {
    await orm?.close(true)
    await postgres?.stop()
  })

  it('create undo rolls back its deletion and primary restore on a concurrent promotion, then the same undo retries cleanly', async () => {
    const scope = seedScope()
    const formerPrimaryId = await seedWarehouse(scope, 'FORMER', true)
    const contenderId = await seedWarehouse(scope, 'CONTENDER', false)
    const { result, logEntry } = await runCommand(scope, 'wms.warehouses.create', {
      name: 'Created primary',
      code: 'CREATED',
      isPrimary: true,
    })
    const createdId = result.warehouseId as string
    expect(result.demotedPrimariesBefore).toEqual([{ id: formerPrimaryId, isPrimary: true }])
    await setPrimary(createdId, false)

    const contender = await holdPrimaryPromotion(contenderId)
    const rejected = await undoWhileContenderCommits(scope, 'wms.warehouses.create', logEntry, contender)

    expectPrimaryConflict(rejected)
    const afterConflict = await readWarehouses(scope)
    expect(afterConflict.get(createdId)?.deleted_at).toBeNull()
    expect(afterConflict.get(formerPrimaryId)?.is_primary).toBe(false)
    expect(await livePrimaryIds(scope)).toEqual([contenderId])

    await setPrimary(contenderId, false)
    await handler('wms.warehouses.create').undo({ logEntry, ctx: commandCtx(scope) })

    const afterRetry = await readWarehouses(scope)
    expect(afterRetry.get(createdId)?.deleted_at).not.toBeNull()
    expect(await livePrimaryIds(scope)).toEqual([formerPrimaryId])
  }, CASE_TIMEOUT_MS)

  it('update undo rolls back its field and primary restore on a concurrent promotion, then the same undo retries cleanly', async () => {
    const scope = seedScope()
    const primaryId = await seedWarehouse(scope, 'MAIN', true)
    const contenderId = await seedWarehouse(scope, 'CONTENDER', false)
    const { logEntry } = await runCommand(scope, 'wms.warehouses.update', {
      id: primaryId,
      name: 'Renamed main',
      isPrimary: false,
    })
    expect(await livePrimaryIds(scope)).toEqual([])

    const contender = await holdPrimaryPromotion(contenderId)
    const rejected = await undoWhileContenderCommits(scope, 'wms.warehouses.update', logEntry, contender)

    expectPrimaryConflict(rejected)
    const afterConflict = await readWarehouses(scope)
    expect(afterConflict.get(primaryId)?.name).toBe('Renamed main')
    expect(afterConflict.get(primaryId)?.is_primary).toBe(false)
    expect(await livePrimaryIds(scope)).toEqual([contenderId])

    await setPrimary(contenderId, false)
    await handler('wms.warehouses.update').undo({ logEntry, ctx: commandCtx(scope) })

    const afterRetry = await readWarehouses(scope)
    expect(afterRetry.get(primaryId)?.name).toBe('Warehouse MAIN')
    expect(await livePrimaryIds(scope)).toEqual([primaryId])
  }, CASE_TIMEOUT_MS)
})
