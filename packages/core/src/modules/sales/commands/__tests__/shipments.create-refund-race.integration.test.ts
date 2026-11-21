/** @jest-environment node */
import { randomUUID } from 'node:crypto'
import { MikroORM } from '@mikro-orm/core'
import { PostgreSqlDriver, type EntityManager } from '@mikro-orm/postgresql'
import type { StartedTestContainer } from 'testcontainers'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandRuntimeContext, CommandUndoLogEntry } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import * as salesEntities from '../../data/entities'
import { SalesOrder, SalesOrderLine } from '../../data/entities'
import type { ShipmentSnapshot } from '../shipments'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string) => key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn((em: { find: (...args: unknown[]) => unknown }, ...args: unknown[]) => em.find(...args.slice(0, 3))),
  findOneWithDecryption: jest.fn((em: { findOne: (...args: unknown[]) => unknown }, ...args: unknown[]) => em.findOne(...args.slice(0, 3))),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn().mockResolvedValue({}),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  emitCrudSideEffects: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@open-mercato/core/modules/entities/lib/helpers', () => ({
  setRecordCustomFields: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('../../lib/dictionaries', () => ({
  resolveDictionaryEntryValue: jest.fn().mockResolvedValue(null),
}))

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

const DATABASE_NAME = 'sales_shipment_refund_race_test'
const DATABASE_USER = 'sales_shipment_refund_race'
const DATABASE_PASSWORD = 'sales_shipment_refund_race'
const WAITER_POLL_MS = 25
const WAITER_TIMEOUT_MS = 10_000

type TestOrm = MikroORM<PostgreSqlDriver, EntityManager<PostgreSqlDriver>>

type Seed = { tenantId: string; organizationId: string; orderId: string; lineId: string }

type Deferred = { promise: Promise<void>; resolve: () => void }

type Outcome = { ok: true } | { ok: false; error: unknown }

function createDeferred(): Deferred {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((resolveDeferred) => {
    resolve = resolveDeferred
  })
  return { promise, resolve }
}

async function settle(promise: Promise<unknown>): Promise<Outcome> {
  try {
    await promise
    return { ok: true }
  } catch (error) {
    return { ok: false, error }
  }
}

function entityClasses(): Array<new (...args: never[]) => object> {
  return Object.values(salesEntities).filter(
    (value): value is new (...args: never[]) => object => typeof value === 'function' && /^Sales[A-Z]/.test(value.name),
  )
}

describeWithPostgres('sales.shipments.create refund guard against a concurrent refund on real PostgreSQL', () => {
  let postgres: StartedTestContainer | null = null
  let orm: TestOrm | null = null

  function rootEm(): EntityManager {
    if (!orm) throw new Error('[internal] ORM is not started')
    return orm.em.fork()
  }

  function commandCtx(seed: Seed): CommandRuntimeContext {
    return {
      container: {
        resolve: (name: string) => {
          if (name === 'em') return rootEm()
          if (name === 'dataEngine') return {}
          throw new Error(`[internal] unexpected resolve ${name}`)
        },
      },
      auth: { sub: randomUUID(), tenantId: seed.tenantId, orgId: seed.organizationId },
      selectedOrganizationId: seed.organizationId,
      organizationIds: [seed.organizationId],
      organizationScope: null,
    } as unknown as CommandRuntimeContext
  }

  function handler() {
    const registered = commandRegistry.get('sales.shipments.create')
    if (!registered?.redo) throw new Error('[internal] sales.shipments.create is not registered')
    return registered
  }

  async function seedPaidOrder(): Promise<Seed> {
    const seed: Seed = {
      tenantId: randomUUID(),
      organizationId: randomUUID(),
      orderId: randomUUID(),
      lineId: randomUUID(),
    }
    const scope = { tenantId: seed.tenantId, organizationId: seed.organizationId }
    const em = rootEm()
    const order = em.create(SalesOrder, {
      ...scope,
      id: seed.orderId,
      orderNumber: `SO-${seed.orderId.slice(0, 8)}`,
      currencyCode: 'USD',
      status: 'confirmed',
      grandTotalNetAmount: '100',
      grandTotalGrossAmount: '100',
      paidTotalAmount: '100',
      refundedTotalAmount: '0',
      outstandingAmount: '0',
    })
    em.create(SalesOrderLine, {
      ...scope,
      id: seed.lineId,
      order,
      lineNumber: 1,
      name: 'Desk',
      quantity: '1',
      currencyCode: 'USD',
      unitPriceNet: '100',
      unitPriceGross: '100',
      totalNetAmount: '100',
      totalGrossAmount: '100',
    })
    await em.flush()
    return seed
  }

  function createInput(seed: Seed) {
    return {
      orderId: seed.orderId,
      tenantId: seed.tenantId,
      organizationId: seed.organizationId,
      items: [{ orderLineId: seed.lineId, quantity: 1 }],
    }
  }

  function redoLogEntry(seed: Seed): CommandUndoLogEntry {
    const after: ShipmentSnapshot = {
      id: randomUUID(),
      orderId: seed.orderId,
      organizationId: seed.organizationId,
      tenantId: seed.tenantId,
      shipmentNumber: 'SHIP-1',
      shippingMethodId: null,
      statusEntryId: null,
      status: null,
      carrierName: null,
      trackingNumbers: null,
      shippedAt: null,
      deliveredAt: null,
      weightValue: null,
      weightUnit: null,
      declaredValueNet: null,
      declaredValueGross: null,
      currencyCode: 'USD',
      notesText: null,
      metadata: null,
      items: [{ id: randomUUID(), orderLineId: seed.lineId, orderLineName: 'Desk', orderLineNumber: 1, quantity: 1, metadata: null }],
    }
    return { resourceId: after.id, payload: { undo: { after } } } as unknown as CommandUndoLogEntry
  }

  async function waitForLockWaiter(): Promise<void> {
    const deadline = Date.now() + WAITER_TIMEOUT_MS
    while (Date.now() < deadline) {
      const rows = await rootEm().execute<Array<{ waiting: number }>>(
        `select count(*)::int as waiting from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`,
      )
      if (rows[0].waiting >= 1) return
      await new Promise((resolve) => setTimeout(resolve, WAITER_POLL_MS))
    }
    throw new Error(`[internal] no transaction started waiting on a row lock within ${WAITER_TIMEOUT_MS}ms`)
  }

  async function raceAgainstRefund(seed: Seed, write: () => Promise<unknown>): Promise<Outcome> {
    const refundHoldsLock = createDeferred()
    const commitRefund = createDeferred()
    const refund = rootEm().transactional(async (tx) => {
      await tx.execute('select id from sales_orders where id = ? for update', [seed.orderId])
      await tx.execute('update sales_orders set refunded_total_amount = paid_total_amount where id = ?', [seed.orderId])
      refundHoldsLock.resolve()
      await commitRefund.promise
    })
    await refundHoldsLock.promise
    const outcome = settle(write())
    await waitForLockWaiter()
    commitRefund.resolve()
    await refund
    return outcome
  }

  async function readState(seed: Seed) {
    const em = rootEm()
    const [shipments] = await em.execute<Array<{ total: number }>>(
      'select count(*)::int as total from sales_shipments where order_id = ?',
      [seed.orderId],
    )
    const [line] = await em.execute<Array<{ fulfilled_quantity: string }>>(
      'select fulfilled_quantity from sales_order_lines where id = ?',
      [seed.lineId],
    )
    return { shipments: shipments.total, fulfilled: Number(line.fulfilled_quantity) }
  }

  function expectRefundRefusal(outcome: Outcome) {
    expect(outcome.ok).toBe(false)
    const error = outcome.ok ? null : outcome.error
    expect(error).toBeInstanceOf(CrudHttpError)
    expect((error as CrudHttpError).status).toBe(422)
    expect((error as CrudHttpError).body).toEqual({ error: 'sales.shipments.create_order_refunded' })
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
      entities: entityClasses(),
      debug: false,
      pool: { min: 0, max: 6 },
    })
    await orm.schema.create()
    commandRegistry.clear?.()
    await import('../shipments')
  }, 120_000)

  afterAll(async () => {
    await orm?.close(true)
    await postgres?.stop()
  })

  it('refuses a create that read the order before a full refund committed', async () => {
    const seed = await seedPaidOrder()

    const outcome = await raceAgainstRefund(seed, () => handler().execute(createInput(seed), commandCtx(seed)))

    expectRefundRefusal(outcome)
    expect(await readState(seed)).toEqual({ shipments: 0, fulfilled: 0 })
  })

  it('refuses a redo that started before a full refund committed', async () => {
    const seed = await seedPaidOrder()
    const ctx = commandCtx(seed)

    const outcome = await raceAgainstRefund(seed, async () =>
      handler().redo?.({ input: createInput(seed), ctx, logEntry: redoLogEntry(seed) }),
    )

    expectRefundRefusal(outcome)
    expect(await readState(seed)).toEqual({ shipments: 0, fulfilled: 0 })
  })

  it('still creates the shipment when the concurrent payment write is not a refund', async () => {
    const seed = await seedPaidOrder()
    const writerHoldsLock = createDeferred()
    const commitWriter = createDeferred()
    const writer = rootEm().transactional(async (tx) => {
      await tx.execute('select id from sales_orders where id = ? for update', [seed.orderId])
      writerHoldsLock.resolve()
      await commitWriter.promise
    })
    await writerHoldsLock.promise
    const pending = settle(handler().execute(createInput(seed), commandCtx(seed)))
    await waitForLockWaiter()
    commitWriter.resolve()
    await writer

    expect(await pending).toEqual({ ok: true })
    expect(await readState(seed)).toEqual({ shipments: 1, fulfilled: 1 })
  })
})
