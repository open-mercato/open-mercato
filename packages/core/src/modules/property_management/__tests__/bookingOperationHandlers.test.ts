/** @jest-environment node */
import type { AwilixContainer } from 'awilix'
import { Booking, PropertyManagementSettings, SalesOperation, Unit, type SalesOperationKind } from '../data/entities'
import { FakeEm } from './support/fakeEm'

jest.mock('@open-mercato/shared/lib/encryption/find', () => jest.requireActual('./support/fakeEm').encryptionFindMock())
jest.mock('@open-mercato/queue', () => ({ createModuleQueue: jest.fn(() => ({ enqueue: jest.fn() })) }))
jest.mock('../lib/staffNotifications', () => ({ notifyStaff: jest.fn(async () => []) }))
jest.mock('../lib/bookingEvents', () => ({
  emitBookingEvent: jest.fn(async () => undefined),
  markBookingChanged: jest.fn(async () => undefined),
}))

import { bookingOperationHandler, duplicateBookingOrderCancellationSubjectKey } from '../lib/bookingOperationHandlers'
import { resolveOperationHandler } from '../lib/operationHandlers'
import { runSalesOperation, type OperationRunContext, type RunnerDeps } from '../lib/salesOperationRunner'
import type { SalesDispatcher } from '../lib/salesDispatcher'
import type { ClassifiedSalesError } from '../lib/salesErrors'
import { notifyStaff } from '../lib/staffNotifications'
import { emitBookingEvent } from '../lib/bookingEvents'

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const refusal: ClassifiedSalesError = { kind: 'permanent', status: 422, code: 'validation_failed', message: 'Invalid order' }
const CANCELLED_ENTRY = 'status-cancelled-entry'

function seedBooking(em: FakeEm, overrides: Partial<Booking> = {}): Booking {
  em.seed(Unit, { id: 'unit-1', ...scope, buildingId: 'b1', floorId: 'f1', spaceId: 's1', name: 'Studio 2B' })
  return em.seed(Booking, {
    id: 'booking-1',
    ...scope,
    buildingId: 'b1',
    unitId: 'unit-1',
    bookedByPersonId: 'person-1',
    customerCompanyId: null,
    customerUserId: null,
    startsAt: '2026-11-12 10:00:00',
    endsAt: '2026-11-12 12:00:00',
    status: 'pending',
    holdToken: 'token-1',
    catalogProductId: 'product-1',
    productName: 'Meeting room',
    unitPrice: '50',
    quantity: 2,
    billingUnit: 'hour',
    totalAmount: '100',
    currencyCode: 'EUR',
    salesOrderId: null,
    deletedAt: null,
    ...overrides,
  } as never) as unknown as Booking
}

function seedOp(em: FakeEm, overrides: Partial<SalesOperation> & { id: string; kind: SalesOperationKind }): SalesOperation {
  return em.seed(SalesOperation, {
    ...scope,
    subjectKey: overrides.id,
    payloadHash: 'h',
    payload: { lines: [{ productId: 'product-1' }], metadata: { propertyManagementBookingId: 'booking-1' } },
    changeId: null,
    sequence: 1,
    targetType: 'booking',
    targetId: 'booking-1',
    leaseId: null,
    status: 'pending',
    token: 'token-1',
    attempts: 0,
    lastError: null,
    ...overrides,
  } as never) as unknown as SalesOperation
}

function makeDispatcher(overrides: Partial<SalesDispatcher> = {}): jest.Mocked<SalesDispatcher> {
  const statusEntries = new Map<string, string>()
  return {
    createOrder: jest.fn(async () => 'order-1'),
    createQuote: jest.fn(async () => 'quote-1'),
    updateDocumentStatus: jest.fn(async (_kind, id: string, statusEntryId: string) => {
      statusEntries.set(id, statusEntryId)
    }),
    cancelRecurrence: jest.fn(async () => ({ status: 'cancelled', cancelEffectiveOn: null, creditMemoIds: [] })),
    readRecurrence: jest.fn(async () => null),
    findDocuments: jest.fn(async () => []),
    loadDocument: jest.fn(async (_kind, id: string) => ({
      id,
      number: 'SO-1',
      status: 'open',
      statusEntryId: statusEntries.get(id) ?? 'status-open',
      deleted: false,
    })),
    firstOrderLineId: jest.fn(async () => 'line-1'),
    resolveStatusEntryId: jest.fn(async (value: string) => `status-${value}`),
    ...overrides,
  } as jest.Mocked<SalesDispatcher>
}

function context(em: FakeEm, op: SalesOperation, dispatcher: SalesDispatcher = makeDispatcher()) {
  const ctx: OperationRunContext = {
    tx: em as never,
    op,
    scope,
    container: { resolve: jest.fn() } as unknown as AwilixContainer,
    dispatcher,
    postCommit: [],
    enqueue: jest.fn(),
    today: '2026-11-11',
  }
  const runPostCommit = async () => {
    for (const effect of ctx.postCommit) await effect()
  }
  return { ctx, runPostCommit }
}

function runnerDeps(em: FakeEm, dispatcher: SalesDispatcher): RunnerDeps {
  return {
    container: { resolve: jest.fn() } as unknown as AwilixContainer,
    em: em as never,
    resolveHandler: resolveOperationHandler,
    dispatcherFactory: () => dispatcher,
    enqueuer: jest.fn(async () => undefined),
    today: () => '2026-11-11',
  }
}

beforeEach(() => jest.clearAllMocks())

describe('booking operation handler', () => {
  it('routes booking operations to the booking handler', () => {
    const em = new FakeEm()
    expect(resolveOperationHandler(seedOp(em, { id: 'op-1', kind: 'booking_order' }))).toBe(bookingOperationHandler)
  })

  it('confirms the booking when its hold still carries the operation token', async () => {
    const em = new FakeEm()
    const booking = seedBooking(em)
    const op = seedOp(em, { id: 'op-1', kind: 'booking_order', salesDocumentId: 'order-9' })
    const { ctx } = context(em, op)
    expect(await bookingOperationHandler.isHoldValid(ctx)).toBe(true)
    expect(await bookingOperationHandler.finish(ctx)).toBe('done')
    expect(booking).toMatchObject({ status: 'confirmed', salesOrderId: 'order-9', holdToken: null })
  })

  it('reports an invalid hold once the booking was cancelled meanwhile', async () => {
    const em = new FakeEm()
    seedBooking(em, { status: 'cancelled', holdToken: null, cancelReason: 'manager' })
    const op = seedOp(em, { id: 'op-1', kind: 'booking_order' })
    const { ctx } = context(em, op)
    expect(await bookingOperationHandler.isHoldValid(ctx)).toBe(false)
    expect(await bookingOperationHandler.finish(ctx)).toBe('invalid')
  })

  it('releases the slot when sales refuses the order for good', async () => {
    const em = new FakeEm()
    const booking = seedBooking(em)
    const op = seedOp(em, { id: 'op-1', kind: 'booking_order', status: 'refused' })
    const { ctx, runPostCommit } = context(em, op)
    await bookingOperationHandler.onRefused(ctx, refusal)
    await runPostCommit()
    expect(booking).toMatchObject({ status: 'cancelled', cancelReason: 'order_refused', holdToken: null })
    expect(emitBookingEvent).toHaveBeenCalledWith('property_management.booking.cancelled', booking, { error: 'validation_failed' })
    expect(notifyStaff).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'property_management.booking.order_refused',
        bookingId: booking.id,
        buildingId: 'b1',
        audience: 'building',
        bodyVariables: expect.objectContaining({ reference: 'Meeting room · 2026-11-12 10:00' }),
        groupKey: 'property_management.booking.order_refused:op-1',
      }),
    )
  })

  it('does not alert staff about a refused order whose booking was already released', async () => {
    const em = new FakeEm()
    seedBooking(em, { status: 'cancelled', holdToken: null, cancelReason: 'manager' })
    const op = seedOp(em, { id: 'op-1', kind: 'booking_order', status: 'refused' })
    const { ctx, runPostCommit } = context(em, op)
    await bookingOperationHandler.onRefused(ctx, refusal)
    await runPostCommit()
    expect(notifyStaff).not.toHaveBeenCalled()
    expect(emitBookingEvent).not.toHaveBeenCalled()
  })

  it('alerts the building staff when sales refuses to move a cancelled booking order to the cancelled status', async () => {
    const em = new FakeEm()
    const booking = seedBooking(em, { status: 'cancelled', holdToken: null, cancelReason: 'manager', salesOrderId: 'order-7' })
    const op = seedOp(em, { id: 'op-2', kind: 'order_status', status: 'refused', salesDocumentType: 'order', salesDocumentId: 'order-7' })
    const holdsMoney: ClassifiedSalesError = { kind: 'permanent', status: 409, code: 'order_has_payments', message: 'Order holds money' }
    const { ctx, runPostCommit } = context(em, op)
    await bookingOperationHandler.onRefused(ctx, holdsMoney)
    await runPostCommit()
    expect(booking).toMatchObject({ status: 'cancelled', cancelReason: 'manager', salesOrderId: 'order-7' })
    expect(notifyStaff).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'property_management.booking.order_cancel_refused',
        bookingId: booking.id,
        buildingId: 'b1',
        audience: 'building',
        bodyVariables: expect.objectContaining({ error: 'Order holds money' }),
        groupKey: 'property_management.booking.order_cancel_refused:op-2',
      }),
    )
  })

  it('keeps the compensated order on the cancelled booking', async () => {
    const em = new FakeEm()
    const booking = seedBooking(em, { status: 'cancelled', holdToken: null })
    const op = seedOp(em, { id: 'op-1', kind: 'booking_order', status: 'compensated', salesDocumentId: 'order-7' })
    await bookingOperationHandler.onCompensated(context(em, op).ctx)
    expect(booking.salesOrderId).toBe('order-7')
  })

  it('alerts the building staff once when the order cannot be cancelled', async () => {
    const em = new FakeEm()
    const booking = seedBooking(em, { status: 'cancelled', holdToken: null })
    const op = seedOp(em, { id: 'op-1', kind: 'booking_order', status: 'compensating', attempts: 3, salesDocumentId: 'order-7' })
    const first = context(em, op)
    await bookingOperationHandler.onCompensationFailed(first.ctx, refusal, { first: true })
    await first.runPostCommit()
    expect(notifyStaff).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'property_management.booking.order_orphaned', bookingId: booking.id, buildingId: 'b1', audience: 'building' }),
    )
    expect(emitBookingEvent).toHaveBeenCalledWith('property_management.booking.order_orphaned', booking, expect.objectContaining({ orphanedSalesOrderId: 'order-7' }))
    jest.clearAllMocks()
    const second = context(em, op)
    await bookingOperationHandler.onCompensationFailed(second.ctx, refusal, { first: false })
    await second.runPostCommit()
    expect(notifyStaff).not.toHaveBeenCalled()
  })

  it('moves duplicated booking orders to the cancelled status and alerts administrators', async () => {
    const em = new FakeEm()
    seedBooking(em)
    em.seed(PropertyManagementSettings, { id: 'settings-1', ...scope, cancelledOrderStatusEntryId: CANCELLED_ENTRY } as never)
    const op = seedOp(em, { id: 'op-1', kind: 'booking_order' })
    const dispatcher = makeDispatcher()
    const { ctx, runPostCommit } = context(em, op, dispatcher)
    await bookingOperationHandler.onDuplicated(ctx, ['order-dup'])
    await runPostCommit()
    expect(dispatcher.updateDocumentStatus).toHaveBeenCalledWith('order', 'order-dup', CANCELLED_ENTRY)
    expect(notifyStaff).toHaveBeenCalledWith(expect.objectContaining({ type: 'property_management.sales_operation.duplicated', audience: 'administrators' }))
  })
})

describe('duplicated booking orders that cannot be cancelled', () => {
  function unavailableDispatcher() {
    return makeDispatcher({
      updateDocumentStatus: jest.fn(async () => {
        throw Object.assign(new Error('Service unavailable'), { status: 503 })
      }),
    })
  }

  it('records a pending cancelled-status operation per failed duplicate and enqueues it', async () => {
    const em = new FakeEm()
    seedBooking(em)
    em.seed(PropertyManagementSettings, { id: 'settings-1', ...scope, cancelledOrderStatusEntryId: CANCELLED_ENTRY } as never)
    const op = seedOp(em, { id: 'op-1', kind: 'booking_order' })
    const { ctx } = context(em, op, unavailableDispatcher())
    await bookingOperationHandler.onDuplicated(ctx, ['order-dup-1', 'order-dup-2'])
    const retries = em.rows(SalesOperation).filter((row) => row.kind === 'order_status')
    expect(retries).toEqual([
      expect.objectContaining({
        subjectKey: duplicateBookingOrderCancellationSubjectKey('order-dup-1'),
        status: 'pending',
        payload: { orderId: 'order-dup-1', statusEntryId: CANCELLED_ENTRY },
        targetType: 'booking',
        targetId: 'booking-1',
      }),
      expect.objectContaining({ subjectKey: 'order_status:order-dup-2:cancelled', status: 'pending' }),
    ])
    expect(ctx.enqueue).toHaveBeenCalledWith([retries[0].id])
    expect(ctx.enqueue).toHaveBeenCalledWith([retries[1].id])
  })

  it('re-enqueues the open retry instead of recording a second one when the duplicate is seen again', async () => {
    const em = new FakeEm()
    seedBooking(em)
    em.seed(PropertyManagementSettings, { id: 'settings-1', ...scope, cancelledOrderStatusEntryId: CANCELLED_ENTRY } as never)
    const existing = seedOp(em, {
      id: 'op-retry',
      kind: 'order_status',
      subjectKey: duplicateBookingOrderCancellationSubjectKey('order-dup'),
      payload: { orderId: 'order-dup', statusEntryId: CANCELLED_ENTRY },
    })
    const op = seedOp(em, { id: 'op-1', kind: 'booking_order', status: 'done' })
    const { ctx } = context(em, op, unavailableDispatcher())
    await bookingOperationHandler.onDuplicated(ctx, ['order-dup'])
    expect(em.rows(SalesOperation).filter((row) => row.kind === 'order_status')).toEqual([existing])
    expect(ctx.enqueue).toHaveBeenCalledWith(['op-retry'])
  })

  it('moves the duplicate to the cancelled status once sales is back', async () => {
    const em = new FakeEm()
    seedBooking(em)
    em.seed(PropertyManagementSettings, { id: 'settings-1', ...scope, cancelledOrderStatusEntryId: CANCELLED_ENTRY } as never)
    const op = seedOp(em, { id: 'op-1', kind: 'booking_order' })
    const { ctx } = context(em, op, unavailableDispatcher())
    await bookingOperationHandler.onDuplicated(ctx, ['order-dup'])
    const [retry] = em.rows(SalesOperation).filter((row) => row.kind === 'order_status')
    const dispatcher = makeDispatcher()
    expect(await runSalesOperation(runnerDeps(em, dispatcher), String(retry.id))).toBe('done')
    expect(dispatcher.updateDocumentStatus).toHaveBeenCalledWith('order', 'order-dup', CANCELLED_ENTRY)
  })

  it('records no retry while no cancelled status is configured', async () => {
    const em = new FakeEm()
    seedBooking(em)
    const op = seedOp(em, { id: 'op-1', kind: 'booking_order' })
    const { ctx } = context(em, op)
    await bookingOperationHandler.onDuplicated(ctx, ['order-dup'])
    expect(em.rows(SalesOperation).filter((row) => row.kind === 'order_status')).toHaveLength(0)
    expect(ctx.enqueue).not.toHaveBeenCalled()
  })
})

describe('booking orders in the sales operation runner', () => {
  it('creates the order and confirms the booking', async () => {
    const em = new FakeEm()
    const booking = seedBooking(em)
    const op = seedOp(em, { id: 'op-1', kind: 'booking_order' })
    const dispatcher = makeDispatcher()
    expect(await runSalesOperation(runnerDeps(em, dispatcher), op.id)).toBe('done')
    expect(dispatcher.createOrder).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ propertyManagementOperationId: op.id }) }))
    expect(booking).toMatchObject({ status: 'confirmed', salesOrderId: 'order-1' })
  })

  it('moves the order to the configured cancelled status when the booking was released during creation, never deleting it', async () => {
    const em = new FakeEm()
    em.seed(PropertyManagementSettings, { id: 'settings-1', ...scope, cancelledOrderStatusEntryId: CANCELLED_ENTRY } as never)
    const booking = seedBooking(em)
    const op = seedOp(em, { id: 'op-1', kind: 'booking_order' })
    const dispatcher = makeDispatcher({
      createOrder: jest.fn(async () => {
        booking.status = 'cancelled'
        booking.holdToken = null
        return 'order-1'
      }),
    })
    expect(await runSalesOperation(runnerDeps(em, dispatcher), op.id)).toBe('compensating')
    expect(dispatcher.updateDocumentStatus).not.toHaveBeenCalled()
    expect(await runSalesOperation(runnerDeps(em, dispatcher), op.id)).toBe('compensated')
    expect(dispatcher.updateDocumentStatus).toHaveBeenCalledWith('order', 'order-1', CANCELLED_ENTRY)
    expect(dispatcher.cancelRecurrence).not.toHaveBeenCalled()
    expect(booking).toMatchObject({ status: 'cancelled', salesOrderId: 'order-1' })
  })

  it('stays compensating when no cancelled status is configured', async () => {
    const em = new FakeEm()
    seedBooking(em, { status: 'cancelled', holdToken: null })
    const op = seedOp(em, { id: 'op-1', kind: 'booking_order', status: 'compensating', salesDocumentType: 'order', salesDocumentId: 'order-1' })
    const dispatcher = makeDispatcher()
    expect(await runSalesOperation(runnerDeps(em, dispatcher), op.id)).toBe('compensating')
    expect(op.lastError).toMatchObject({ code: 'cancelled_status_missing' })
    expect(dispatcher.updateDocumentStatus).not.toHaveBeenCalled()
  })

  it('sets the cancelled status entry of a cancelled booking order only when it differs', async () => {
    const em = new FakeEm()
    const op = seedOp(em, { id: 'op-s', kind: 'order_status', payload: { orderId: 'order-1', statusEntryId: CANCELLED_ENTRY } })
    const dispatcher = makeDispatcher()
    expect(await runSalesOperation(runnerDeps(em, dispatcher), op.id)).toBe('done')
    expect(dispatcher.updateDocumentStatus).toHaveBeenCalledWith('order', 'order-1', CANCELLED_ENTRY)
    const again = seedOp(em, { id: 'op-t', kind: 'order_status', payload: { orderId: 'order-2', statusEntryId: CANCELLED_ENTRY } })
    const unchanged = makeDispatcher({
      loadDocument: jest.fn(async (_kind, id: string) => ({ id, number: 'SO-2', status: 'cancelled', statusEntryId: CANCELLED_ENTRY, deleted: false })),
    })
    expect(await runSalesOperation(runnerDeps(em, unchanged), again.id)).toBe('done')
    expect(unchanged.updateDocumentStatus).not.toHaveBeenCalled()
  })
})

describe('booking staff notification texts', () => {
  it('translates an error raised by the runner instead of showing its internal message', async () => {
    const em = new FakeEm()
    const booking = seedBooking(em, { status: 'cancelled', holdToken: null })
    const op = seedOp(em, { id: 'op-1', kind: 'booking_order', status: 'compensating', salesDocumentId: 'order-7' })
    const missingStatus: ClassifiedSalesError = {
      kind: 'permanent',
      status: null,
      code: 'cancelled_status_missing',
      message: '[internal] No cancelled order status is configured',
    }
    const { ctx, runPostCommit } = context(em, op)
    await bookingOperationHandler.onCompensationFailed(ctx, missingStatus, { first: true })
    await runPostCommit()
    expect(notifyStaff).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: booking.id,
        bodyVariables: expect.objectContaining({ error: 'No cancelled order status is configured in the property management settings.' }),
      }),
    )
  })

  it('reports the duplicated orders it could not cancel instead of claiming they were cancelled', async () => {
    const em = new FakeEm()
    seedBooking(em)
    const op = seedOp(em, { id: 'op-1', kind: 'booking_order' })
    const dispatcher = makeDispatcher()
    const { ctx, runPostCommit } = context(em, op, dispatcher)
    await bookingOperationHandler.onDuplicated(ctx, ['order-dup'])
    await runPostCommit()
    expect(dispatcher.updateDocumentStatus).not.toHaveBeenCalled()
    expect(notifyStaff).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'property_management.sales_operation.duplicated',
        bodyVariables: expect.objectContaining({ error: 'These extras could not be cancelled; cancel them in Sales: order-dup.' }),
      }),
    )
  })
})
