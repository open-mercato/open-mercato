/** @jest-environment node */
import type { AwilixContainer } from 'awilix'
import { z } from 'zod'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { Booking, SalesOperation, Unit, type SalesOperationKind } from '../data/entities'
import { FakeEm } from './support/fakeEm'

const reportError = jest.fn()

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({ getTelemetryRuntime: () => ({ reportError }) }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => jest.requireActual('./support/fakeEm').encryptionFindMock())
jest.mock('@open-mercato/queue', () => ({ createModuleQueue: jest.fn(() => ({ enqueue: jest.fn() })) }))
jest.mock('../lib/staffNotifications', () => ({ notifyStaff: jest.fn(async () => []) }))
jest.mock('../lib/bookingEvents', () => ({
  emitBookingEvent: jest.fn(async () => undefined),
  markBookingChanged: jest.fn(async () => undefined),
}))
jest.mock('../lib/salesOperationAlerts', () => {
  const actual = jest.requireActual('../lib/salesOperationAlerts')
  return { ...actual, reportStalledOperation: jest.fn(async () => undefined) }
})

import { resolveOperationHandler } from '../lib/operationHandlers'
import { runSalesOperation, type OperationTargetHandler, type RunnerDeps } from '../lib/salesOperationRunner'
import type { SalesDispatcher } from '../lib/salesDispatcher'
import { SalesContractUnavailableError } from '../lib/salesErrors'
import { notifyStaff } from '../lib/staffNotifications'
import { emitBookingEvent } from '../lib/bookingEvents'

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }

function seedBooking(em: FakeEm): Booking {
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
  } as never) as unknown as Booking
}

function seedOp(em: FakeEm, id: string, kind: SalesOperationKind, targetType: SalesOperation['targetType'] = 'booking'): SalesOperation {
  return em.seed(SalesOperation, {
    id,
    ...scope,
    kind,
    subjectKey: id,
    payloadHash: 'h',
    payload: { lines: [{ productId: 'product-1' }], metadata: { propertyManagementBookingId: 'booking-1' } },
    changeId: null,
    sequence: 1,
    targetType,
    targetId: 'booking-1',
    leaseId: null,
    status: 'pending',
    token: 'token-1',
    allowCredit: null,
    attempts: 0,
    lastError: null,
  } as never) as unknown as SalesOperation
}

function makeDispatcher(overrides: Partial<SalesDispatcher> = {}): jest.Mocked<SalesDispatcher> {
  return {
    createOrder: jest.fn(async () => 'order-1'),
    createQuote: jest.fn(async () => 'quote-1'),
    updateDocumentStatus: jest.fn(async () => undefined),
    cancelRecurrence: jest.fn(async () => ({ status: 'cancelled', cancelEffectiveOn: null, creditMemoIds: [] })),
    readRecurrence: jest.fn(async () => null),
    findDocuments: jest.fn(async () => []),
    loadDocument: jest.fn(async () => null),
    firstOrderLineId: jest.fn(async () => 'line-1'),
    resolveStatusEntryId: jest.fn(async (value: string) => `status-${value}`),
    ...overrides,
  } as jest.Mocked<SalesDispatcher>
}

function deps(em: FakeEm, dispatcher: SalesDispatcher, resolveHandler: RunnerDeps['resolveHandler'] = resolveOperationHandler): RunnerDeps {
  return {
    container: { resolve: jest.fn() } as unknown as AwilixContainer,
    em: em as never,
    resolveHandler,
    dispatcherFactory: () => dispatcher,
    enqueuer: jest.fn(async () => undefined),
    today: () => '2026-11-11',
  }
}

function silentHandler(overrides: Partial<OperationTargetHandler> = {}): OperationTargetHandler {
  return {
    isHoldValid: jest.fn(async () => true),
    finish: jest.fn(async () => 'done' as const),
    onDone: jest.fn(async () => undefined),
    onRefused: jest.fn(async () => undefined),
    onCompensated: jest.fn(async () => undefined),
    onCompensationFailed: jest.fn(async () => undefined),
    onDuplicated: jest.fn(async () => undefined),
    ...overrides,
  }
}

beforeEach(() => jest.clearAllMocks())

describe('sales operation refusal reporting', () => {
  it('reports a refused booking order, cancels the booking and alerts the building staff', async () => {
    const em = new FakeEm()
    const booking = seedBooking(em)
    const op = seedOp(em, 'op-1', 'booking_order')
    const contractError = (() => {
      try {
        z.object({ channelId: z.string().uuid() }).parse({ channelId: 'nope' })
      } catch (err) {
        return err
      }
      throw new Error('[internal] expected a validation error')
    })()
    const dispatcher = makeDispatcher({
      createOrder: jest.fn(async () => {
        throw contractError
      }),
    })
    expect(await runSalesOperation(deps(em, dispatcher), op.id)).toBe('refused')
    expect(op.status).toBe('refused')
    expect(booking).toMatchObject({ status: 'cancelled', cancelReason: 'order_refused', holdToken: null })
    expect(emitBookingEvent).toHaveBeenCalledWith('property_management.booking.cancelled', booking, { error: 'validation_failed' })
    expect(reportError).toHaveBeenCalledWith(
      contractError,
      expect.objectContaining({
        module: 'property_management',
        code: 'property_management.sales_operation_refused',
        attributes: expect.objectContaining({ operationId: 'op-1', kind: 'booking_order', salesCode: 'validation_failed' }),
      }),
    )
    expect(notifyStaff).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'property_management.booking.order_refused', bookingId: 'booking-1', buildingId: 'b1', audience: 'building' }),
    )
  })

  it('reports a refusal only once the refused state is committed', async () => {
    const em = new FakeEm()
    const op = seedOp(em, 'op-2', 'lease_order', 'lease_version')
    const dispatcher = makeDispatcher({
      createOrder: jest.fn(async () => {
        throw new CrudHttpError(409, { error: 'Locked', code: 'order_locked' })
      }),
    })
    const failing = silentHandler({
      onRefused: jest.fn(async () => {
        throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' })
      }),
    })
    await expect(runSalesOperation(deps(em, dispatcher, () => failing), op.id)).rejects.toThrow('connection reset')
    expect(reportError).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ code: 'property_management.sales_operation_refused' }))
  })
})

describe('sales operation compensation failure reporting', () => {
  it('reports every recorded compensation failure, not only the stalled one', async () => {
    const em = new FakeEm()
    const op = seedOp(em, 'op-3', 'lease_order', 'lease_version')
    op.status = 'compensating'
    op.salesDocumentType = 'order'
    op.salesDocumentId = 'order-1'
    const failure = new CrudHttpError(503, { error: 'Sales is down' })
    const dispatcher = makeDispatcher({
      readRecurrence: jest.fn(async () => {
        throw failure
      }),
    })
    const handler = silentHandler()
    expect(await runSalesOperation(deps(em, dispatcher, () => handler), op.id)).toBe('compensating')
    expect(await runSalesOperation(deps(em, dispatcher, () => handler), op.id)).toBe('compensating')
    const compensationReports = reportError.mock.calls.filter(([, options]) => options?.code === 'property_management.sales_operation_compensation_failed')
    expect(compensationReports).toHaveLength(2)
    expect(compensationReports[0]).toEqual([
      failure,
      expect.objectContaining({ module: 'property_management', attributes: expect.objectContaining({ operationId: 'op-3', kind: 'lease_order', attempts: 1 }) }),
    ])
    expect(compensationReports[1][1]).toMatchObject({ attributes: { attempts: 2 } })
  })

  it('does not report a compensation waiting for the sales contract', async () => {
    const em = new FakeEm()
    const op = seedOp(em, 'op-4', 'lease_order', 'lease_version')
    op.status = 'compensating'
    op.salesDocumentType = 'order'
    op.salesDocumentId = 'order-1'
    const dispatcher = makeDispatcher({
      readRecurrence: jest.fn(async () => {
        throw new SalesContractUnavailableError('recurrence_cancel')
      }),
    })
    expect(await runSalesOperation(deps(em, dispatcher, () => silentHandler()), op.id)).toBe('unavailable')
    expect(reportError).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ code: 'property_management.sales_operation_compensation_failed' }))
  })
})
