/** @jest-environment node */
import type { AwilixContainer } from 'awilix'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { SalesOperation, type SalesOperationKind, type SalesOperationStatus } from '../data/entities'
import { FakeEm } from './support/fakeEm'

jest.mock('@open-mercato/shared/lib/encryption/find', () => jest.requireActual('./support/fakeEm').encryptionFindMock())
jest.mock('@open-mercato/queue', () => ({ createModuleQueue: jest.fn(() => ({ enqueue: jest.fn() })) }))
jest.mock('../lib/salesOperationAlerts', () => {
  const actual = jest.requireActual('../lib/salesOperationAlerts')
  return { ...actual, reportStalledOperation: jest.fn(async () => undefined) }
})

import { runSalesOperation, type OperationTargetHandler, type RunnerDeps } from '../lib/salesOperationRunner'
import { SalesDispatchTimeoutError, type SalesDispatcher } from '../lib/salesDispatcher'
import { SalesContractUnavailableError } from '../lib/salesErrors'
import { reportStalledOperation, STALLED_OPERATION_ATTEMPTS } from '../lib/salesOperationAlerts'
import { MAX_SALES_OPERATION_RECHECKS } from '../lib/salesOperations'
import type { RecurrenceRead } from '../lib/salesRecurrence'

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }

function seedOperation(em: FakeEm, overrides: Partial<SalesOperation> & { kind: SalesOperationKind }) {
  return em.seed(SalesOperation, {
    id: overrides.id ?? `op-${Math.random().toString(16).slice(2)}`,
    ...scope,
    subjectKey: `key-${Math.random()}`,
    payloadHash: 'hash',
    payload: { lines: [{ productId: 'p1' }], metadata: { propertyManagementLeaseId: 'l1' } },
    changeId: null,
    sequence: 1,
    targetType: 'lease_version',
    targetId: 'v1',
    leaseId: 'l1',
    status: 'pending' as SalesOperationStatus,
    token: 'token-1',
    allowCredit: null,
    attempts: 0,
    lastError: null,
    ...overrides,
  } as never) as unknown as SalesOperation
}

function recurrence(extra: Partial<RecurrenceRead> = {}): RecurrenceRead {
  return {
    orderId: 'order-1',
    status: 'scheduled',
    startsOn: '2026-01-10',
    periodCount: 12,
    endsOn: '2027-01-09',
    nextPeriodIndex: 0,
    nextInvoiceOn: '2026-01-10',
    scheduleVersion: 2,
    cancelEffectiveOn: null,
    cancelSettlement: null,
    invoicesAvailable: true,
    periods: [],
    ...extra,
  }
}

function makeDispatcher(overrides: Partial<SalesDispatcher> = {}): jest.Mocked<SalesDispatcher> {
  return {
    createOrder: jest.fn(async () => 'order-1'),
    createQuote: jest.fn(async () => 'quote-1'),
    updateDocumentStatus: jest.fn(async () => undefined),
    cancelRecurrence: jest.fn(async () => ({ status: 'cancelled', cancelEffectiveOn: null, creditMemoIds: [] })),
    readRecurrence: jest.fn(async () => recurrence()),
    findDocuments: jest.fn(async () => []),
    loadDocument: jest.fn(async () => ({ id: 'quote-1', number: 'Q-1', status: 'sent', deleted: false })),
    firstOrderLineId: jest.fn(async () => 'line-1'),
    resolveStatusEntryId: jest.fn(async (value: string) => `status-${value}`),
    ...overrides,
  } as jest.Mocked<SalesDispatcher>
}

function makeHandler(overrides: Partial<OperationTargetHandler> = {}): jest.Mocked<OperationTargetHandler> {
  return {
    isHoldValid: jest.fn(async () => true),
    finish: jest.fn(async () => 'done' as const),
    onDone: jest.fn(async () => undefined),
    onRefused: jest.fn(async () => undefined),
    onCompensated: jest.fn(async () => undefined),
    onCompensationFailed: jest.fn(async () => undefined),
    onDuplicated: jest.fn(async () => undefined),
    ...overrides,
  } as jest.Mocked<OperationTargetHandler>
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const flushTasks = () => new Promise((done) => setImmediate(done))

function deps(em: FakeEm, dispatcher: SalesDispatcher, handler: OperationTargetHandler, enqueuer = jest.fn(async () => undefined)): RunnerDeps {
  return {
    container: { resolve: jest.fn() } as unknown as AwilixContainer,
    em: em as never,
    resolveHandler: () => handler,
    dispatcherFactory: () => dispatcher,
    enqueuer,
    today: () => '2026-03-01',
  }
}

beforeEach(() => jest.clearAllMocks())

describe('runSalesOperation', () => {
  it('ends at once when another owner holds the operation lock', async () => {
    const em = new FakeEm()
    const op = seedOperation(em, { kind: 'lease_order' })
    em.lockFailures.add(op.id)
    const dispatcher = makeDispatcher()
    expect(await runSalesOperation(deps(em, dispatcher, makeHandler()), op.id)).toBe('locked')
    expect(dispatcher.createOrder).not.toHaveBeenCalled()
  })

  it('skips finished operations and unknown ids', async () => {
    const em = new FakeEm()
    const op = seedOperation(em, { kind: 'lease_order', status: 'done' })
    const dispatcher = makeDispatcher()
    expect(await runSalesOperation(deps(em, dispatcher, makeHandler()), op.id)).toBe('skipped')
    expect(await runSalesOperation(deps(em, dispatcher, makeHandler()), 'missing')).toBe('missing')
  })

  it('creates the document with the operation id in its metadata, then finishes', async () => {
    const em = new FakeEm()
    const op = seedOperation(em, { kind: 'lease_order' })
    const dispatcher = makeDispatcher()
    const handler = makeHandler()
    expect(await runSalesOperation(deps(em, dispatcher, handler), op.id)).toBe('done')
    expect(dispatcher.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { propertyManagementLeaseId: 'l1', propertyManagementOperationId: op.id } }),
    )
    expect(op.status).toBe('done')
    expect(op.salesDocumentId).toBe('order-1')
    expect(op.salesDocumentLineId).toBe('line-1')
    expect(handler.finish).toHaveBeenCalled()
    expect(handler.onDone).toHaveBeenCalled()
  })

  it('links an existing document instead of creating a second one on retry', async () => {
    const em = new FakeEm()
    const op = seedOperation(em, { kind: 'lease_order' })
    const dispatcher = makeDispatcher({ findDocuments: jest.fn(async () => ['order-existing']) })
    expect(await runSalesOperation(deps(em, dispatcher, makeHandler()), op.id)).toBe('done')
    expect(dispatcher.createOrder).not.toHaveBeenCalled()
    expect(op.salesDocumentId).toBe('order-existing')
  })

  it('uses a document created by a dispatch that threw after the sales commit', async () => {
    const em = new FakeEm()
    const op = seedOperation(em, { kind: 'lease_order' })
    const findDocuments = jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce(['order-late'])
    const dispatcher = makeDispatcher({
      findDocuments,
      createOrder: jest.fn(async () => {
        throw new Error('cache invalidation failed after commit')
      }),
    })
    expect(await runSalesOperation(deps(em, dispatcher, makeHandler()), op.id)).toBe('done')
    expect(op.salesDocumentId).toBe('order-late')
  })

  it('retries transient failures through the queue and counts the attempt', async () => {
    const em = new FakeEm()
    const op = seedOperation(em, { kind: 'lease_order' })
    const dispatcher = makeDispatcher({
      createOrder: jest.fn(async () => {
        throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' })
      }),
    })
    await expect(runSalesOperation(deps(em, dispatcher, makeHandler()), op.id)).rejects.toThrow('connection reset')
    expect(op.status).toBe('pending')
    expect(op.attempts).toBe(1)
    expect(op.lastError).toMatchObject({ code: 'ECONNRESET' })
  })

  it('does not count an attempt on an operation another worker holds by then', async () => {
    const em = new FakeEm()
    const op = seedOperation(em, { kind: 'lease_order' })
    const dispatcher = makeDispatcher({
      createOrder: jest.fn(async () => {
        em.lockFailures.add(op.id)
        throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' })
      }),
    })
    await expect(runSalesOperation(deps(em, dispatcher, makeHandler()), op.id)).rejects.toThrow('connection reset')
    expect(op.attempts).toBe(0)
    expect(op.lastError).toBeNull()
  })

  it('does not overwrite an operation that finished after the failed attempt', async () => {
    const em = new FakeEm()
    const op = seedOperation(em, { kind: 'lease_order' })
    const dispatcher = makeDispatcher({
      createOrder: jest.fn(async () => {
        op.status = 'done'
        throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' })
      }),
    })
    await expect(runSalesOperation(deps(em, dispatcher, makeHandler()), op.id)).rejects.toThrow('connection reset')
    expect(op).toMatchObject({ status: 'done', attempts: 0, lastError: null })
  })

  it('marks a permanent sales refusal as refused and never retries it', async () => {
    const em = new FakeEm()
    const op = seedOperation(em, { kind: 'lease_order' })
    const handler = makeHandler()
    const dispatcher = makeDispatcher({
      createOrder: jest.fn(async () => {
        throw new CrudHttpError(422, { error: 'Invalid line', code: 'validation_failed' })
      }),
    })
    expect(await runSalesOperation(deps(em, dispatcher, handler), op.id)).toBe('refused')
    expect(op.status).toBe('refused')
    expect(handler.onRefused).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'permanent', code: 'validation_failed' }))
    expect(await runSalesOperation(deps(em, dispatcher, handler), op.id)).toBe('skipped')
  })

  it('compensates without calling sales when the hold was released before any document existed', async () => {
    const em = new FakeEm()
    const op = seedOperation(em, { kind: 'lease_order' })
    const handler = makeHandler({ isHoldValid: jest.fn(async () => false) })
    const dispatcher = makeDispatcher()
    expect(await runSalesOperation(deps(em, dispatcher, handler), op.id)).toBe('compensated')
    expect(dispatcher.createOrder).not.toHaveBeenCalled()
    expect(handler.onCompensated).toHaveBeenCalled()
  })

  it('cancels the new order from its start in a fresh run when the hold was released during creation', async () => {
    const em = new FakeEm()
    const op = seedOperation(em, { kind: 'extension_order' })
    const handler = makeHandler({ finish: jest.fn(async () => 'invalid' as const) })
    const dispatcher = makeDispatcher()
    const enqueuer = jest.fn(async () => undefined)
    expect(await runSalesOperation(deps(em, dispatcher, handler, enqueuer), op.id)).toBe('compensating')
    expect(op).toMatchObject({ status: 'compensating', salesDocumentId: 'order-1' })
    expect(dispatcher.cancelRecurrence).not.toHaveBeenCalled()
    expect(dispatcher.readRecurrence).not.toHaveBeenCalled()
    expect(enqueuer).toHaveBeenCalledWith([op.id])
    expect(await runSalesOperation(deps(em, dispatcher, handler, enqueuer), op.id)).toBe('compensated')
    expect(handler.finish).toHaveBeenCalledTimes(1)
    expect(dispatcher.cancelRecurrence).toHaveBeenCalledWith({
      orderId: 'order-1',
      effectiveOn: '2026-01-10',
      settlement: 'credit_full',
      idempotencyKey: `${op.id}:compensate`,
      scheduleVersion: 2,
      allowCredit: true,
    })
    expect(op.status).toBe('compensated')
  })

  it('keeps the operation compensating when compensation fails and reports it', async () => {
    const em = new FakeEm()
    const op = seedOperation(em, { kind: 'lease_order' })
    const handler = makeHandler({ finish: jest.fn(async () => 'invalid' as const) })
    const dispatcher = makeDispatcher({
      cancelRecurrence: jest.fn(async () => {
        throw new CrudHttpError(503, { error: 'Sales is down' })
      }),
    })
    expect(await runSalesOperation(deps(em, dispatcher, handler), op.id)).toBe('compensating')
    expect(dispatcher.cancelRecurrence).not.toHaveBeenCalled()
    expect(handler.onCompensationFailed).not.toHaveBeenCalled()
    expect(await runSalesOperation(deps(em, dispatcher, handler), op.id)).toBe('compensating')
    expect(op.status).toBe('compensating')
    expect(op.lastError).toMatchObject({ compensation: true })
    expect(handler.onCompensationFailed).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'transient', status: 503 }), { first: true })
    expect(await runSalesOperation(deps(em, dispatcher, handler), op.id)).toBe('compensating')
    expect(handler.onCompensationFailed).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), { first: false })
  })

  it('treats the first compensation failure as first even after failed creation attempts', async () => {
    const em = new FakeEm()
    const op = seedOperation(em, { kind: 'lease_order', attempts: 4, lastError: { code: 'sales_unavailable', message: null, status: 503 } })
    const handler = makeHandler({ finish: jest.fn(async () => 'invalid' as const) })
    const dispatcher = makeDispatcher({
      cancelRecurrence: jest.fn(async () => {
        throw new CrudHttpError(503, { error: 'Sales is down' })
      }),
    })
    await runSalesOperation(deps(em, dispatcher, handler), op.id)
    await runSalesOperation(deps(em, dispatcher, handler), op.id)
    expect(handler.onCompensationFailed).toHaveBeenCalledWith(expect.anything(), expect.anything(), { first: true })
  })

  it('keeps the compensation flag when a later attempt fails outside the compensation call', async () => {
    const em = new FakeEm()
    const op = seedOperation(em, {
      kind: 'lease_order',
      status: 'compensating',
      salesDocumentId: 'order-1',
      salesDocumentType: 'order',
      attempts: 1,
      lastError: { code: 'sales_unavailable', message: null, status: 503, compensation: true },
    })
    const handler = makeHandler({
      onCompensationFailed: jest.fn(async () => {
        throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' })
      }),
    })
    const dispatcher = makeDispatcher({
      cancelRecurrence: jest.fn(async () => {
        throw new CrudHttpError(503, { error: 'Sales is down' })
      }),
    })
    await expect(runSalesOperation(deps(em, dispatcher, handler), op.id)).rejects.toThrow('connection reset')
    expect(op.lastError).toMatchObject({ code: 'ECONNRESET', compensation: true })
    await expect(runSalesOperation(deps(em, dispatcher, handler), op.id)).rejects.toThrow('connection reset')
    expect(handler.onCompensationFailed).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), { first: false })
  })

  it('keeps a compensation waiting for the sales contract without raising an orphaned-order alert', async () => {
    const em = new FakeEm()
    const op = seedOperation(em, { kind: 'lease_order' })
    const handler = makeHandler({ finish: jest.fn(async () => 'invalid' as const) })
    const dispatcher = makeDispatcher({
      cancelRecurrence: jest.fn(async () => {
        throw new SalesContractUnavailableError('sales.orders.recurrence.cancel')
      }),
    })
    expect(await runSalesOperation(deps(em, dispatcher, handler), op.id)).toBe('compensating')
    expect(op.attempts).toBe(0)
    expect(await runSalesOperation(deps(em, dispatcher, handler), op.id)).toBe('unavailable')
    expect(op.status).toBe('compensating')
    expect(op.attempts).toBe(1)
    expect(op.lastError).toMatchObject({ code: 'sales_contract_unavailable' })
    expect(op.lastError?.compensation).toBeUndefined()
    expect(handler.onCompensationFailed).not.toHaveBeenCalled()
    expect(handler.onCompensated).not.toHaveBeenCalled()
    expect(await runSalesOperation(deps(em, dispatcher, handler), op.id)).toBe('unavailable')
    expect(op.attempts).toBe(2)
    expect(handler.onCompensationFailed).not.toHaveBeenCalled()
  })

  it('still alerts on the first real compensation failure after waiting for the sales contract', async () => {
    const em = new FakeEm()
    const op = seedOperation(em, { kind: 'lease_order' })
    const handler = makeHandler({ finish: jest.fn(async () => 'invalid' as const) })
    const cancelRecurrence = jest
      .fn()
      .mockRejectedValueOnce(new SalesContractUnavailableError('sales.orders.recurrence.cancel'))
      .mockRejectedValueOnce(new CrudHttpError(503, { error: 'Sales is down' }))
    const dispatcher = makeDispatcher({ cancelRecurrence })
    expect(await runSalesOperation(deps(em, dispatcher, handler), op.id)).toBe('compensating')
    expect(await runSalesOperation(deps(em, dispatcher, handler), op.id)).toBe('unavailable')
    expect(await runSalesOperation(deps(em, dispatcher, handler), op.id)).toBe('compensating')
    expect(handler.onCompensationFailed).toHaveBeenCalledTimes(1)
    expect(handler.onCompensationFailed).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'transient' }), { first: true })
  })

  it('alerts staff once when an operation reaches the stalled-attempts threshold and keeps retrying it', async () => {
    const em = new FakeEm()
    const op = seedOperation(em, { kind: 'lease_order', attempts: STALLED_OPERATION_ATTEMPTS - 2 })
    const failure = new Error('something unexpected')
    const dispatcher = makeDispatcher({
      createOrder: jest.fn(async () => {
        throw failure
      }),
    })
    const runner = deps(em, dispatcher, makeHandler())
    await expect(runSalesOperation(runner, op.id)).rejects.toThrow('something unexpected')
    expect(reportStalledOperation).not.toHaveBeenCalled()
    await expect(runSalesOperation(runner, op.id)).rejects.toThrow('something unexpected')
    expect(reportStalledOperation).toHaveBeenCalledTimes(1)
    expect(reportStalledOperation).toHaveBeenCalledWith(
      expect.objectContaining({ op: expect.objectContaining({ id: op.id }), attempts: STALLED_OPERATION_ATTEMPTS, cause: failure, error: expect.objectContaining({ kind: 'transient' }) }),
    )
    await expect(runSalesOperation(runner, op.id)).rejects.toThrow('something unexpected')
    expect(reportStalledOperation).toHaveBeenCalledTimes(1)
    expect(op.status).toBe('pending')
    expect(op.attempts).toBe(STALLED_OPERATION_ATTEMPTS + 1)
  })

  it('alerts once when an operation already past the threshold starts failing transiently', async () => {
    const em = new FakeEm()
    const op = seedOperation(em, { kind: 'lease_order', attempts: STALLED_OPERATION_ATTEMPTS + 1 })
    const failure = new Error('connection reset')
    const dispatcher = makeDispatcher({
      createOrder: jest.fn(async () => {
        throw failure
      }),
    })
    const runner = deps(em, dispatcher, makeHandler())
    await expect(runSalesOperation(runner, op.id)).rejects.toThrow('connection reset')
    expect(reportStalledOperation).toHaveBeenCalledTimes(1)
    expect(reportStalledOperation).toHaveBeenCalledWith(expect.objectContaining({ attempts: STALLED_OPERATION_ATTEMPTS + 2, cause: failure }))
    expect(op.lastError).toMatchObject({ stalledReported: true })
    await expect(runSalesOperation(runner, op.id)).rejects.toThrow('connection reset')
    expect(reportStalledOperation).toHaveBeenCalledTimes(1)
    expect(op.attempts).toBe(STALLED_OPERATION_ATTEMPTS + 3)
    expect(op.lastError).toMatchObject({ stalledReported: true })
  })

  it('alerts when an operation that waited for the sales contract past the threshold then fails transiently', async () => {
    const em = new FakeEm()
    const op = seedOperation(em, {
      kind: 'recurrence_cancel',
      targetType: 'lease',
      attempts: STALLED_OPERATION_ATTEMPTS - 1,
      payload: { orderId: 'order-1', effectiveOn: '2026-05-15', settlement: 'keep' },
    })
    const cancelRecurrence = jest
      .fn()
      .mockRejectedValueOnce(new SalesContractUnavailableError('sales.orders.recurrence.cancel'))
      .mockRejectedValueOnce(new SalesContractUnavailableError('sales.orders.recurrence.cancel'))
      .mockRejectedValue(new CrudHttpError(503, { error: 'Sales is down' }))
    const runner = deps(em, makeDispatcher({ cancelRecurrence }), makeHandler())
    expect(await runSalesOperation(runner, op.id)).toBe('unavailable')
    expect(await runSalesOperation(runner, op.id)).toBe('unavailable')
    expect(op.attempts).toBe(STALLED_OPERATION_ATTEMPTS + 1)
    expect(reportStalledOperation).not.toHaveBeenCalled()
    await expect(runSalesOperation(runner, op.id)).rejects.toBeInstanceOf(CrudHttpError)
    expect(reportStalledOperation).toHaveBeenCalledTimes(1)
    await expect(runSalesOperation(runner, op.id)).rejects.toBeInstanceOf(CrudHttpError)
    expect(reportStalledOperation).toHaveBeenCalledTimes(1)
  })

  it('does not raise a stalled alert while an operation waits for the sales contract', async () => {
    const em = new FakeEm()
    const op = seedOperation(em, {
      kind: 'recurrence_cancel',
      targetType: 'lease',
      attempts: STALLED_OPERATION_ATTEMPTS - 1,
      payload: { orderId: 'order-1', effectiveOn: '2026-05-15', settlement: 'keep' },
    })
    const dispatcher = makeDispatcher({
      cancelRecurrence: jest.fn(async () => {
        throw new SalesContractUnavailableError('sales.orders.recurrence.cancel')
      }),
    })
    expect(await runSalesOperation(deps(em, dispatcher, makeHandler()), op.id)).toBe('unavailable')
    expect(op.attempts).toBe(STALLED_OPERATION_ATTEMPTS)
    expect(reportStalledOperation).not.toHaveBeenCalled()
  })

  it('passes allowCredit, the fresh schedule version and the operation id to a recurrence cancellation', async () => {
    const em = new FakeEm()
    const op = seedOperation(em, {
      kind: 'recurrence_cancel',
      targetType: 'lease',
      allowCredit: false,
      payload: { orderId: 'order-1', effectiveOn: '2026-05-15', settlement: 'keep' },
    })
    const dispatcher = makeDispatcher({ readRecurrence: jest.fn(async () => recurrence({ scheduleVersion: 7 })) })
    expect(await runSalesOperation(deps(em, dispatcher, makeHandler()), op.id)).toBe('done')
    expect(dispatcher.cancelRecurrence).toHaveBeenCalledWith({
      orderId: 'order-1',
      effectiveOn: '2026-05-15',
      settlement: 'keep',
      idempotencyKey: op.id,
      scheduleVersion: 7,
      allowCredit: false,
    })
  })

  it('treats recurring_cancel_would_credit as a permanent refusal', async () => {
    const em = new FakeEm()
    const op = seedOperation(em, {
      kind: 'recurrence_cancel',
      targetType: 'lease',
      allowCredit: false,
      payload: { orderId: 'order-1', effectiveOn: '2026-05-15', settlement: 'keep' },
    })
    const handler = makeHandler()
    const dispatcher = makeDispatcher({
      cancelRecurrence: jest.fn(async () => {
        throw new CrudHttpError(409, { error: 'Would credit', code: 'recurring_cancel_would_credit' })
      }),
    })
    expect(await runSalesOperation(deps(em, dispatcher, handler), op.id)).toBe('refused')
    expect(op.lastError).toMatchObject({ code: 'recurring_cancel_would_credit', status: 409 })
  })

  it('leaves the operation pending when sales cannot cancel recurrences yet', async () => {
    const em = new FakeEm()
    const op = seedOperation(em, {
      kind: 'recurrence_cancel',
      targetType: 'lease',
      payload: { orderId: 'order-1', effectiveOn: '2026-05-15', settlement: 'keep' },
    })
    const dispatcher = makeDispatcher({
      cancelRecurrence: jest.fn(async () => {
        throw new SalesContractUnavailableError('sales.orders.recurrence.cancel')
      }),
    })
    expect(await runSalesOperation(deps(em, dispatcher, makeHandler()), op.id)).toBe('unavailable')
    expect(op.status).toBe('pending')
    expect(op.attempts).toBe(1)
  })

  it('defers an operation whose predecessor in the same change is not done', async () => {
    const em = new FakeEm()
    seedOperation(em, { kind: 'lease_order', changeId: 'change-1', sequence: 1, status: 'pending' })
    const second = seedOperation(em, {
      kind: 'recurrence_cancel',
      changeId: 'change-1',
      sequence: 2,
      targetType: 'lease',
      payload: { orderId: 'order-1', effectiveOn: '2026-05-15', settlement: 'keep' },
    })
    const dispatcher = makeDispatcher()
    expect(await runSalesOperation(deps(em, dispatcher, makeHandler()), second.id)).toBe('deferred')
    expect(dispatcher.cancelRecurrence).not.toHaveBeenCalled()
  })

  it('counts a missing quote as done for a status change', async () => {
    const em = new FakeEm()
    const op = seedOperation(em, { kind: 'quote_status', targetType: 'lease_proposal', payload: { quoteId: 'quote-1', status: 'canceled' } })
    const dispatcher = makeDispatcher({
      loadDocument: jest.fn(async () => null),
    })
    expect(await runSalesOperation(deps(em, dispatcher, makeHandler()), op.id)).toBe('done')
    expect(dispatcher.updateDocumentStatus).not.toHaveBeenCalled()
  })

  it('sets a quote status only when it differs from the target', async () => {
    const em = new FakeEm()
    const op = seedOperation(em, { kind: 'quote_status', targetType: 'lease_proposal', payload: { quoteId: 'quote-1', status: 'canceled' } })
    const quote = { id: 'quote-1', number: 'Q-1', status: 'draft', statusEntryId: 'status-draft', deleted: false }
    const dispatcher = makeDispatcher({
      loadDocument: jest.fn(async () => ({ ...quote })),
      updateDocumentStatus: jest.fn(async (_kind, _id, statusEntryId: string) => {
        quote.statusEntryId = statusEntryId
        quote.status = statusEntryId.replace('status-', '')
      }),
    })
    expect(await runSalesOperation(deps(em, dispatcher, makeHandler()), op.id)).toBe('done')
    expect(dispatcher.updateDocumentStatus).toHaveBeenCalledTimes(1)
    expect(dispatcher.updateDocumentStatus).toHaveBeenCalledWith('quote', 'quote-1', 'status-canceled')
    expect(await runSalesOperation(deps(em, dispatcher, makeHandler()), seedOperation(em, {
      kind: 'quote_status',
      targetType: 'lease_proposal',
      payload: { quoteId: 'quote-1', status: 'canceled' },
    }).id)).toBe('done')
    expect(dispatcher.updateDocumentStatus).toHaveBeenCalledTimes(1)
  })

  it('cancels a sent quote although sales reverts its first update to draft', async () => {
    const em = new FakeEm()
    const op = seedOperation(em, { kind: 'quote_status', targetType: 'lease_proposal', payload: { quoteId: 'quote-1', status: 'canceled' } })
    const quote = { id: 'quote-1', number: 'Q-1', status: 'sent', statusEntryId: 'status-sent', deleted: false }
    const dispatcher = makeDispatcher({
      loadDocument: jest.fn(async () => ({ ...quote })),
      updateDocumentStatus: jest.fn(async (_kind, _id, statusEntryId: string) => {
        if (quote.status === 'sent') {
          quote.status = 'draft'
          quote.statusEntryId = 'status-draft'
          return
        }
        quote.statusEntryId = statusEntryId
        quote.status = statusEntryId.replace('status-', '')
      }),
    })
    expect(await runSalesOperation(deps(em, dispatcher, makeHandler()), op.id)).toBe('done')
    expect(dispatcher.updateDocumentStatus).toHaveBeenCalledTimes(2)
    expect(quote).toMatchObject({ status: 'canceled', statusEntryId: 'status-canceled' })
    expect(op.status).toBe('done')
  })

  it('refuses a status change sales keeps reverting instead of reporting it done', async () => {
    const em = new FakeEm()
    const op = seedOperation(em, { kind: 'quote_status', targetType: 'lease_proposal', payload: { quoteId: 'quote-1', status: 'canceled' } })
    const handler = makeHandler()
    const dispatcher = makeDispatcher({
      loadDocument: jest.fn(async () => ({ id: 'quote-1', number: 'Q-1', status: 'draft', statusEntryId: 'status-draft', deleted: false })),
    })
    expect(await runSalesOperation(deps(em, dispatcher, handler), op.id)).toBe('refused')
    expect(dispatcher.updateDocumentStatus).toHaveBeenCalledTimes(2)
    expect(op.lastError).toMatchObject({ code: 'sales_status_not_applied' })
    expect(handler.onRefused).toHaveBeenCalled()
  })

  it('reports duplicated documents and keeps the first', async () => {
    const em = new FakeEm()
    const op = seedOperation(em, { kind: 'quote', targetType: 'lease_proposal' })
    const handler = makeHandler()
    const dispatcher = makeDispatcher({ findDocuments: jest.fn(async () => ['quote-a', 'quote-b']) })
    expect(await runSalesOperation(deps(em, dispatcher, handler), op.id)).toBe('done')
    expect(handler.onDuplicated).toHaveBeenCalledWith(expect.anything(), ['quote-b'])
    expect(op.salesDocumentId).toBe('quote-a')
    expect(dispatcher.createQuote).not.toHaveBeenCalled()
  })

  it('reads the order line of a duplicated order before the handler compensates the duplicates', async () => {
    const em = new FakeEm()
    const op = seedOperation(em, { kind: 'lease_order' })
    const steps: string[] = []
    const handler = makeHandler({ onDuplicated: jest.fn(async () => void steps.push('onDuplicated')) })
    const dispatcher = makeDispatcher({
      findDocuments: jest.fn(async () => ['order-a', 'order-b']),
      firstOrderLineId: jest.fn(async () => {
        steps.push('firstOrderLineId')
        return 'line-a'
      }),
    })
    expect(await runSalesOperation(deps(em, dispatcher, handler), op.id)).toBe('done')
    expect(steps).toEqual(['firstOrderLineId', 'onDuplicated'])
    expect(handler.onDuplicated).toHaveBeenCalledWith(expect.anything(), ['order-b'])
    expect(op).toMatchObject({ salesDocumentId: 'order-a', salesDocumentLineId: 'line-a' })
  })

  it('raises the stalled alert once when a compensation keeps failing past the threshold', async () => {
    const em = new FakeEm()
    const op = seedOperation(em, {
      kind: 'lease_order',
      status: 'compensating',
      salesDocumentId: 'order-1',
      salesDocumentType: 'order',
      attempts: STALLED_OPERATION_ATTEMPTS - 2,
      lastError: { code: 'sales_unavailable', message: null, status: 503, compensation: true },
    })
    const failure = new CrudHttpError(503, { error: 'Sales is down' })
    const dispatcher = makeDispatcher({
      cancelRecurrence: jest.fn(async () => {
        throw failure
      }),
    })
    const handler = makeHandler()
    const runner = deps(em, dispatcher, handler)
    expect(await runSalesOperation(runner, op.id)).toBe('compensating')
    expect(reportStalledOperation).not.toHaveBeenCalled()
    expect(await runSalesOperation(runner, op.id)).toBe('compensating')
    expect(reportStalledOperation).toHaveBeenCalledTimes(1)
    expect(reportStalledOperation).toHaveBeenCalledWith(
      expect.objectContaining({ op: expect.objectContaining({ id: op.id }), attempts: STALLED_OPERATION_ATTEMPTS, cause: failure, error: expect.objectContaining({ kind: 'transient', status: 503 }) }),
    )
    expect(op.lastError).toMatchObject({ compensation: true, stalledReported: true })
    expect(await runSalesOperation(runner, op.id)).toBe('compensating')
    expect(reportStalledOperation).toHaveBeenCalledTimes(1)
    expect(op.lastError).toMatchObject({ compensation: true, stalledReported: true })
    expect(op.attempts).toBe(STALLED_OPERATION_ATTEMPTS + 1)
    expect(handler.onCompensationFailed).toHaveBeenCalledTimes(3)
  })

  it('gives up on a sales call that outlives the dispatch timeout, looks the document up and retries', async () => {
    const em = new FakeEm()
    const op = seedOperation(em, { kind: 'lease_order' })
    const late = deferred<string>()
    const enqueuer = jest.fn(async () => undefined)
    const recheckEnqueuer = jest.fn(async () => undefined)
    const dispatcher = makeDispatcher({ createOrder: jest.fn(() => late.promise) })
    const runner = { ...deps(em, dispatcher, makeHandler(), enqueuer), recheckEnqueuer, dispatchTimeoutMs: 20 }
    await expect(runSalesOperation(runner, op.id)).rejects.toBeInstanceOf(SalesDispatchTimeoutError)
    expect(dispatcher.findDocuments).toHaveBeenCalledTimes(2)
    expect(op).toMatchObject({ status: 'pending', attempts: 1, lastError: expect.objectContaining({ code: 'sales_dispatch_timeout' }) })
    expect(recheckEnqueuer).not.toHaveBeenCalled()
    late.resolve('order-late')
    await flushTasks()
    expect(recheckEnqueuer).toHaveBeenCalledWith(op.id, 1)
    expect(enqueuer).not.toHaveBeenCalled()
  })

  it('cancels a document a timed-out dispatch committed after another run finished the operation', async () => {
    const em = new FakeEm()
    const op = seedOperation(em, { kind: 'lease_order' })
    const late = deferred<string>()
    const handler = makeHandler()
    const documents: string[] = []
    const recheckEnqueuer = jest.fn(async () => undefined)
    const dispatcher = makeDispatcher({
      createOrder: jest.fn(() => late.promise),
      findDocuments: jest.fn(async () => [...documents]),
    })
    const runner = { ...deps(em, dispatcher, handler), recheckEnqueuer, dispatchTimeoutMs: 20 }
    await expect(runSalesOperation(runner, op.id)).rejects.toBeInstanceOf(SalesDispatchTimeoutError)
    Object.assign(op, { status: 'done', salesDocumentType: 'order', salesDocumentId: 'order-second' })
    documents.push('order-second')
    documents.push('order-first')
    late.resolve('order-first')
    await flushTasks()
    expect(recheckEnqueuer).toHaveBeenCalledWith(op.id, 1)
    expect(await runSalesOperation(runner, op.id, { recheck: 1 })).toBe('reconciled')
    expect(handler.onDuplicated).toHaveBeenCalledWith(expect.anything(), ['order-first'])
    expect(op).toMatchObject({ status: 'done', salesDocumentId: 'order-second' })
    expect(dispatcher.createOrder).toHaveBeenCalledTimes(1)
  })

  it('re-checks a late creation again later when another run holds the operation, then reconciles the duplicate', async () => {
    const em = new FakeEm()
    const op = seedOperation(em, { kind: 'lease_order', status: 'done', salesDocumentType: 'order', salesDocumentId: 'order-cli' })
    const handler = makeHandler()
    const recheckEnqueuer = jest.fn(async () => undefined)
    const dispatcher = makeDispatcher({ findDocuments: jest.fn(async () => ['order-cli', 'order-late']) })
    const runner = { ...deps(em, dispatcher, handler), recheckEnqueuer }
    em.lockFailures.add(op.id)
    expect(await runSalesOperation(runner, op.id, { recheck: 1 })).toBe('locked')
    expect(recheckEnqueuer).toHaveBeenCalledWith(op.id, 2)
    expect(handler.onDuplicated).not.toHaveBeenCalled()
    em.lockFailures.delete(op.id)
    expect(await runSalesOperation(runner, op.id, { recheck: 2 })).toBe('reconciled')
    expect(handler.onDuplicated).toHaveBeenCalledWith(expect.anything(), ['order-late'])
  })

  it('ends a plain run that finds the operation locked without scheduling a re-check', async () => {
    const em = new FakeEm()
    const op = seedOperation(em, { kind: 'lease_order' })
    const recheckEnqueuer = jest.fn(async () => undefined)
    em.lockFailures.add(op.id)
    expect(await runSalesOperation({ ...deps(em, makeDispatcher(), makeHandler()), recheckEnqueuer }, op.id)).toBe('locked')
    expect(recheckEnqueuer).not.toHaveBeenCalled()
  })

  it('stops re-checking a locked operation after the last allowed re-check and reports it', async () => {
    const em = new FakeEm()
    const op = seedOperation(em, { kind: 'lease_order' })
    const recheckEnqueuer = jest.fn(async () => undefined)
    em.lockFailures.add(op.id)
    const runner = { ...deps(em, makeDispatcher(), makeHandler()), recheckEnqueuer }
    expect(await runSalesOperation(runner, op.id, { recheck: MAX_SALES_OPERATION_RECHECKS })).toBe('locked')
    expect(recheckEnqueuer).not.toHaveBeenCalled()
  })

  it('compensates the second of two finished creations without waiting on the first', async () => {
    const em = new FakeEm()
    seedOperation(em, { kind: 'extension_order', changeId: 'change-1', sequence: 1, status: 'compensating', salesDocumentType: 'order', salesDocumentId: 'order-a' })
    const second = seedOperation(em, {
      kind: 'extension_order',
      changeId: 'change-1',
      sequence: 2,
      status: 'compensating',
      salesDocumentType: 'order',
      salesDocumentId: 'order-b',
    })
    const handler = makeHandler()
    const dispatcher = makeDispatcher()
    expect(await runSalesOperation(deps(em, dispatcher, handler), second.id)).toBe('compensated')
    expect(dispatcher.cancelRecurrence).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'order-b', settlement: 'credit_full' }))
    expect(handler.onCompensated).toHaveBeenCalled()
  })

  it('compensates a document that turned up after the operation was refused', async () => {
    const em = new FakeEm()
    const op = seedOperation(em, { kind: 'booking_order', targetType: 'booking', status: 'refused' })
    const handler = makeHandler()
    const dispatcher = makeDispatcher({ findDocuments: jest.fn(async () => ['order-late']) })
    expect(await runSalesOperation(deps(em, dispatcher, handler), op.id)).toBe('reconciled')
    expect(handler.onDuplicated).toHaveBeenCalledWith(expect.anything(), ['order-late'])
    expect(op.status).toBe('refused')
  })

  it('leaves a finished status change alone without reading sales', async () => {
    const em = new FakeEm()
    const op = seedOperation(em, { kind: 'order_status', targetType: 'lease', status: 'done', payload: { orderId: 'order-1', status: 'confirmed' } })
    const dispatcher = makeDispatcher()
    expect(await runSalesOperation(deps(em, dispatcher, makeHandler()), op.id)).toBe('skipped')
    expect(dispatcher.findDocuments).not.toHaveBeenCalled()
  })

  it('re-checks its transaction before every sales call', async () => {
    const em = new FakeEm()
    const op = seedOperation(em, { kind: 'lease_order' })
    expect(await runSalesOperation(deps(em, makeDispatcher(), makeHandler()), op.id)).toBe('done')
    expect(em.executed.filter((entry) => entry.sql === 'select 1')).toHaveLength(4)
  })

  it('counts a refused recurrence cancellation as done when sales already holds the same cancellation', async () => {
    const em = new FakeEm()
    const op = seedOperation(em, {
      kind: 'recurrence_cancel',
      targetType: 'lease',
      payload: { orderId: 'order-1', effectiveOn: '2026-05-15', settlement: 'keep' },
    })
    const handler = makeHandler()
    const dispatcher = makeDispatcher({
      readRecurrence: jest
        .fn()
        .mockResolvedValueOnce(recurrence())
        .mockResolvedValueOnce(recurrence({ status: 'cancelled', cancelEffectiveOn: '2026-05-15', cancelSettlement: 'keep' })),
      cancelRecurrence: jest.fn(async () => {
        throw new CrudHttpError(409, { error: 'Already cancelled', code: 'recurring_order_already_cancelled' })
      }),
    })
    expect(await runSalesOperation(deps(em, dispatcher, handler), op.id)).toBe('done')
    expect(op).toMatchObject({ status: 'done', salesDocumentId: 'order-1' })
    expect(handler.onRefused).not.toHaveBeenCalled()
  })

  it('still refuses a recurrence cancellation when sales holds a different one', async () => {
    const em = new FakeEm()
    const op = seedOperation(em, {
      kind: 'recurrence_cancel',
      targetType: 'lease',
      payload: { orderId: 'order-1', effectiveOn: '2026-05-15', settlement: 'keep' },
    })
    const handler = makeHandler()
    const dispatcher = makeDispatcher({
      readRecurrence: jest.fn(async () => recurrence({ status: 'cancelled', cancelEffectiveOn: '2026-04-15', cancelSettlement: 'keep' })),
      cancelRecurrence: jest.fn(async () => {
        throw new CrudHttpError(409, { error: 'Already cancelled', code: 'recurring_order_already_cancelled' })
      }),
    })
    expect(await runSalesOperation(deps(em, dispatcher, handler), op.id)).toBe('refused')
    expect(handler.onRefused).toHaveBeenCalled()
  })

  it('counts a refused recurrence cancellation as done when sales holds the same future cutoff as cancelling', async () => {
    const em = new FakeEm()
    const op = seedOperation(em, {
      kind: 'recurrence_cancel',
      targetType: 'lease',
      payload: { orderId: 'order-1', effectiveOn: '2026-05-15', settlement: 'prorate' },
    })
    const handler = makeHandler()
    const dispatcher = makeDispatcher({
      readRecurrence: jest
        .fn()
        .mockResolvedValueOnce(recurrence({ status: 'active' }))
        .mockResolvedValueOnce(recurrence({ status: 'cancelling', cancelEffectiveOn: '2026-05-15', cancelSettlement: 'prorate' })),
      cancelRecurrence: jest.fn(async () => {
        throw new CrudHttpError(409, { error: 'Pending', code: 'recurring_order_cancel_pending' })
      }),
    })
    expect(await runSalesOperation(deps(em, dispatcher, handler), op.id)).toBe('done')
    expect(op).toMatchObject({ status: 'done', salesDocumentId: 'order-1' })
    expect(handler.onRefused).not.toHaveBeenCalled()
  })

  it('does not cancel again an order whose future start is already cancelled as cancelling', async () => {
    const em = new FakeEm()
    const op = seedOperation(em, { kind: 'lease_order', status: 'compensating', salesDocumentType: 'order', salesDocumentId: 'order-1' })
    const handler = makeHandler()
    const dispatcher = makeDispatcher({
      readRecurrence: jest.fn(async () => recurrence({ status: 'cancelling', startsOn: '2026-06-01', cancelEffectiveOn: '2026-06-01', cancelSettlement: 'credit_full' })),
    })
    expect(await runSalesOperation(deps(em, dispatcher, handler), op.id)).toBe('compensated')
    expect(dispatcher.cancelRecurrence).not.toHaveBeenCalled()
    expect(handler.onCompensated).toHaveBeenCalled()
  })

  it('counts a refused order status change as done when the order already carries the status', async () => {
    const em = new FakeEm()
    const op = seedOperation(em, { kind: 'order_status', targetType: 'booking', payload: { orderId: 'order-1', statusEntryId: 'status-cancelled' } })
    const handler = makeHandler()
    const dispatcher = makeDispatcher({
      loadDocument: jest
        .fn()
        .mockResolvedValueOnce({ id: 'order-1', number: 'O-1', status: 'confirmed', statusEntryId: 'status-confirmed', deleted: false })
        .mockResolvedValueOnce({ id: 'order-1', number: 'O-1', status: 'cancelled', statusEntryId: 'status-cancelled', deleted: false }),
      updateDocumentStatus: jest.fn(async () => {
        throw new CrudHttpError(409, { error: 'Order changed', code: 'order_conflict' })
      }),
    })
    expect(await runSalesOperation(deps(em, dispatcher, handler), op.id)).toBe('done')
    expect(handler.onRefused).not.toHaveBeenCalled()
    expect(handler.onDone).toHaveBeenCalled()
  })

  it('enqueues the operations a handler schedules only after the transaction', async () => {
    const em = new FakeEm()
    const op = seedOperation(em, { kind: 'lease_order' })
    const enqueuer = jest.fn(async () => undefined)
    const handler = makeHandler({
      onDone: jest.fn(async (ctx) => {
        ctx.enqueue(['next-op'])
      }),
    })
    await runSalesOperation(deps(em, makeDispatcher(), handler, enqueuer), op.id)
    expect(enqueuer).toHaveBeenCalledWith(['next-op'])
  })
})
