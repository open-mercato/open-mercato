/** @jest-environment node */
import { randomUUID } from 'node:crypto'
import { asValue, createContainer, type AwilixContainer } from 'awilix'
import { MikroORM, type EntityClass } from '@mikro-orm/core'
import { PostgreSqlDriver, type EntityManager } from '@mikro-orm/postgresql'
import type { StartedTestContainer } from 'testcontainers'
import { CommandBus, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import * as salesEntities from '../../data/entities'
import { SalesOrder, SalesPayment, SalesPaymentAllocation } from '../../data/entities'
import { ActionLog } from '../../../audit_logs/data/entities'
import { ActionLogService } from '../../../audit_logs/services/actionLogService'
import type { PaymentSnapshot } from '../payments'

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

type TestOrm = MikroORM<PostgreSqlDriver, EntityManager<PostgreSqlDriver>>

function isEntityClass<T>(value: T): value is Extract<T, EntityClass<object>> {
  return typeof value === 'function'
}

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn().mockResolvedValue({}),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  emitCrudSideEffects: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@open-mercato/shared/lib/crud/cache', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/crud/cache'),
  invalidateCrudCache: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@open-mercato/core/modules/entities/lib/helpers', () => ({
  setRecordCustomFields: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('../../../notifications/lib/notificationService', () => ({
  resolveNotificationService: jest.fn().mockReturnValue({
    createForFeature: jest.fn().mockResolvedValue(undefined),
  }),
}))

jest.mock('../../notifications', () => ({
  notificationTypes: [],
}))

jest.mock('../../lib/dictionaries', () => ({
  resolveDictionaryEntryValue: jest.fn().mockResolvedValue(null),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async (em: any, entity: any, where: any, options: any) =>
    em.findOne(entity, where, options)),
  findWithDecryption: jest.fn(async (em: any, entity: any, where: any, options: any) =>
    em.find(entity, where, options)),
}))

import '../payments'

type PaymentCreateResult = {
  paymentId: string
  orderTotals?: { paidTotalAmount: number; refundedTotalAmount: number; outstandingAmount: number }
  reused?: boolean
  reconciled?: boolean
}

type PaymentUndoPayload = {
  kind?: 'create' | 'update'
  before?: PaymentSnapshot | null
  after?: PaymentSnapshot | null
}

type Gate = { reached: Promise<void>; signal: () => void; released: Promise<void>; release: () => void }

function createGate(): Gate {
  let signal: () => void = () => undefined
  let release: () => void = () => undefined
  const reached = new Promise<void>((resolve) => {
    signal = resolve
  })
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  return { reached, signal, released, release }
}

/**
 * C3 (PR 8268 re-review 5929582808) — real-Postgres, real-`CommandBus` proof for the
 * authorization-first / capture-second race on one gateway `paymentReference`.
 *
 * The authorization contender is held INSIDE its locked transaction (it already owns the
 * order's `FOR UPDATE` row lock and has not inserted the payment yet) while the capture
 * contender starts on its own pooled connection and queues on that same lock. Only then is
 * the authorization released, so the capture observes the committed authorization row under
 * its own lock and reconciles it. That ordering is exactly the window in which a snapshot
 * taken before the lock (the original `prepare()` placement) saw no payment, persisted an
 * update log without `before`, and let undo fall through to deleting the pre-existing payment
 * and its allocations. The test runs the bus's deferred preparation, persists the audit log
 * through the real `ActionLogService`, and undoes through `CommandBus.undo`.
 */
describeWithPostgres('sales.payments.create — authorization-first / capture-second through the real command bus on PostgreSQL (C3)', () => {
  jest.setTimeout(120_000)
  let postgres: StartedTestContainer | undefined
  let orm: TestOrm | undefined
  let container: AwilixContainer
  let commandBus: CommandBus

  function database(): TestOrm {
    if (!orm) throw new Error('[internal] payment undo test ORM is not initialized')
    return orm
  }

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment({ POSTGRES_USER: 'sales_payment_undo', POSTGRES_PASSWORD: 'sales_payment_undo', POSTGRES_DB: 'sales_payment_undo' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
      .withStartupTimeout(60_000)
      .start()
    const initialized = await MikroORM.init<PostgreSqlDriver, EntityManager<PostgreSqlDriver>>({
      driver: PostgreSqlDriver,
      contextName: 'sales-payment-authorization-capture-undo',
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      user: 'sales_payment_undo',
      password: 'sales_payment_undo',
      dbName: 'sales_payment_undo',
      entities: [...Object.values(salesEntities).filter(isEntityClass), ActionLog],
      pool: { min: 0, max: 10 },
      driverOptions: { connectionTimeoutMillis: 2_000 },
    })
    orm = initialized
    await initialized.schema.create()
    commandBus = new CommandBus()
    container = createContainer()
    container.register({
      dataEngine: asValue({ flushOrmEntityChanges: async () => undefined }),
    })
  }, 120_000)

  afterAll(async () => {
    try {
      await orm?.close(true)
    } finally {
      await postgres?.stop()
    }
  })

  async function insertOrder(): Promise<{ id: string; tenantId: string; organizationId: string }> {
    const em = database().em.fork()
    const tenantId = randomUUID()
    const organizationId = randomUUID()
    const order = em.create(SalesOrder, {
      organizationId,
      tenantId,
      orderNumber: `ORD-${randomUUID().slice(0, 8)}`,
      currencyCode: 'USD',
      grandTotalGrossAmount: '100.0000',
    }, { partial: true })
    em.persist(order)
    await em.flush()
    return { id: order.id, tenantId, organizationId }
  }

  function requestContainer(): AwilixContainer {
    const requestEm = database().em.fork()
    const scope = container.createScope()
    scope.register({
      em: asValue(requestEm),
      actionLogService: asValue(new ActionLogService(requestEm)),
    })
    return scope
  }

  function buildCtx(
    order: { tenantId: string; organizationId: string },
    overrides: Partial<CommandRuntimeContext> = {},
  ): CommandRuntimeContext {
    return {
      container: requestContainer(),
      auth: { sub: 'checkout-system', tenantId: order.tenantId, orgId: order.organizationId },
      selectedOrganizationId: order.organizationId,
      organizationIds: [order.organizationId],
      organizationScope: null,
      ...overrides,
    }
  }

  async function waitForLockWaiter(): Promise<void> {
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      const rows = await database().em.fork().getConnection().execute<Array<{ waiting: number }>>(
        "select count(*)::int as waiting from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'",
      )
      if ((rows[0]?.waiting ?? 0) > 0) return
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    throw new Error('[internal] capture contender never queued on the order row lock')
  }

  it('logs the capture as an update carrying the authorization snapshot, and undo restores the authorization without deleting the payment or its allocation', async () => {
    const order = await insertOrder()
    const paymentReference = `gw-${randomUUID()}`
    const baseInput = {
      orderId: order.id,
      tenantId: order.tenantId,
      organizationId: order.organizationId,
      amount: 100,
      currencyCode: 'USD',
      paymentReference,
    }

    const authorizationHeld = createGate()
    const authorization = commandBus.execute<typeof baseInput & { capturedAmount: number }, PaymentCreateResult>(
      'sales.payments.create',
      {
        input: { ...baseInput, capturedAmount: 0 },
        ctx: buildCtx(order, {
          beforeTransactionalWrite: async () => {
            authorizationHeld.signal()
            await authorizationHeld.released
          },
        }),
      },
    )
    await authorizationHeld.reached

    const capture = commandBus.execute<typeof baseInput & { capturedAmount: number; capturedAt: string }, PaymentCreateResult>(
      'sales.payments.create',
      {
        input: { ...baseInput, capturedAmount: 100, capturedAt: '2026-11-17T10:00:00.000Z' },
        ctx: buildCtx(order),
      },
    )
    await waitForLockWaiter()
    authorizationHeld.release()

    const [authorizationOutcome, captureOutcome] = await Promise.all([authorization, capture])

    expect(authorizationOutcome.result.reused).toBe(false)
    expect(captureOutcome.result).toMatchObject({ reused: true, reconciled: true, paymentId: authorizationOutcome.result.paymentId })
    const paymentId = authorizationOutcome.result.paymentId
    const authorizationTotals = authorizationOutcome.result.orderTotals
    expect(authorizationTotals).toEqual({
      paidTotalAmount: 100,
      paidTotalAmountExact: '100',
      refundedTotalAmount: 0,
      refundedTotalAmountExact: '0',
      outstandingAmount: 0,
      outstandingAmountExact: '0',
    })

    const captureLogId = captureOutcome.logEntry?.id
    expect(captureLogId).toBeTruthy()
    const captureLog = await database().em.fork().findOneOrFail(ActionLog, { id: captureLogId as string })
    expect(captureLog.commandId).toBe('sales.payments.create')
    expect(captureLog.actionLabel).toBe('Update payment')
    expect(captureLog.undoToken).toBeTruthy()
    expect(captureLog.snapshotBefore).toMatchObject({ id: paymentId, capturedAmount: 0, capturedAt: null })
    expect(captureLog.snapshotAfter).toMatchObject({ id: paymentId, capturedAmount: 100 })
    const captureUndo = extractUndoPayload<PaymentUndoPayload>(captureLog)
    expect(captureUndo?.kind).toBe('update')
    expect(captureUndo?.before).toMatchObject({ id: paymentId, capturedAmount: 0, capturedAt: null })
    expect(captureUndo?.before?.allocations).toHaveLength(1)

    const authorizationLog = await database().em.fork().findOneOrFail(ActionLog, { id: authorizationOutcome.logEntry?.id as string })
    expect(extractUndoPayload<PaymentUndoPayload>(authorizationLog)?.kind).toBe('create')

    const capturedPayment = await database().em.fork().findOneOrFail(SalesPayment, { id: paymentId })
    expect(Number(capturedPayment.capturedAmount)).toBe(100)
    expect(capturedPayment.capturedAt?.toISOString()).toBe('2026-11-17T10:00:00.000Z')

    await commandBus.undo(captureLog.undoToken as string, buildCtx(order))

    const verifyEm = database().em.fork()
    const restoredPayment = await verifyEm.findOne(SalesPayment, { id: paymentId, deletedAt: null })
    expect(restoredPayment).not.toBeNull()
    expect(Number(restoredPayment?.capturedAmount)).toBe(0)
    expect(restoredPayment?.capturedAt ?? null).toBeNull()
    expect(restoredPayment?.paymentReference).toBe(paymentReference)
    expect(await verifyEm.count(SalesPayment, { order: order.id, deletedAt: null })).toBe(1)

    const allocations = await verifyEm.find(SalesPaymentAllocation, { payment: paymentId })
    expect(allocations).toHaveLength(1)
    expect(Number(allocations[0].amount)).toBe(100)
    expect(typeof allocations[0].order === 'string' ? allocations[0].order : allocations[0].order?.id).toBe(order.id)

    const restoredOrder = await verifyEm.findOneOrFail(SalesOrder, { id: order.id })
    expect({
      paidTotalAmount: Number(restoredOrder.paidTotalAmount),
      refundedTotalAmount: Number(restoredOrder.refundedTotalAmount),
      outstandingAmount: Number(restoredOrder.outstandingAmount),
    }).toEqual(authorizationTotals)

    const undoneLog = await verifyEm.findOneOrFail(ActionLog, { id: captureLogId as string })
    expect(undoneLog.executionState).toBe('undone')
    const untouchedAuthorizationLog = await verifyEm.findOneOrFail(ActionLog, { id: authorizationLog.id })
    expect(untouchedAuthorizationLog.executionState).toBe('done')
  })
})
