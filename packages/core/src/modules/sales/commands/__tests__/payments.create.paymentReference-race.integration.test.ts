/** @jest-environment node */
import { randomUUID } from 'node:crypto'
import { MikroORM } from '@mikro-orm/postgresql'
import type { StartedTestContainer } from 'testcontainers'
import * as salesEntities from '../../data/entities'
import { SalesOrder, SalesPayment } from '../../data/entities'

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

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

// REAL passthrough to the forked EntityManager — unlike the mocked unit suite
// (`payments.test.ts`), this file's whole point is to exercise the actual
// `PESSIMISTIC_WRITE` order lock plus the C2 fix's fresh re-check against a real
// database, so `findOneWithDecryption`/`findWithDecryption` must hit Postgres for real.
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async (em: any, entity: any, where: any, options: any) =>
    em.findOne(entity, where, options)),
  findWithDecryption: jest.fn(async (em: any, entity: any, where: any, options: any) =>
    em.find(entity, where, options)),
}))

import { paymentCommands } from '../payments'

/**
 * C2 (CRITICAL, PR 8268 review) — real-Postgres proof that a live gateway completion
 * (`checkout/commands/submit.ts#recordGatewayPayment`) and a concurrent
 * `repair-gateway-payments.worker.ts` sweep, which both call `sales.payments.create` with
 * the SAME `(orderId, paymentReference)` after their own unlocked
 * `findRecordedGatewayPayment` pre-check both saw "no payment yet", can no longer record
 * two `SalesPayment` rows for the same gateway capture. The fix adds a fresh re-check for
 * that exact pair INSIDE the order's `PESSIMISTIC_WRITE` lock
 * (`commands/payments.ts#createPaymentCommand`, right after the lock is acquired): only
 * the first writer to reach it ever inserts; every later one reuses the row the first
 * writer already committed.
 */
describeWithPostgres('sales.payments.create — live-vs-repair paymentReference race on real PostgreSQL (C2)', () => {
  let postgres: StartedTestContainer | undefined
  let orm: MikroORM | undefined

  function database(): MikroORM {
    if (!orm) throw new Error('[internal] payments race test ORM is not initialized')
    return orm
  }

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment({ POSTGRES_USER: 'sales_payments_test', POSTGRES_PASSWORD: 'sales_payments_test', POSTGRES_DB: 'sales_payments_test' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
      .withStartupTimeout(60_000)
      .start()
    orm = await MikroORM.init({
      contextName: 'sales-payments-race',
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      user: 'sales_payments_test',
      password: 'sales_payments_test',
      dbName: 'sales_payments_test',
      entities: [...Object.values(salesEntities)],
      pool: { min: 0, max: 10 },
      driverOptions: { connectionTimeoutMillis: 2_000 },
    })
    await orm.schema.create()
  }, 120_000)

  afterAll(async () => {
    try {
      await orm?.close(true)
    } finally {
      await postgres?.stop()
    }
  })

  function getCreateCommand() {
    const command = (paymentCommands as Array<{ id: string; execute: (input: unknown, ctx: unknown) => Promise<any> }>)
      .find((c) => c.id === 'sales.payments.create')
    if (!command) throw new Error('[internal] sales.payments.create is not registered')
    return command
  }

  async function insertOrder(overrides: Partial<Record<string, unknown>> = {}): Promise<{ id: string; tenantId: string; organizationId: string }> {
    const em = database().em.fork()
    const tenantId = randomUUID()
    const organizationId = randomUUID()
    const order = em.create(SalesOrder, {
      organizationId,
      tenantId,
      orderNumber: `ORD-${randomUUID().slice(0, 8)}`,
      currencyCode: 'USD',
      grandTotalGrossAmount: '100.0000',
      ...overrides,
    })
    em.persist(order)
    await em.flush()
    return { id: order.id, tenantId, organizationId }
  }

  function buildCtx(tenantId: string, organizationId: string) {
    return {
      container: {
        resolve: (name: string) => {
          if (name === 'em') return database().em
          if (name === 'dataEngine') return {}
          throw new Error(`[internal] unexpected resolve ${name}`)
        },
      },
      auth: { tenantId, orgId: organizationId },
      selectedOrganizationId: organizationId,
      organizationIds: [organizationId],
      organizationScope: null,
      request: undefined,
    }
  }

  async function countPayments(organizationId: string, tenantId: string, paymentReference: string): Promise<number> {
    const em = database().em.fork()
    const rows = await em.find(SalesPayment, { organizationId, tenantId, paymentReference, deletedAt: null })
    return rows.length
  }

  it('two concurrent create calls for the SAME order+paymentReference commit exactly one payment row', async () => {
    const order = await insertOrder()
    const command = getCreateCommand()
    const paymentReference = `gw-${randomUUID()}`

    const input = {
      orderId: order.id,
      tenantId: order.tenantId,
      organizationId: order.organizationId,
      amount: 100,
      currencyCode: 'USD',
      capturedAmount: 100,
      paymentReference,
    }

    // The "live completion" and the "repair worker" both reach this command independently
    // (their own shared unlocked pre-check already ran and both saw nothing) — fired as two
    // genuinely overlapping calls against two separate connections, not sequential awaits.
    const [resultA, resultB] = await Promise.all([
      command.execute(input, buildCtx(order.tenantId, order.organizationId)),
      command.execute(input, buildCtx(order.tenantId, order.organizationId)),
    ])

    expect(resultA.paymentId).toBe(resultB.paymentId)
    expect(await countPayments(order.organizationId, order.tenantId, paymentReference)).toBe(1)
  })

  it('a THIRD call arriving after both of the above still resolves to the same single payment', async () => {
    const order = await insertOrder()
    const command = getCreateCommand()
    const paymentReference = `gw-${randomUUID()}`
    const input = {
      orderId: order.id,
      tenantId: order.tenantId,
      organizationId: order.organizationId,
      amount: 50,
      currencyCode: 'USD',
      capturedAmount: 50,
      paymentReference,
    }

    const [resultA, resultB] = await Promise.all([
      command.execute(input, buildCtx(order.tenantId, order.organizationId)),
      command.execute(input, buildCtx(order.tenantId, order.organizationId)),
    ])
    const resultC = await command.execute(input, buildCtx(order.tenantId, order.organizationId))

    expect(new Set([resultA.paymentId, resultB.paymentId, resultC.paymentId]).size).toBe(1)
    expect(await countPayments(order.organizationId, order.tenantId, paymentReference)).toBe(1)
  })

  it('a different paymentReference on the SAME order still creates its own payment row', async () => {
    const order = await insertOrder()
    const command = getCreateCommand()
    const referenceA = `gw-${randomUUID()}`
    const referenceB = `gw-${randomUUID()}`

    const [resultA, resultB] = await Promise.all([
      command.execute(
        { orderId: order.id, tenantId: order.tenantId, organizationId: order.organizationId, amount: 30, currencyCode: 'USD', paymentReference: referenceA },
        buildCtx(order.tenantId, order.organizationId),
      ),
      command.execute(
        { orderId: order.id, tenantId: order.tenantId, organizationId: order.organizationId, amount: 70, currencyCode: 'USD', paymentReference: referenceB },
        buildCtx(order.tenantId, order.organizationId),
      ),
    ])

    expect(resultA.paymentId).not.toBe(resultB.paymentId)
    expect(await countPayments(order.organizationId, order.tenantId, referenceA)).toBe(1)
    expect(await countPayments(order.organizationId, order.tenantId, referenceB)).toBe(1)
  })
})
