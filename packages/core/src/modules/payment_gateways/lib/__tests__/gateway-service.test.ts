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

  const flush = jest.fn(async () => {})
  const em = { flush } as never
  const integrationCredentialsService = { resolve: jest.fn(async () => ({})) } as never

  findOneMock.mockResolvedValue(transaction)

  const service = createPaymentGatewayService({ em, integrationCredentialsService })
  return { service, captureFn, refundFn, cancelFn, flush }
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
})
