import { LockMode } from '@mikro-orm/core'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { setGlobalEventBus } from '@open-mercato/shared/modules/events'
import {
  registerGatewayAdapter,
  clearGatewayAdapters,
  type GatewayAdapter,
  type UnifiedPaymentStatus,
} from '@open-mercato/shared/modules/payment_gateways/types'
import { createPaymentGatewayService } from '../gateway-service'

const mockReportError = jest.fn()

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => mockReportError(...args) }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

const findOneMock = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>

const PROVIDER_KEY = 'mock-lock'
const scope = { organizationId: 'org_1', tenantId: 'tenant_1' }

type TransactionRow = {
  id: string
  paymentId: string
  providerKey: string
  providerSessionId: string
  unifiedStatus: UnifiedPaymentStatus
  gatewayStatus: string | null
  amount: string
  capturedAmount: string
  gatewayMetadata: Record<string, unknown>
  gatewayRefundId: string | null
  webhookLog: unknown[] | null
  lastPolledAt: Date | null
  lastWebhookAt: Date | null
  organizationId: string
  tenantId: string
  updatedAt: Date
  deletedAt: Date | null
  [key: string]: unknown
}

type OperationRecord = {
  id: string
  operationId: string
  organizationId: string
  tenantId: string
  [key: string]: unknown
}

type FindOptions = { lockMode?: LockMode; refresh?: boolean } | undefined

function makeRow(status: UnifiedPaymentStatus, capturedAmount = '0.0000'): TransactionRow {
  return {
    id: 'txn_1',
    paymentId: 'pay_1',
    providerKey: PROVIDER_KEY,
    providerSessionId: 'sess_1',
    unifiedStatus: status,
    gatewayStatus: null,
    amount: '100.0000',
    capturedAmount,
    gatewayMetadata: {},
    gatewayRefundId: null,
    webhookLog: null,
    lastPolledAt: null,
    lastWebhookAt: null,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
  }
}

function matchesWhere(record: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = record[key]
    if (expected && typeof expected === 'object' && '$lt' in expected) {
      return actual instanceof Date && actual < (expected as { $lt: Date }).$lt
    }
    return actual === expected
  })
}

/**
 * Models the committed row (`committed`) separately from the copy the caller's entity manager
 * loaded earlier (`callerCopy`). A fork reads the committed row directly; the caller's manager
 * returns its stale copy unless asked to lock or refresh, which re-hydrates it.
 */
function buildHarness(input: { committed: TransactionRow; callerCopy: TransactionRow }) {
  const { committed, callerCopy } = input
  let loadedSnapshot: TransactionRow = { ...callerCopy }
  const adapter = {
    providerKey: PROVIDER_KEY,
    createSession: jest.fn(),
    capture: jest.fn(),
    refund: jest.fn(),
    cancel: jest.fn(),
    getStatus: jest.fn(),
    verifyWebhook: jest.fn(),
    mapStatus: jest.fn(() => 'unknown' as UnifiedPaymentStatus),
  }
  registerGatewayAdapter(adapter as unknown as GatewayAdapter)

  const operations = new Map<string, OperationRecord>()
  let operationSequence = 0
  const txFlush = jest.fn(async () => {})
  const forkEm: Record<string, unknown> = { flush: txFlush }
  forkEm.transactional = jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(forkEm))
  const callerFlush = jest.fn(async () => {
    for (const key of Object.keys(callerCopy)) {
      if (callerCopy[key] !== loadedSnapshot[key]) committed[key] = callerCopy[key]
    }
    loadedSnapshot = { ...callerCopy }
  })
  const callerEm: Record<string, unknown> = {
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ id: `operation_${++operationSequence}`, ...data })),
    persist: jest.fn((record: OperationRecord) => ({
      flush: async () => {
        operations.set(`${record.operationId}|${record.organizationId}|${record.tenantId}`, record)
      },
    })),
    nativeUpdate: jest.fn(async (entity: unknown, where: Record<string, unknown>, update: Record<string, unknown>) => {
      const candidates: Record<string, unknown>[] = (entity as { name?: string }).name === 'GatewayTransaction'
        ? [committed]
        : Array.from(operations.values())
      const matched = candidates.find((candidate) => matchesWhere(candidate, where))
      if (!matched) return 0
      Object.assign(matched, update)
      return 1
    }),
    flush: callerFlush,
    fork: jest.fn(() => forkEm),
  }
  callerEm.transactional = jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(callerEm))

  findOneMock.mockImplementation(async (targetEm, entity, where, options) => {
    if ((entity as { name?: string }).name === 'GatewayPaymentOperation') {
      const criteria = where as { operationId?: string; organizationId?: string; tenantId?: string }
      return (operations.get(`${criteria.operationId}|${criteria.organizationId}|${criteria.tenantId}`) ?? null) as never
    }
    if (targetEm === (forkEm as unknown)) return committed as never
    const findOptions = options as FindOptions
    if (findOptions?.lockMode || findOptions?.refresh) {
      Object.assign(callerCopy, committed)
      loadedSnapshot = { ...callerCopy }
    }
    return callerCopy as never
  })

  const integrationLogService = { write: jest.fn(async () => {}) }
  const service = createPaymentGatewayService({
    em: callerEm as never,
    integrationCredentialsService: { resolve: jest.fn(async () => ({})) } as never,
    integrationLogService: integrationLogService as never,
  })
  return { service, adapter, callerEm, forkEm, txFlush, callerFlush, integrationLogService, operations }
}

function findCallsWith(predicate: (options: FindOptions, targetEm: unknown) => boolean) {
  return findOneMock.mock.calls.filter(([targetEm, entity, , options]) => (
    (entity as { name?: string }).name === 'GatewayTransaction' && predicate(options as FindOptions, targetEm)
  ))
}

describe('payment gateway service — status writers evaluate the locked committed row', () => {
  const emit = jest.fn(async (_id: string, _payload: unknown) => {})

  beforeAll(() => {
    setGlobalEventBus({ emit })
  })

  beforeEach(() => {
    clearGatewayAdapters()
    findOneMock.mockReset()
    emit.mockClear()
    mockReportError.mockClear()
  })

  afterEach(() => {
    clearGatewayAdapters()
  })

  describe('status poll', () => {
    it('re-reads under a pessimistic lock in a fork and does not regress a newer committed status', async () => {
      const committed = makeRow('partially_refunded', '100.0000')
      const harness = buildHarness({ committed, callerCopy: makeRow('authorized') })
      harness.adapter.getStatus.mockResolvedValue({ status: 'captured' })

      await harness.service.getPaymentStatus('txn_1', scope)

      expect(committed.unifiedStatus).toBe('partially_refunded')
      expect(committed.gatewayMetadata).toEqual({})
      expect(harness.txFlush).not.toHaveBeenCalled()
      expect(harness.callerFlush).not.toHaveBeenCalled()
      expect(emit).not.toHaveBeenCalled()
      expect(harness.integrationLogService.write).not.toHaveBeenCalled()
      expect(harness.callerEm.nativeUpdate).toHaveBeenCalledTimes(1)
      expect(harness.callerEm.nativeUpdate).toHaveBeenCalledWith(
        expect.anything(),
        { id: 'txn_1', organizationId: 'org_1', tenantId: 'tenant_1' },
        { lastPolledAt: expect.any(Date) },
      )
      expect(committed.updatedAt).toEqual(new Date('2026-01-01T00:00:00.000Z'))
      expect(findCallsWith((options, targetEm) => (
        options?.lockMode === LockMode.PESSIMISTIC_WRITE && targetEm === harness.forkEm
      ))).toHaveLength(1)
    })

    it('takes the lock-free fast path when the provider repeats the status it was polled with', async () => {
      const committed = makeRow('authorized')
      const harness = buildHarness({ committed, callerCopy: makeRow('authorized') })
      harness.adapter.getStatus.mockResolvedValue({ status: 'authorized' })

      await harness.service.getPaymentStatus('txn_1', scope)

      expect(harness.callerEm.fork).not.toHaveBeenCalled()
      expect(findCallsWith((options) => Boolean(options?.lockMode))).toHaveLength(0)
      expect(harness.callerEm.nativeUpdate).toHaveBeenCalledTimes(1)
      expect(emit).not.toHaveBeenCalled()
    })

    it('applies a transition once, reports the locked previous status and re-hydrates the caller copy', async () => {
      const committed = makeRow('authorized')
      const callerCopy = makeRow('pending')
      const harness = buildHarness({ committed, callerCopy })
      harness.adapter.getStatus.mockResolvedValue({ status: 'captured', providerData: { pollMarker: true } })

      await harness.service.getPaymentStatus('txn_1', scope)

      expect(emit).toHaveBeenCalledTimes(1)
      expect(emit.mock.calls[0][0]).toBe('payment_gateways.payment.captured')
      expect(emit.mock.calls[0][1]).toEqual(expect.objectContaining({ previousStatus: 'authorized' }))
      expect(committed.unifiedStatus).toBe('captured')
      expect(committed.capturedAmount).toBe('100.0000')
      expect(committed.gatewayMetadata).toEqual({ statusResult: { pollMarker: true } })
      expect(harness.txFlush).toHaveBeenCalledTimes(1)
      expect(harness.callerEm.nativeUpdate).not.toHaveBeenCalled()
      expect(findCallsWith((options, targetEm) => options?.refresh === true && targetEm === (harness.callerEm as unknown))).toHaveLength(1)
      expect(callerCopy.unifiedStatus).toBe('captured')
    })

    it('still announces a committed transition when re-reading the caller copy fails', async () => {
      const committed = makeRow('authorized')
      const harness = buildHarness({ committed, callerCopy: makeRow('authorized') })
      harness.adapter.getStatus.mockResolvedValue({ status: 'captured' })
      const harnessFind = findOneMock.getMockImplementation()
      findOneMock.mockImplementation(async (targetEm, entity, where, options) => {
        if ((options as FindOptions)?.refresh && targetEm === (harness.callerEm as unknown)) {
          throw new Error('[internal] re-read failed')
        }
        return harnessFind!(targetEm, entity, where, options)
      })

      await expect(harness.service.getPaymentStatus('txn_1', scope)).resolves.toEqual({ status: 'captured' })

      expect(committed.unifiedStatus).toBe('captured')
      expect(emit).toHaveBeenCalledTimes(1)
      expect(emit.mock.calls[0][0]).toBe('payment_gateways.payment.captured')
      expect(mockReportError).toHaveBeenCalledTimes(1)
      expect(mockReportError).toHaveBeenCalledWith(
        expect.objectContaining({ message: '[internal] re-read failed' }),
        { module: 'payment_gateways', code: 'payment_gateways.poll_status_reread_failed' },
      )
    })

    it('still announces a committed transition when the error reporter itself throws', async () => {
      const committed = makeRow('authorized')
      const harness = buildHarness({ committed, callerCopy: makeRow('authorized') })
      harness.adapter.getStatus.mockResolvedValue({ status: 'captured' })
      const harnessFind = findOneMock.getMockImplementation()
      findOneMock.mockImplementation(async (targetEm, entity, where, options) => {
        if ((options as FindOptions)?.refresh && targetEm === (harness.callerEm as unknown)) {
          throw new Error('[internal] re-read failed')
        }
        return harnessFind!(targetEm, entity, where, options)
      })
      mockReportError.mockImplementationOnce(() => {
        throw new Error('[internal] telemetry unavailable')
      })

      await expect(harness.service.getPaymentStatus('txn_1', scope)).resolves.toEqual({ status: 'captured' })

      expect(mockReportError).toHaveBeenCalledTimes(1)
      expect(committed.unifiedStatus).toBe('captured')
      expect(emit).toHaveBeenCalledTimes(1)
      expect(emit.mock.calls[0][0]).toBe('payment_gateways.payment.captured')
      expect(harness.integrationLogService.write).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Payment status updated by poller' }),
        scope,
      )
    })
  })

  describe('webhook sync', () => {
    it('evaluates the transition against the locked row instead of the caller copy', async () => {
      const committed = makeRow('captured', '100.0000')
      const harness = buildHarness({ committed, callerCopy: makeRow('authorized') })

      await harness.service.syncTransactionStatus('txn_1', {
        unifiedStatus: 'captured',
        providerStatus: 'succeeded',
        providerData: { webhookMarker: true },
        webhookEvent: { eventType: 'payment.captured', idempotencyKey: 'evt_1', processed: true },
      }, scope)

      expect(emit).not.toHaveBeenCalled()
      expect(committed.unifiedStatus).toBe('captured')
      expect(committed.gatewayMetadata).toEqual({ webhookMarker: true })
      expect(committed.webhookLog).toHaveLength(1)
      expect(harness.txFlush).toHaveBeenCalledTimes(1)
      expect(harness.integrationLogService.write).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'warn',
          message: 'Webhook received with no status transition',
          payload: expect.objectContaining({ previousStatus: 'captured', nextStatus: 'captured' }),
        }),
        scope,
      )
      expect(findCallsWith((options, targetEm) => (
        options?.lockMode === LockMode.PESSIMISTIC_WRITE && targetEm === harness.forkEm
      ))).toHaveLength(1)
    })
  })

  describe('manual completion', () => {
    it('completes without a second captured event when a concurrent poll already captured the payment', async () => {
      const committed = makeRow('authorized')
      const harness = buildHarness({ committed, callerCopy: makeRow('authorized') })
      harness.adapter.capture.mockImplementation(async () => {
        committed.unifiedStatus = 'captured'
        return { status: 'captured', capturedAmount: 100 }
      })

      const result = await harness.service.capturePayment('txn_1', undefined, scope, 'capture-after-poll')

      expect(result.status).toBe('captured')
      expect(emit).not.toHaveBeenCalled()
      expect(committed.unifiedStatus).toBe('captured')
      expect(committed.capturedAmount).toBe('100.0000')
      expect(findCallsWith((options) => (
        options?.lockMode === LockMode.PESSIMISTIC_WRITE && options?.refresh === true
      ))).toHaveLength(1)
    })

    it('does not fail or announce anything when a concurrent writer moved the payment to an incompatible status', async () => {
      const committed = makeRow('authorized')
      const harness = buildHarness({ committed, callerCopy: makeRow('authorized') })
      harness.adapter.capture.mockImplementation(async () => {
        committed.unifiedStatus = 'cancelled'
        return { status: 'captured', capturedAmount: 100, providerData: { captureMarker: true } }
      })

      const result = await harness.service.capturePayment('txn_1', undefined, scope, 'capture-after-cancel')

      expect(result.status).toBe('captured')
      expect(emit).not.toHaveBeenCalled()
      expect(committed.unifiedStatus).toBe('cancelled')
      expect(committed.gatewayMetadata).toEqual({ captureResult: { captureMarker: true } })
      expect(committed.capturedAmount).toBe('100.0000')
      expect(harness.adapter.capture).toHaveBeenCalledTimes(1)
      expect(Array.from(harness.operations.values())).toEqual([
        expect.objectContaining({ operationId: 'capture-after-cancel', status: 'succeeded' }),
      ])
      expect(harness.integrationLogService.write).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'warn',
          message: 'Payment status changed concurrently; provider result not applied',
          payload: { action: 'capture', currentStatus: 'cancelled', resultStatus: 'captured' },
        }),
        scope,
      )
      expect(mockReportError).toHaveBeenCalledWith(
        expect.any(Error),
        { module: 'payment_gateways', code: 'payment_gateways.manual_result_not_applied' },
      )
    })

    it('replays a capture completed across a concurrent cancellation without calling the provider again', async () => {
      const committed = makeRow('authorized')
      const harness = buildHarness({ committed, callerCopy: makeRow('authorized') })
      harness.adapter.capture.mockImplementation(async () => {
        committed.unifiedStatus = 'cancelled'
        return { status: 'captured', capturedAmount: 100, providerData: { captureMarker: true } }
      })

      const first = await harness.service.capturePayment('txn_1', undefined, scope, 'capture-replay-after-cancel')
      const replay = await harness.service.capturePayment('txn_1', undefined, scope, 'capture-replay-after-cancel')

      expect(replay).toEqual(first)
      expect(harness.adapter.capture).toHaveBeenCalledTimes(1)
      expect(committed.unifiedStatus).toBe('cancelled')
      expect(emit).not.toHaveBeenCalled()
    })

    it('still refuses to replay a capture once the payment moved on after it completed', async () => {
      const committed = makeRow('authorized')
      const callerCopy = makeRow('authorized')
      const harness = buildHarness({ committed, callerCopy })
      harness.adapter.capture.mockResolvedValue({ status: 'captured', capturedAmount: 100 })

      await harness.service.capturePayment('txn_1', undefined, scope, 'capture-replay-moved-on')
      expect(committed.unifiedStatus).toBe('captured')
      committed.unifiedStatus = 'refunded'
      callerCopy.unifiedStatus = 'refunded'

      await expect(harness.service.capturePayment('txn_1', undefined, scope, 'capture-replay-moved-on'))
        .rejects.toMatchObject({ status: 409 })
      expect(harness.adapter.capture).toHaveBeenCalledTimes(1)
    })

    it('completes a capture across a concurrent cancellation when logging and error reporting both throw', async () => {
      const committed = makeRow('authorized')
      const harness = buildHarness({ committed, callerCopy: makeRow('authorized') })
      harness.adapter.capture.mockImplementation(async () => {
        committed.unifiedStatus = 'cancelled'
        return { status: 'captured', capturedAmount: 100 }
      })
      harness.integrationLogService.write.mockRejectedValueOnce(new Error('[internal] log store unavailable'))
      mockReportError.mockImplementationOnce(() => {
        throw new Error('[internal] telemetry unavailable')
      })

      await expect(harness.service.capturePayment('txn_1', undefined, scope, 'capture-telemetry-down'))
        .resolves.toMatchObject({ status: 'captured' })

      expect(mockReportError).toHaveBeenCalledTimes(1)
      expect(committed.unifiedStatus).toBe('cancelled')
      expect(Array.from(harness.operations.values())).toEqual([
        expect.objectContaining({ operationId: 'capture-telemetry-down', status: 'succeeded' }),
      ])
      expect(harness.integrationLogService.write).toHaveBeenLastCalledWith(
        expect.objectContaining({ message: 'Payment captured' }),
        scope,
      )
    })

    it('still rejects an incompatible provider result when nothing changed concurrently', async () => {
      const committed = makeRow('authorized')
      const harness = buildHarness({ committed, callerCopy: makeRow('authorized') })
      harness.adapter.capture.mockResolvedValue({ status: 'refunded', capturedAmount: 100 })

      await expect(harness.service.capturePayment('txn_1', undefined, scope, 'capture-incompatible'))
        .rejects.toMatchObject({ status: 409 })

      expect(emit).not.toHaveBeenCalled()
      expect(committed.unifiedStatus).toBe('authorized')
      expect(mockReportError).not.toHaveBeenCalled()
    })
  })
})
