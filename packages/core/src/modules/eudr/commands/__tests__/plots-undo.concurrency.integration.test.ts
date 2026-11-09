/** @jest-environment node */
import { randomUUID } from 'node:crypto'
import { EntityManager as CoreEntityManager, MikroORM } from '@mikro-orm/core'
import { PostgreSqlDriver, type EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { StartedTestContainer } from 'testcontainers'
import { commandRegistry } from '@open-mercato/shared/lib/commands'
import { CustomFieldDef, CustomFieldValue } from '@open-mercato/core/modules/entities/data/entities'
import { setRecordCustomFields } from '@open-mercato/core/modules/entities/lib/helpers'
import { EudrPlot } from '../../data/entities'
import '../plots'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({ translate: (_key: string, fallback?: string) => fallback ?? _key }),
}))

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

const DATABASE_NAME = 'eudr_undo_cas_test'
const DATABASE_USER = 'eudr_undo_cas'
const DATABASE_PASSWORD = 'eudr_undo_cas'
const PLOT_ENTITY_ID = 'eudr:eudr_plot'
const CASE_TIMEOUT_MS = 30_000
const WAITER_POLL_MS = 25
const WAITER_TIMEOUT_MS = 10_000
const POLYGON = {
  type: 'Polygon',
  coordinates: [[[-47.9, -15.8], [-47.9, -15.79], [-47.89, -15.79], [-47.89, -15.8], [-47.9, -15.8]]],
}

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

type Scope = { tenantId: string; organizationId: string; userId: string }

type PlotState = { name: string; deleted: boolean; grade: string | null }

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

describeWithPostgres('EUDR plot undo against later plot writes on real PostgreSQL', () => {
  let postgres: StartedTestContainer | null = null
  let orm: TestOrm | null = null
  let gate: Gate | null = null

  function rootEm(): EntityManager {
    if (!orm) throw new Error('[internal] ORM is not started')
    return orm.em.fork()
  }

  const dataEngine = {
    markOrmEntityChange: () => undefined,
    flushOrmEntityChanges: async () => undefined,
    setCustomFields: async (opts: {
      entityId: string
      recordId: string
      organizationId?: string | null
      tenantId?: string | null
      values: Record<string, unknown>
    }) => {
      await setRecordCustomFields(rootEm(), opts)
    },
  }

  function plotCtx(scope: Scope) {
    const root = rootEm()
    return {
      auth: { sub: scope.userId, tenantId: scope.tenantId, orgId: scope.organizationId, roles: [], isSuperAdmin: false },
      selectedOrganizationId: scope.organizationId,
      organizationIds: [scope.organizationId],
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

  async function newScope(): Promise<Scope> {
    const scope: Scope = { tenantId: randomUUID(), organizationId: randomUUID(), userId: randomUUID() }
    const em = rootEm()
    em.create(CustomFieldDef, {
      entityId: PLOT_ENTITY_ID,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      key: 'grade',
      kind: 'text',
      isActive: true,
    })
    await em.flush()
    return scope
  }

  function serialize(payload: unknown): { commandPayload: unknown } {
    return { commandPayload: JSON.parse(JSON.stringify(payload)) }
  }

  async function createPlot(scope: Scope): Promise<{ plotId: string; logEntry: { commandPayload: unknown } }> {
    const command = handler('eudr.plots.create')
    const ctx = plotCtx(scope)
    const input = {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      supplierEntityId: randomUUID(),
      name: 'North field',
      originCountry: 'BR',
      geometry: POLYGON,
    }
    const result = (await command.execute(input, ctx)) as { entityId: string }
    const after = await command.captureAfter!(input, result, ctx)
    const log = await command.buildLog!({ snapshots: { after }, result, ctx })
    return { plotId: result.entityId, logEntry: serialize(log?.payload) }
  }

  async function updatePlot(scope: Scope, plotId: string, patch: Record<string, unknown>): Promise<{ commandPayload: unknown }> {
    const command = handler('eudr.plots.update')
    const input = { id: plotId, tenantId: scope.tenantId, organizationId: scope.organizationId, ...patch }
    const ctx = plotCtx(scope)
    const before = await command.prepare!(input, ctx)
    const result = await command.execute(input, ctx)
    const after = await command.captureAfter!(input, result, ctx)
    const log = await command.buildLog!({ snapshots: { ...before, after }, result, ctx })
    return serialize(log?.payload)
  }

  async function undo(commandId: string, scope: Scope, logEntry: unknown): Promise<Outcome<void>> {
    return settle(handler(commandId).undo({ logEntry, ctx: plotCtx(scope) }))
  }

  async function readState(plotId: string): Promise<PlotState> {
    const [row] = await rootEm().execute<Array<{ name: string; deleted_at: Date | null }>>(
      'select name, deleted_at from eudr_plots where id = ?',
      [plotId],
    )
    const [custom] = await rootEm().execute<Array<{ value_text: string | null }>>(
      "select value_text from custom_field_values where record_id = ? and field_key = 'grade' and deleted_at is null",
      [plotId],
    )
    return { name: row.name, deleted: row.deleted_at !== null, grade: custom?.value_text ?? null }
  }

  function expectConflict(outcome: Outcome<void>) {
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error.status).toBe(409)
    expect(outcome.error.body?.code).toBe('eudr.errors.undoConflict')
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
        `select count(*)::int as waiting
           from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock' and query ilike '%eudr_plots%'`,
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
      entities: [EudrPlot, CustomFieldDef, CustomFieldValue],
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
      if (current?.armed && args[0] === EudrPlot) {
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

  it('restores an update that nothing changed since, without a false conflict on real timestamps, numerics and jsonb', async () => {
    const scope = await newScope()
    const { plotId } = await createPlot(scope)
    const logEntry = await updatePlot(scope, plotId, { name: 'North field (surveyed)' })

    const undone = await undo('eudr.plots.update', scope, logEntry)

    expect(undone.ok).toBe(true)
    expect(await readState(plotId)).toEqual({ name: 'North field', deleted: false, grade: null })
  }, CASE_TIMEOUT_MS)

  it('undoes a create and two updates newest first, including a custom field reset to empty', async () => {
    const scope = await newScope()
    const created = await createPlot(scope)
    const first = await updatePlot(scope, created.plotId, { name: 'North field (surveyed)' })
    const second = await updatePlot(scope, created.plotId, { customFields: { grade: 'A' } })

    const undoneSecond = await undo('eudr.plots.update', scope, second)
    const undoneFirst = await undo('eudr.plots.update', scope, first)
    const undoneCreate = await undo('eudr.plots.create', scope, created.logEntry)

    expect([undoneSecond.ok, undoneFirst.ok, undoneCreate.ok]).toEqual([true, true, true])
    expect(await readState(created.plotId)).toEqual({ name: 'North field', deleted: true, grade: null })
  }, CASE_TIMEOUT_MS)

  it('refuses the undo of an older update once another user renamed the plot', async () => {
    const scope = await newScope()
    const { plotId } = await createPlot(scope)
    const logEntry = await updatePlot(scope, plotId, { name: 'North field (surveyed)' })
    await updatePlot(scope, plotId, { name: 'North field (re-surveyed)' })

    const undone = await undo('eudr.plots.update', scope, logEntry)

    expectConflict(undone)
    expect(await readState(plotId)).toEqual({ name: 'North field (re-surveyed)', deleted: false, grade: null })
  }, CASE_TIMEOUT_MS)

  it('refuses the undo of an older update once another user changed only a custom field', async () => {
    const scope = await newScope()
    const { plotId } = await createPlot(scope)
    const logEntry = await updatePlot(scope, plotId, { name: 'North field (surveyed)' })
    await updatePlot(scope, plotId, { customFields: { grade: 'B' } })

    const undone = await undo('eudr.plots.update', scope, logEntry)

    expectConflict(undone)
    expect(await readState(plotId)).toEqual({ name: 'North field (surveyed)', deleted: false, grade: 'B' })
  }, CASE_TIMEOUT_MS)

  it('keeps a rename that lands while the undo is between its read and its write', async () => {
    const scope = await newScope()
    const { plotId } = await createPlot(scope)
    const logEntry = await updatePlot(scope, plotId, { name: 'North field (surveyed)' })
    gate = createGate()

    const undoing = undo('eudr.plots.update', scope, logEntry)
    await gate.reached.promise
    const renaming = settle(updatePlot(scope, plotId, { name: 'North field (re-surveyed)' }))
    await waitForLockWaiterOrSettled(renaming)
    gate.release.resolve()
    const [undone, renamed] = await Promise.all([undoing, renaming])

    expect(undone.ok).toBe(true)
    expect(renamed.ok).toBe(true)
    expect((await readState(plotId)).name).toBe('North field (re-surveyed)')
  }, CASE_TIMEOUT_MS)

  it('refuses the undo of a create once another user edited the plot', async () => {
    const scope = await newScope()
    const created = await createPlot(scope)
    await updatePlot(scope, created.plotId, { name: 'North field (surveyed)' })

    const undone = await undo('eudr.plots.create', scope, created.logEntry)

    expectConflict(undone)
    expect(await readState(created.plotId)).toEqual({ name: 'North field (surveyed)', deleted: false, grade: null })
  }, CASE_TIMEOUT_MS)
})
