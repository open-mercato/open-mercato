import { randomUUID } from 'node:crypto'
import { MikroORM } from '@mikro-orm/core'
import { PostgreSqlDriver } from '@mikro-orm/postgresql'
import type { StartedTestContainer } from 'testcontainers'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { setGlobalEventBus } from '@open-mercato/shared/modules/events'
import {
  clearGatewayAdapters,
  registerGatewayAdapter,
  type CancelResult,
  type CaptureInput,
  type CaptureResult,
} from '@open-mercato/shared/modules/payment_gateways/types'
import { GatewayPaymentOperation, GatewayTransaction } from '../../data/entities'
import { createPaymentGatewayService } from '../gateway-service'

const manualDatabaseUrl = process.env.OM_PAYMENT_GATEWAYS_MANUAL_DATABASE_URL
const runPostgresRegression = Boolean(manualDatabaseUrl) || process.env.OM_PG_INTEGRATION === '1' || process.env.CI === 'true'
const describeWithPostgres = runPostgresRegression ? describe : describe.skip

function deferred() {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((complete) => { resolve = complete })
  return { promise, resolve }
}

describeWithPostgres('manual cancel/capture exclusion against PostgreSQL (#8224)', () => {
  let postgres: StartedTestContainer | undefined
  let orm: MikroORM<PostgreSqlDriver>
  const scope = { organizationId: randomUUID(), tenantId: randomUUID() }
  const providerKey = 'synthetic-cancel-capture'

  beforeAll(async () => {
    if (manualDatabaseUrl) {
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(manualDatabaseUrl).hostname)) {
        throw new Error('[internal] Manual payment regression requires an explicit loopback disposable database')
      }
    } else {
      const { GenericContainer, Wait } = await import('testcontainers')
      postgres = await new GenericContainer('postgres:16-alpine')
        .withEnvironment({ POSTGRES_DB: 'payments', POSTGRES_USER: 'payments', POSTGRES_PASSWORD: 'payments' })
        .withExposedPorts(5432)
        .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
        .start()
    }
    orm = await MikroORM.init({
      driver: PostgreSqlDriver,
      entities: [GatewayTransaction, GatewayPaymentOperation],
      ...(manualDatabaseUrl ? { clientUrl: manualDatabaseUrl } : {
        host: postgres!.getHost(), port: postgres!.getMappedPort(5432),
        dbName: 'payments', user: 'payments', password: 'payments',
      }),
      pool: { min: 1, max: 5 },
    })
    await orm.schema.create()
    setGlobalEventBus({ emit: async () => {} })
  }, 120_000)

  afterEach(async () => {
    clearGatewayAdapters()
    if (orm) {
      const em = orm.em.fork()
      await em.nativeDelete(GatewayPaymentOperation, scope)
      await em.nativeDelete(GatewayTransaction, scope)
    }
  })

  afterAll(async () => {
    await orm?.close(true)
    await postgres?.stop()
  }, 30_000)

  async function fixture(amount = '100') {
    const em = orm.em.fork()
    const transaction = em.create(GatewayTransaction, {
      ...scope, paymentId: randomUUID(), providerKey, providerSessionId: 'synthetic-session',
      amount, capturedAmount: '0', currencyCode: 'USD', unifiedStatus: 'authorized',
    })
    await em.flush()
    const capture = jest.fn(async (_input: CaptureInput): Promise<CaptureResult> => ({ status: 'partially_captured', capturedAmount: 60 }))
    const cancel = jest.fn(async (): Promise<CancelResult> => ({ status: 'cancelled' }))
    registerGatewayAdapter({
      providerKey, capture, cancel, createSession: jest.fn(), refund: jest.fn(),
      getStatus: jest.fn(), verifyWebhook: jest.fn(), mapStatus: jest.fn(),
    })
    const makeService = () => createPaymentGatewayService({
      em: orm.em.fork(),
      integrationCredentialsService: { resolve: async () => ({}) } as never,
    })
    return { transaction, capture, cancel, captureService: makeService(), cancelService: makeService() }
  }

  async function waitForBlockedCapture(signal: AbortSignal): Promise<'blocked'> {
    const observer = orm.em.fork()
    const deadline = Date.now() + 5_000
    while (!signal.aborted && Date.now() < deadline) {
      const rows = await observer.getConnection().execute<Array<{ blocked: boolean }>>(
        "select exists (select 1 from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like 'update %gateway_transactions%captured_amount%') as blocked",
      )
      if (rows[0]?.blocked) return 'blocked'
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error('[internal] Capture did not reach its database row lock')
  }

  it('holds cancel through commit and rejects a capture waiting on the same database row', async () => {
    const { transaction, capture, cancel, captureService, cancelService } = await fixture()
    const cancelEntered = deferred()
    const captureEntered = deferred()
    const finishCancel = deferred()
    cancel.mockImplementation(async () => {
      cancelEntered.resolve()
      await finishCancel.promise
      return { status: 'cancelled' }
    })
    capture.mockImplementation(async () => {
      captureEntered.resolve()
      return { status: 'partially_captured', capturedAmount: 60 }
    })
    const cancelling = cancelService.cancelPayment(transaction.id, undefined, scope, 'cancel-first')
    await cancelEntered.promise
    const capturing = captureService.capturePayment(transaction.id, 60, scope, 'capture-second')
    const captureOutcome = capturing.catch((error: unknown) => error)
    const observer = new AbortController()
    const blocked = waitForBlockedCapture(observer.signal)
    try {
      expect(await Promise.race([captureEntered.promise.then(() => 'provider'), blocked])).toBe('blocked')
      expect(capture).not.toHaveBeenCalled()
    } finally {
      observer.abort()
      finishCancel.resolve()
      await Promise.allSettled([cancelling, captureOutcome, blocked])
    }
    await expect(cancelling).resolves.toMatchObject({ status: 'cancelled' })
    expect(await captureOutcome).toMatchObject({ status: 409, body: { code: 'payment_capture_reservation_conflict' } })
    const current = await findOneWithDecryption(orm.em.fork(), GatewayTransaction, { id: transaction.id, ...scope }, undefined, scope)
    expect(current).toMatchObject({ unifiedStatus: 'cancelled', capturedAmount: '0' })
  })

  it('refuses cancel after another connection has committed a capture reservation', async () => {
    const { transaction, capture, cancel, captureService, cancelService } = await fixture()
    const captureEntered = deferred()
    const finishCapture = deferred()
    capture.mockImplementation(async () => {
      captureEntered.resolve()
      await finishCapture.promise
      return { status: 'partially_captured', capturedAmount: 60 }
    })
    const capturing = captureService.capturePayment(transaction.id, 60, scope, 'capture-first')
    await captureEntered.promise
    try {
      await expect(cancelService.cancelPayment(transaction.id, undefined, scope, 'cancel-second'))
        .rejects.toMatchObject({ status: 409 })
      expect(cancel).not.toHaveBeenCalled()
    } finally {
      finishCapture.resolve()
      await capturing
    }
    const current = await findOneWithDecryption(orm.em.fork(), GatewayTransaction, { id: transaction.id, ...scope }, undefined, scope)
    expect(current).toMatchObject({ unifiedStatus: 'partially_captured', capturedAmount: '60' })
  })

  it('rolls back a failed cancel, retries with the same provider key and replays the committed result', async () => {
    const { transaction, cancel, cancelService } = await fixture()
    cancel.mockRejectedValueOnce(new Error('synthetic cancel failure'))

    await expect(cancelService.cancelPayment(transaction.id, undefined, scope, 'cancel-retry'))
      .rejects.toThrow('synthetic cancel failure')
    const failed = await findOneWithDecryption(orm.em.fork(), GatewayTransaction, { id: transaction.id, ...scope }, undefined, scope)
    expect(failed).toMatchObject({ unifiedStatus: 'authorized', capturedAmount: '0' })

    const retryService = createPaymentGatewayService({
      em: orm.em.fork(),
      integrationCredentialsService: { resolve: async () => ({}) } as never,
    })
    const result = await retryService.cancelPayment(transaction.id, undefined, scope, 'cancel-retry')
    await expect(retryService.cancelPayment(transaction.id, undefined, scope, 'cancel-retry')).resolves.toEqual(result)
    expect(cancel).toHaveBeenCalledTimes(2)
    expect(cancel.mock.calls[0]).toEqual(cancel.mock.calls[1])
    const operation = await findOneWithDecryption(orm.em.fork(), GatewayPaymentOperation, { operationId: 'cancel-retry', ...scope }, undefined, scope)
    expect(operation).toMatchObject({ status: 'succeeded', attemptCount: 2 })
  })

  it.each([
    { retry: false, status: 'partially_captured', capturedAmount: '0' },
    { retry: true, status: 'partially_captured', capturedAmount: '0' },
    { retry: false, status: 'authorized', capturedAmount: '25' },
    { retry: true, status: 'authorized', capturedAmount: '25' },
    { retry: false, status: 'authorized', capturedAmount: '0.000000000000000001' },
    { retry: true, status: 'authorized', capturedAmount: '0.000000000000000001' },
  ])('refuses captured funds committed before the final cancel lock: %j', async ({ retry, status, capturedAmount }) => {
    const { transaction, cancel, cancelService } = await fixture()
    const operationId = 'cancel-late-status'
    if (retry) {
      cancel.mockRejectedValueOnce(new Error('synthetic provider failure'))
      await expect(cancelService.cancelPayment(transaction.id, undefined, scope, operationId)).rejects.toThrow('synthetic provider failure')
      cancel.mockClear()
    }
    const credentialsEntered = deferred()
    const finishCredentials = deferred()
    const service = createPaymentGatewayService({
      em: orm.em.fork(),
      integrationCredentialsService: { resolve: async () => {
        credentialsEntered.resolve()
        await finishCredentials.promise
        return {}
      } } as never,
    })
    const cancelling = service.cancelPayment(transaction.id, undefined, scope, operationId)
    const outcome = cancelling.then((value) => ({ value }), (error: unknown) => ({ error }))
    try {
      await Promise.race([credentialsEntered.promise, outcome.then(() => {
        throw new Error('[internal] Cancellation settled before the credential boundary')
      })])
      await orm.em.fork().nativeUpdate(GatewayTransaction, { id: transaction.id, ...scope }, { unifiedStatus: status, capturedAmount })
    } finally {
      finishCredentials.resolve()
      await outcome
    }

    expect(await outcome).toMatchObject({ error: { status: 409, body: { code: 'payment_cancel_captured_funds' } } })
    if (capturedAmount !== '0') {
      expect(await outcome).toMatchObject({ error: { body: { error: 'Cannot cancel a payment with captured funds or an outstanding capture reservation.' } } })
    }
    expect(cancel).not.toHaveBeenCalled()
    const current = await findOneWithDecryption(orm.em.fork(), GatewayTransaction, { id: transaction.id, ...scope }, undefined, scope)
    expect(current).toMatchObject({ unifiedStatus: status, capturedAmount })
    const operation = await findOneWithDecryption(orm.em.fork(), GatewayPaymentOperation, { operationId, ...scope }, undefined, scope)
    expect(operation).toMatchObject({ status: 'failed', attemptCount: retry ? 2 : 1 })
    await expect(service.cancelPayment(transaction.id, undefined, scope, operationId)).rejects.toMatchObject({ status: 409 })
    expect(cancel).not.toHaveBeenCalled()
  })

  it('preserves exact capture amounts, ceilings and replay while excluding cancellation', async () => {
    const { transaction, capture, cancel, captureService, cancelService } = await fixture('1000.000000000000000002')
    capture.mockImplementation(async (input) => ({
      status: 'partially_captured', capturedAmount: input.amount ?? 0, capturedAmountExact: input.amountExact,
    }))

    const result = await captureService.capturePayment(transaction.id, '1000.000000000000000001', scope, 'exact-capture')
    await expect(captureService.capturePayment(transaction.id, '1000.000000000000000001', scope, 'exact-capture')).resolves.toEqual(result)
    await expect(captureService.capturePayment(transaction.id, '0.000000000000000002', scope, 'excess-capture'))
      .rejects.toMatchObject({ status: 409, body: { code: 'payment_capture_ceiling_exceeded' } })
    await expect(cancelService.cancelPayment(transaction.id, undefined, scope, 'cancel-exact')).rejects.toMatchObject({ status: 409 })

    expect(capture).toHaveBeenCalledTimes(1)
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'synthetic-session', amountExact: '1000.000000000000000001', idempotencyKey: expect.stringMatching(/^om-pg-/),
    }))
    expect(cancel).not.toHaveBeenCalled()
    const current = await findOneWithDecryption(orm.em.fork(), GatewayTransaction, { id: transaction.id, ...scope }, undefined, scope)
    expect(current?.capturedAmount).toBe('1000.000000000000000001')
  })

  it.each(['organizationId', 'tenantId'] as const)('rejects foreign %s access and replay before invoking the provider', async (field) => {
    const { transaction, capture, cancel, captureService, cancelService } = await fixture()
    await cancelService.cancelPayment(transaction.id, undefined, scope, 'scoped-cancel')
    const foreignScope = { ...scope, [field]: randomUUID() }

    await expect(cancelService.cancelPayment(transaction.id, undefined, foreignScope, 'scoped-cancel')).rejects.toThrow('Transaction not found')
    await expect(captureService.capturePayment(transaction.id, 60, foreignScope, 'scoped-capture')).rejects.toThrow('Transaction not found')
    await expect(captureService.findTransactionBySessionId('synthetic-session', foreignScope, providerKey)).resolves.toBeNull()
    await expect(captureService.findTransactionBySessionId('synthetic-session', scope, 'other-provider')).resolves.toBeNull()
    await expect(captureService.findTransactionBySessionId('synthetic-session', scope, providerKey)).resolves.toMatchObject({ id: transaction.id })
    expect(capture).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('rejects a missing provider session and releases its capture reservation', async () => {
    const { transaction, capture, captureService } = await fixture()
    await orm.em.fork().nativeUpdate(GatewayTransaction, { id: transaction.id, ...scope }, { providerSessionId: null })

    await expect(captureService.capturePayment(transaction.id, 60, scope, 'missing-session')).rejects.toThrow('Transaction is missing provider session id')

    expect(capture).not.toHaveBeenCalled()
    const current = await findOneWithDecryption(orm.em.fork(), GatewayTransaction, { id: transaction.id, ...scope }, undefined, scope)
    expect(current).toMatchObject({ unifiedStatus: 'authorized', capturedAmount: '0' })
  })
})
