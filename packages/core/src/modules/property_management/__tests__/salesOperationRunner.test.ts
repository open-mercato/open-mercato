/** @jest-environment node */
import type { AwilixContainer } from 'awilix'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { SalesOperation, type SalesOperationKind, type SalesOperationStatus } from '../data/entities'
import { FakeEm } from './support/fakeEm'

jest.mock('@open-mercato/shared/lib/encryption/find', () => jest.requireActual('./support/fakeEm').encryptionFindMock())
jest.mock('@open-mercato/queue', () => ({ createModuleQueue: jest.fn(() => ({ enqueue: jest.fn() })) }))

import { runSalesOperation, type OperationTargetHandler, type RunnerDeps } from '../lib/salesOperationRunner'
import type { SalesDispatcher } from '../lib/salesDispatcher'
import { SalesContractUnavailableError } from '../lib/salesErrors'
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

  it('cancels the new order from its start when the hold was released during creation', async () => {
    const em = new FakeEm()
    const op = seedOperation(em, { kind: 'extension_order' })
    const handler = makeHandler({ finish: jest.fn(async () => 'invalid' as const) })
    const dispatcher = makeDispatcher()
    expect(await runSalesOperation(deps(em, dispatcher, handler), op.id)).toBe('compensated')
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
        throw new SalesContractUnavailableError('sales.orders.recurrence.cancel')
      }),
    })
    expect(await runSalesOperation(deps(em, dispatcher, handler), op.id)).toBe('compensating')
    expect(op.status).toBe('compensating')
    expect(handler.onCompensationFailed).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'unavailable' }))
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
    const dispatcher = makeDispatcher()
    expect(await runSalesOperation(deps(em, dispatcher, makeHandler()), op.id)).toBe('done')
    expect(dispatcher.updateDocumentStatus).toHaveBeenCalledWith('quote', 'quote-1', 'status-canceled')
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
