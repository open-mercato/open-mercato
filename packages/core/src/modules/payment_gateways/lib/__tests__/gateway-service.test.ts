import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { setGlobalEventBus } from '@open-mercato/shared/modules/events'
import {
  registerGatewayAdapter,
  clearGatewayAdapters,
  type GatewayAdapter,
  type UnifiedPaymentStatus,
} from '@open-mercato/shared/modules/payment_gateways/types'
import type { GatewayTransaction } from '../../data/entities'
import { createPaymentGatewayService } from '../gateway-service'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

const findOneMock = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>

const PROVIDER_KEY = 'mock-unit'

const scope = { organizationId: 'org_1', tenantId: 'tenant_1' }

function makeTransaction(status: UnifiedPaymentStatus): GatewayTransaction {
  return {
    id: 'txn_1',
    paymentId: 'pay_1',
    providerKey: PROVIDER_KEY,
    providerSessionId: 'sess_1',
    unifiedStatus: status,
    amount: '100.00',
    gatewayMetadata: {},
    gatewayRefundId: null,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  } as unknown as GatewayTransaction
}

type AdapterResults = {
  capture?: { status: UnifiedPaymentStatus; capturedAmount: number }
  refund?: { status: UnifiedPaymentStatus; refundedAmount: number; refundId: string }
  cancel?: { status: UnifiedPaymentStatus }
}

type PaymentOperationRecord = {
  id: string
  operationId: string
  requestHash: string
  status: string
  attemptToken: string
  leaseExpiresAt: Date | null
  result: Record<string, unknown> | null
  organizationId: string
  tenantId: string
  [key: string]: unknown
}

function matchesWhere(record: PaymentOperationRecord, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = record[key]
    if (expected && typeof expected === 'object' && '$lt' in expected) {
      return actual instanceof Date && actual < (expected as { $lt: Date }).$lt
    }
    return actual === expected
  })
}

function buildService(transaction: GatewayTransaction, results: AdapterResults) {
  const captureFn = jest.fn(async () => results.capture ?? { status: 'captured' as UnifiedPaymentStatus, capturedAmount: 10 })
  const refundFn = jest.fn(async () => results.refund ?? { status: 'refunded' as UnifiedPaymentStatus, refundedAmount: 10, refundId: 're_1' })
  const cancelFn = jest.fn(async () => results.cancel ?? { status: 'cancelled' as UnifiedPaymentStatus })

  const adapter: GatewayAdapter = {
    providerKey: PROVIDER_KEY,
    createSession: jest.fn(),
    capture: captureFn as never,
    refund: refundFn as never,
    cancel: cancelFn as never,
    getStatus: jest.fn(),
    verifyWebhook: jest.fn(),
    mapStatus: jest.fn(() => 'unknown' as UnifiedPaymentStatus),
  } as unknown as GatewayAdapter
  registerGatewayAdapter(adapter)

  const operations = new Map<string, PaymentOperationRecord>()
  const operationKey = (record: Pick<PaymentOperationRecord, 'operationId' | 'organizationId' | 'tenantId'>) => (
    `${record.operationId}|${record.organizationId}|${record.tenantId}`
  )
  const flush = jest.fn(async () => {})
  const em = {
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({
      id: 'operation_1',
      ...data,
    })),
    persist: jest.fn((record: PaymentOperationRecord) => ({
      flush: async () => {
        const key = operationKey(record)
        if (operations.has(key)) {
          throw Object.assign(new Error('duplicate payment operation'), { code: '23505' })
        }
        operations.set(key, record)
      },
    })),
    nativeUpdate: jest.fn(async (_entity: unknown, where: Record<string, unknown>, update: Record<string, unknown>) => {
      const operation = Array.from(operations.values()).find((candidate) => matchesWhere(candidate, where))
      if (!operation || !matchesWhere(operation, where)) return 0
      Object.assign(operation, update)
      return 1
    }),
    flush,
    transactional: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(em)),
  }
  const integrationCredentialsService = { resolve: jest.fn(async () => ({})) } as never

  findOneMock.mockImplementation(async (_em, entity, where) => {
    if ((entity as { name?: string }).name !== 'GatewayPaymentOperation') return transaction as never
    const operationWhere = where as { operationId?: string; organizationId?: string; tenantId?: string }
    return operations.get(operationKey({
      operationId: operationWhere.operationId ?? '',
      organizationId: operationWhere.organizationId ?? '',
      tenantId: operationWhere.tenantId ?? '',
    })) as never ?? null
  })

  const service = createPaymentGatewayService({ em: em as never, integrationCredentialsService })
  return { service, captureFn, refundFn, cancelFn, flush }
}

function refundWithOperation(
  service: ReturnType<typeof createPaymentGatewayService>,
  transactionId: string,
  amount: number | undefined,
  reason: string | undefined,
  operationId?: string,
) {
  const refund = service.refundPayment as unknown as (
    id: string,
    value: number | undefined,
    why: string | undefined,
    requestScope: typeof scope,
    requestOperationId?: string,
  ) => Promise<{ status: UnifiedPaymentStatus; refundedAmount: number; refundId: string }>
  return refund(transactionId, amount, reason, scope, operationId)
}

describe('payment gateway service — status-machine guard (#3271)', () => {
  beforeAll(() => {
    setGlobalEventBus({ emit: async () => {} })
  })

  beforeEach(() => {
    clearGatewayAdapters()
    findOneMock.mockReset()
  })

  afterEach(() => {
    clearGatewayAdapters()
  })

  it('rejects a capture on a cancelled (terminal) transaction without touching adapter or status', async () => {
    const transaction = makeTransaction('cancelled')
    const { service, captureFn, flush } = buildService(transaction, {
      capture: { status: 'captured', capturedAmount: 45 },
    })

    await expect(service.capturePayment(transaction.id, undefined, scope)).rejects.toMatchObject({ status: 409 })

    expect(captureFn).not.toHaveBeenCalled()
    expect(transaction.unifiedStatus).toBe('cancelled')
    expect(flush).not.toHaveBeenCalled()
  })

  it('rejects a refund on a pending transaction (no valid transition into refunded)', async () => {
    const transaction = makeTransaction('pending')
    const { service, refundFn, flush } = buildService(transaction, {
      refund: { status: 'refunded', refundedAmount: 20, refundId: 're_x' },
    })

    await expect(service.refundPayment(transaction.id, undefined, undefined, scope)).rejects.toMatchObject({ status: 409 })

    expect(refundFn).not.toHaveBeenCalled()
    expect(transaction.unifiedStatus).toBe('pending')
    expect(flush).not.toHaveBeenCalled()
  })

  it('rejects a cancel on a refunded (terminal) transaction', async () => {
    const transaction = makeTransaction('refunded')
    const { service, cancelFn, flush } = buildService(transaction, {
      cancel: { status: 'cancelled' },
    })

    await expect(service.cancelPayment(transaction.id, undefined, scope)).rejects.toMatchObject({ status: 409 })

    expect(cancelFn).not.toHaveBeenCalled()
    expect(transaction.unifiedStatus).toBe('refunded')
    expect(flush).not.toHaveBeenCalled()
  })

  it('rejects a refund on an already-refunded (terminal) transaction without re-calling the adapter', async () => {
    const transaction = makeTransaction('refunded')
    const { service, refundFn, flush } = buildService(transaction, {
      refund: { status: 'refunded', refundedAmount: 10, refundId: 're_dup' },
    })

    await expect(service.refundPayment(transaction.id, undefined, undefined, scope)).rejects.toMatchObject({ status: 409 })

    expect(refundFn).not.toHaveBeenCalled()
    expect(transaction.unifiedStatus).toBe('refunded')
    expect(flush).not.toHaveBeenCalled()
  })

  it('rejects an adapter result that is not a valid transition (permissive adapter returns refunded on capture)', async () => {
    const transaction = makeTransaction('authorized')
    const { service, captureFn, flush } = buildService(transaction, {
      capture: { status: 'refunded' as UnifiedPaymentStatus, capturedAmount: 30 },
    })

    await expect(service.capturePayment(transaction.id, undefined, scope)).rejects.toMatchObject({ status: 409 })

    expect(captureFn).toHaveBeenCalledTimes(1)
    expect(transaction.unifiedStatus).toBe('authorized')
    expect(flush).not.toHaveBeenCalled()
  })

  it('captures a valid authorized -> captured transition and persists', async () => {
    const transaction = makeTransaction('authorized')
    const { service, captureFn, flush } = buildService(transaction, {
      capture: { status: 'captured', capturedAmount: 80 },
    })

    const result = await service.capturePayment(transaction.id, undefined, scope)

    expect(captureFn).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('captured')
    expect(transaction.unifiedStatus).toBe('captured')
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('rejects a capture above the authorized transaction amount before calling the adapter', async () => {
    const transaction = makeTransaction('authorized')
    const { service, captureFn, flush } = buildService(transaction, {
      capture: { status: 'captured', capturedAmount: 125 },
    })

    await expect(service.capturePayment(transaction.id, 125, scope)).rejects.toMatchObject({ status: 409 })

    expect(captureFn).not.toHaveBeenCalled()
    expect(transaction.unifiedStatus).toBe('authorized')
    expect(flush).not.toHaveBeenCalled()
  })

  it('treats a same-status capture as idempotent (double capture stays captured)', async () => {
    const transaction = makeTransaction('captured')
    const { service, captureFn } = buildService(transaction, {
      capture: { status: 'captured', capturedAmount: 80 },
    })

    const result = await service.capturePayment(transaction.id, undefined, scope)

    expect(captureFn).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('captured')
    expect(transaction.unifiedStatus).toBe('captured')
  })

  it('allows only one provider refund while an identical legacy request is in flight', async () => {
    const transaction = makeTransaction('captured')
    const { service, refundFn } = buildService(transaction, {
      refund: { status: 'refunded', refundedAmount: 10, refundId: 're_once' },
    })
    let releaseProvider!: () => void
    const providerBarrier = new Promise<void>((resolve) => { releaseProvider = resolve })
    let providerStarted!: () => void
    const providerStart = new Promise<void>((resolve) => { providerStarted = resolve })
    refundFn.mockImplementation(async () => {
      providerStarted()
      await providerBarrier
      return { status: 'refunded', refundedAmount: 10, refundId: 're_once' }
    })

    const first = refundWithOperation(service, transaction.id, 10, 'duplicate request')
    await providerStart
    const second = refundWithOperation(service, transaction.id, 10, 'duplicate request')
    await Promise.resolve()
    releaseProvider()
    const outcomes = await Promise.allSettled([first, second])

    expect(refundFn).toHaveBeenCalledTimes(1)
    const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled') as PromiseFulfilledResult<unknown>[]
    const rejected = outcomes.filter((outcome) => outcome.status === 'rejected') as PromiseRejectedResult[]
    expect(fulfilled.length).toBeGreaterThanOrEqual(1)
    expect(rejected.every((outcome) => outcome.reason?.status === 409)).toBe(true)
    if (fulfilled.length === 2) expect(fulfilled[1]?.value).toEqual(fulfilled[0]?.value)
  })

  it('reuses a completed refund result for the same operation id', async () => {
    const transaction = makeTransaction('captured')
    const { service, refundFn } = buildService(transaction, {
      refund: { status: 'refunded', refundedAmount: 10, refundId: 're_replay' },
    })

    const first = await refundWithOperation(service, transaction.id, 10, 'return', 'operation-replay')
    const second = await refundWithOperation(service, transaction.id, 10, 'return', 'operation-replay')

    expect(second).toEqual(first)
    expect(refundFn).toHaveBeenCalledTimes(1)
  })

  it('rejects reuse of an operation id with a different refund payload', async () => {
    const transaction = makeTransaction('captured')
    const { service, refundFn } = buildService(transaction, {
      refund: { status: 'partially_refunded', refundedAmount: 10, refundId: 're_partial' },
    })

    await refundWithOperation(service, transaction.id, 10, 'return', 'operation-conflict')
    await expect(refundWithOperation(service, transaction.id, 20, 'return', 'operation-conflict'))
      .rejects.toMatchObject({ status: 409 })

    expect(refundFn).toHaveBeenCalledTimes(1)
  })

  it('retries a failed operation with the same provider idempotency key', async () => {
    const transaction = makeTransaction('captured')
    const { service, refundFn } = buildService(transaction, {
      refund: { status: 'refunded', refundedAmount: 10, refundId: 're_retry' },
    })
    refundFn
      .mockRejectedValueOnce(new Error('provider timeout'))
      .mockResolvedValueOnce({ status: 'refunded', refundedAmount: 10, refundId: 're_retry' })

    await expect(refundWithOperation(service, transaction.id, 10, 'return', 'operation-retry'))
      .rejects.toThrow('provider timeout')
    await refundWithOperation(service, transaction.id, 10, 'return', 'operation-retry')

    const firstKey = (refundFn.mock.calls[0]?.[0] as { idempotencyKey?: string }).idempotencyKey
    const secondKey = (refundFn.mock.calls[1]?.[0] as { idempotencyKey?: string }).idempotencyKey
    expect(firstKey).toEqual(expect.any(String))
    expect(secondKey).toBe(firstKey)
  })

  it('reconciles a retried provider result when a webhook already advanced local status', async () => {
    const transaction = makeTransaction('captured')
    const { service, refundFn } = buildService(transaction, {
      refund: { status: 'partially_refunded', refundedAmount: 10, refundId: 're_reconciled' },
    })
    refundFn
      .mockRejectedValueOnce(new Error('provider timeout'))
      .mockResolvedValueOnce({
        status: 'partially_refunded',
        refundedAmount: 10,
        refundId: 're_reconciled',
      })

    await expect(refundWithOperation(service, transaction.id, 10, 'return', 'operation-reconcile'))
      .rejects.toThrow('provider timeout')
    transaction.unifiedStatus = 'refunded'

    await expect(refundWithOperation(service, transaction.id, 10, 'return', 'operation-reconcile'))
      .resolves.toMatchObject({ status: 'partially_refunded', refundId: 're_reconciled' })
    expect(transaction.unifiedStatus).toBe('refunded')
    expect(refundFn).toHaveBeenCalledTimes(2)
  })

  it('allows equal partial refunds when callers provide distinct operation ids', async () => {
    const transaction = makeTransaction('captured')
    const { service, refundFn } = buildService(transaction, {
      refund: { status: 'partially_refunded', refundedAmount: 10, refundId: 're_partial' },
    })

    await refundWithOperation(service, transaction.id, 10, 'return', 'operation-a')
    await refundWithOperation(service, transaction.id, 10, 'return', 'operation-b')

    expect(refundFn).toHaveBeenCalledTimes(2)
    const firstKey = (refundFn.mock.calls[0]?.[0] as { idempotencyKey?: string }).idempotencyKey
    const secondKey = (refundFn.mock.calls[1]?.[0] as { idempotencyKey?: string }).idempotencyKey
    expect(firstKey).toEqual(expect.any(String))
    expect(secondKey).toEqual(expect.any(String))
    expect(secondKey).not.toBe(firstKey)
  })
})
