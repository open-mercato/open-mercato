/** @jest-environment node */

import { randomUUID } from 'node:crypto'
import { MikroORM } from '@mikro-orm/core'
import { PostgreSqlDriver, type EntityManager } from '@mikro-orm/postgresql'
import { SqlEntityManager } from '@mikro-orm/sql'
import type { StartedTestContainer } from 'testcontainers'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import {
  InventoryBalance,
  InventoryLot,
  InventoryMovement,
  Warehouse,
  WarehouseLocation,
  WarehouseZone,
} from '../../data/entities'
import { applyInventoryImport } from '../inventoryImportService'
import '../../commands/inventory-actions'

jest.mock('../../events', () => ({
  emitWmsEvent: jest.fn(async () => undefined),
}))

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

const DATABASE_NAME = 'wms_import_row_lock_pool_test'
const DATABASE_USER = 'wms_import_row_lock_pool'
const DATABASE_PASSWORD = 'wms_import_row_lock_pool'
const CASE_TIMEOUT_MS = 30_000
const CONTENDERS = 3
const DELTA = 5
const LOCK_WAITER_DEADLINE_MS = 5_000

const TENANT = randomUUID()
const ORG = randomUUID()
const USER_ID = randomUUID()
const WAREHOUSE_ID = randomUUID()
const LOCATION_ID = randomUUID()
const VARIANT_ID = randomUUID()

type TestOrm = MikroORM<PostgreSqlDriver, EntityManager<PostgreSqlDriver>>

type ApplyResult = Awaited<ReturnType<typeof applyInventoryImport>>

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((resolveDeferred) => {
    resolve = resolveDeferred
  })
  return { promise, resolve }
}

// The per-row advisory lock blocks on the connection that holds it (unlike the shared
// withAdvisoryXactLock helper's try-lock-and-backoff, it does not release the connection
// between attempts), so every concurrent holder needs exactly one pooled connection for
// the whole check-then-adjust section. A pool sized to match the contenders exactly
// proves that: if wms.inventory.adjust ever forked a second connection of its own again,
// the holder actually writing the movement would need a connection the pool has no spare
// slot for once the other contenders are genuinely blocked on the same lock, and this
// test would fail instead of completing. A gate on the lock's own SQL call (the only
// reliable way to force that overlap — otherwise a fast local Postgres clears the whole
// race before a second contender ever blocks) holds the winner between acquiring the
// lock and running the adjust, until the other contenders are confirmed waiting on it.
describeWithPostgres('applyInventoryImport row lock under a pool sized to the contenders', () => {
  let postgres: StartedTestContainer | null = null
  let orm: TestOrm | null = null
  let monitorClient: { query: (sql: string) => Promise<{ rows: Array<{ c: number }> }>; end: () => Promise<void> } | null = null

  const commandBusStub = {
    execute: async (commandId: string, options: { input: unknown; ctx: CommandRuntimeContext }) => {
      const handler = commandRegistry.get(commandId)
      if (!handler) throw new Error(`[internal] no handler registered for ${commandId}`)
      const result = await handler.execute(options.input, options.ctx)
      return { result }
    },
  }

  function rootEm(): EntityManager {
    if (!orm) throw new Error('[internal] ORM is not running')
    return orm.em.fork({ disableContextResolution: true })
  }

  function createRequestEm(): EntityManager {
    if (!orm) throw new Error('[internal] ORM is not running')
    return orm.em.fork({ clear: true, freshEventManager: true, useContext: true })
  }

  function buildCtx(em: EntityManager): CommandRuntimeContext {
    return {
      container: {
        resolve: (name: string) => {
          if (name === 'em') return em
          if (name === 'commandBus') return commandBusStub
          if (name === 'rbacService') return { userHasAllFeatures: async () => true }
          throw new Error(`Unexpected resolve: ${name}`)
        },
      },
      auth: { sub: USER_ID, tenantId: TENANT, orgId: ORG },
      organizationScope: null,
      selectedOrganizationId: ORG,
      organizationIds: [ORG],
    } as unknown as CommandRuntimeContext
  }

  async function applyContendedRow(importBatchId: string): Promise<ApplyResult> {
    const ctx = buildCtx(createRequestEm())
    return applyInventoryImport(ctx, {
      organizationId: ORG,
      tenantId: TENANT,
      importBatchId,
      reason: 'Contended row pool test',
      mode: 'additive',
      continueOnError: false,
      performedBy: USER_ID,
      rows: [
        {
          rowNumber: 1,
          warehouseId: WAREHOUSE_ID,
          locationId: LOCATION_ID,
          catalogVariantId: VARIANT_ID,
          quantity: DELTA,
          delta: DELTA,
        },
      ],
    } as never)
  }

  async function seedWarehouseAndLocation(): Promise<void> {
    const em = rootEm()
    const warehouse = em.create(Warehouse, {
      id: WAREHOUSE_ID,
      organizationId: ORG,
      tenantId: TENANT,
      name: 'Contended row pool warehouse',
      code: `WH-${WAREHOUSE_ID.slice(0, 8)}`,
    })
    em.persist(warehouse)
    const location = em.create(WarehouseLocation, {
      id: LOCATION_ID,
      organizationId: ORG,
      tenantId: TENANT,
      warehouse,
      code: `LOC-${LOCATION_ID.slice(0, 8)}`,
      type: 'bin',
    })
    em.persist(location)
    await em.flush()
  }

  // Holds the first contender right after it acquires the per-row advisory lock (and
  // before it runs wms.inventory.adjust) until the other contenders are confirmed
  // genuinely blocked on that same lock at the Postgres level — the only way to force
  // the overlap this test needs, since a local Postgres otherwise clears all three
  // requests before a second one ever blocks.
  function gateFirstLockAcquisition(): { release: () => void } {
    const gate = createDeferred()
    let gated = false
    const originalExecute = SqlEntityManager.prototype.execute
    jest.spyOn(SqlEntityManager.prototype, 'execute').mockImplementation(async function (
      this: EntityManager,
      query: unknown,
      ...rest: unknown[]
    ) {
      const isRowLockSql = typeof query === 'string' && query.includes('pg_advisory_xact_lock')
      const call = (originalExecute as (...args: unknown[]) => Promise<unknown>).apply(this, [query, ...rest])
      if (isRowLockSql && !gated) {
        gated = true
        const result = await call
        await gate.promise
        return result
      }
      return call
    } as never)
    return { release: gate.resolve }
  }

  async function waitForLockWaiters(count: number): Promise<void> {
    if (!monitorClient) throw new Error('[internal] monitor client is not connected')
    const deadline = Date.now() + LOCK_WAITER_DEADLINE_MS
    while (Date.now() < deadline) {
      const result = await monitorClient.query(
        `select count(*)::int as c from pg_stat_activity where datname = '${DATABASE_NAME}' and wait_event_type = 'Lock'`,
      )
      if (result.rows[0].c >= count) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`[internal] never saw ${count} contenders blocked on the row lock`)
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
      entities: [Warehouse, WarehouseZone, WarehouseLocation, InventoryLot, InventoryBalance, InventoryMovement],
      debug: false,
      // Sized to exactly match CONTENDERS: enough for the one-connection-per-holder fix,
      // not enough to also cover a second connection for whichever holder runs the adjust.
      pool: { min: 0, max: CONTENDERS },
      driverOptions: { connectionTimeoutMillis: 5000 },
    })
    await orm.schema.create()
    await seedWarehouseAndLocation()
    const { Client } = await import('pg')
    const client = new Client({
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      database: DATABASE_NAME,
      user: DATABASE_USER,
      password: DATABASE_PASSWORD,
    })
    await client.connect()
    monitorClient = client
  }, 120_000)

  afterEach(() => {
    jest.restoreAllMocks()
  })

  afterAll(async () => {
    await monitorClient?.end()
    await orm?.close(true)
    await postgres?.stop()
  }, 30_000)

  it('serializes every contender for the same row through one connection each and posts exactly one movement', async () => {
    const importBatchId = randomUUID()
    const gate = gateFirstLockAcquisition()

    const racing = Promise.all(
      Array.from({ length: CONTENDERS }, () => applyContendedRow(importBatchId)),
    )
    await waitForLockWaiters(CONTENDERS - 1)
    gate.release()
    const results = await racing

    for (const result of results) {
      expect(result.summary).toEqual({ applied: 1, skipped: 0, failed: 0 })
      expect(result.rows[0]).toMatchObject({ rowNumber: 1, status: 'applied' })
    }

    const movementIds = new Set(results.map((result) => result.rows[0].movementId))
    expect(movementIds.size).toBe(1)

    const movementCountRows = await rootEm().execute<Array<{ count: number }>>(
      "select count(*)::int as count from wms_inventory_movements where organization_id = ? and deleted_at is null and metadata->>'importBatchId' = ?",
      [ORG, importBatchId],
    )
    expect(movementCountRows[0].count).toBe(1)

    const balanceRows = await rootEm().execute<Array<{ quantity_on_hand: string }>>(
      'select quantity_on_hand from wms_inventory_balances where organization_id = ? and warehouse_id = ? and location_id = ? and catalog_variant_id = ?',
      [ORG, WAREHOUSE_ID, LOCATION_ID, VARIANT_ID],
    )
    expect(Number(balanceRows[0].quantity_on_hand)).toBe(DELTA)
  }, CASE_TIMEOUT_MS)
})
