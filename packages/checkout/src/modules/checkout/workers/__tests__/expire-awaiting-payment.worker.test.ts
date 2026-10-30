// Release 5, Step 4.2-fix (C1/§12, gap-fill): `expire-awaiting-payment` resolves a session
// left in `awaiting_payment` by a gateway that answers asynchronously. It reuses the SAME
// `confirmOrderAndComplete`/`compensateByCancellingOrder` primitives `commands/submit.ts`'s
// own gateway step (§7.2 step 7) uses on a synchronous answer — never a parallel
// reimplementation.

import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import type { JobContext, QueuedJob } from '@open-mercato/queue'
import { CheckoutSession, CheckoutTransaction } from '../../data/entities'
import type { ExpireAwaitingPaymentJob } from '../expire-awaiting-payment.worker'

const mockFindWithDecryption = jest.fn()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

const mockWriteSessionEvent = jest.fn(async () => undefined)
jest.mock('../../lib/sessionEvents', () => ({
  writeSessionEvent: (...args: unknown[]) => mockWriteSessionEvent(...args),
}))

const mockEmitCheckoutEvent = jest.fn(async () => undefined)
jest.mock('../../events', () => ({
  emitCheckoutEvent: (...args: unknown[]) => mockEmitCheckoutEvent(...args),
}))

const mockConfirmOrderAndComplete = jest.fn(async () => ({
  session: {},
  attempt: 1,
  stockReservationKey: null,
  creditReservationKey: null,
  salesQuoteId: 'quote-1',
  salesOrderId: 'order-1',
}))
const mockCompensateByCancellingOrder = jest.fn(async () => undefined)
jest.mock('../../commands/submit', () => ({
  confirmOrderAndComplete: (...args: unknown[]) => mockConfirmOrderAndComplete(...args),
  compensateByCancellingOrder: (...args: unknown[]) => mockCompensateByCancellingOrder(...args),
}))

const TENANT_ID = 'tenant-expire-1'
const ORG_ID = 'org-expire-1'
const GATEWAY_TRANSACTION_ID = 'gw-txn-1'

function makeSession(overrides: Partial<CheckoutSession> = {}): CheckoutSession {
  return {
    id: 'session-expire-1',
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    cartId: 'cart-expire-1',
    status: 'awaiting_payment',
    submitAttempt: 1,
    submitProgress: 'payment_initiated',
    stockReservationKey: 'checkout:session-expire-1:1:stock',
    creditReservationKey: null,
    salesQuoteId: 'quote-1',
    salesOrderId: 'order-1',
    paymentMethodCode: 'gateway:acme',
    paymentIntentRef: 'provider-session-1',
    paymentExpiresAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as CheckoutSession
}

describe('checkout expire-awaiting-payment worker', () => {
  const mockFindTransactionBySessionId = jest.fn()
  const mockGetPaymentStatus = jest.fn()
  const mockEmFindOne = jest.fn(async () => ({ id: 'checkout-transaction-1' } as CheckoutTransaction))
  const mockEm = {
    fork: () => mockEm,
    findOne: (...args: unknown[]) => mockEmFindOne(...args),
  }

  const resolve = <T = unknown>(name: string): T => {
    if (name === 'em') return mockEm as unknown as T
    if (name === 'paymentGatewayService') {
      return {
        findTransactionBySessionId: (...args: unknown[]) => mockFindTransactionBySessionId(...args),
        getPaymentStatus: (...args: unknown[]) => mockGetPaymentStatus(...args),
      } as unknown as T
    }
    throw new Error(`[internal] Missing dependency: ${name}`)
  }

  const mockContext: JobContext & { resolve: typeof resolve } = {
    resolve,
    jobId: 'job-1',
    attemptNumber: 1,
    queueName: 'checkout-expire-awaiting-payment',
  }

  const baseJob = { id: 'job-1', createdAt: '2026-01-01T00:00:00.000Z' }

  beforeEach(() => {
    jest.clearAllMocks()
    mockEmFindOne.mockResolvedValue({ id: 'checkout-transaction-1' } as CheckoutTransaction)
    mockFindTransactionBySessionId.mockResolvedValue({ id: GATEWAY_TRANSACTION_ID })
    mockGetPaymentStatus.mockResolvedValue({ status: 'captured' })
  })

  it('throws when tenantId or organizationId is missing', async () => {
    const { default: handle } = await import('../expire-awaiting-payment.worker')

    await expect(
      handle({ ...baseJob, payload: {} } as unknown as QueuedJob<ExpireAwaitingPaymentJob>, mockContext),
    ).rejects.toThrow('[internal] tenantId and organizationId are required in ExpireAwaitingPaymentJob')
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
  })

  it('queries only sessions past their payment deadline, scoped by tenant/organization', async () => {
    mockFindWithDecryption.mockResolvedValueOnce([])
    const { default: handle } = await import('../expire-awaiting-payment.worker')

    await handle(
      { ...baseJob, payload: { tenantId: TENANT_ID, organizationId: ORG_ID, batchSize: 10 } } as unknown as QueuedJob<ExpireAwaitingPaymentJob>,
      mockContext,
    )

    expect(mockFindWithDecryption).toHaveBeenCalledWith(
      mockEm,
      CheckoutSession,
      expect.objectContaining({
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        status: 'awaiting_payment',
        paymentExpiresAt: { $lt: expect.any(Date) },
      }),
      expect.objectContaining({ limit: 10 }),
      { tenantId: TENANT_ID, organizationId: ORG_ID },
    )
  })

  it('a gateway-confirmed success resumes through confirmOrderAndComplete, not a duplicate order/markConverted', async () => {
    const session = makeSession()
    mockFindWithDecryption.mockResolvedValueOnce([session])
    mockGetPaymentStatus.mockResolvedValueOnce({ status: 'captured' })
    const { default: handle } = await import('../expire-awaiting-payment.worker')

    await handle(
      { ...baseJob, payload: { tenantId: TENANT_ID, organizationId: ORG_ID } } as unknown as QueuedJob<ExpireAwaitingPaymentJob>,
      mockContext,
    )

    expect(mockFindTransactionBySessionId).toHaveBeenCalledWith(session.paymentIntentRef, { tenantId: TENANT_ID, organizationId: ORG_ID }, session.paymentMethodCode)
    expect(mockGetPaymentStatus).toHaveBeenCalledWith(GATEWAY_TRANSACTION_ID, { tenantId: TENANT_ID, organizationId: ORG_ID })
    expect(mockConfirmOrderAndComplete).toHaveBeenCalledWith(
      expect.anything(),
      mockEm,
      session,
      { tenantId: TENANT_ID, organizationId: ORG_ID },
      session.salesOrderId,
      session.salesQuoteId,
      { stockReservationKey: session.stockReservationKey, creditReservationKey: session.creditReservationKey },
    )
    expect(mockCompensateByCancellingOrder).not.toHaveBeenCalled()
    expect(mockEmitCheckoutEvent).toHaveBeenCalledWith('checkout.payment.succeeded', expect.objectContaining({ sessionId: session.id, orderId: session.salesOrderId }))
  })

  it('a gateway-confirmed failure compensates by cancelling the order and fails with payment_expired', async () => {
    const session = makeSession()
    mockFindWithDecryption.mockResolvedValueOnce([session])
    mockGetPaymentStatus.mockResolvedValueOnce({ status: 'failed' })
    const { default: handle } = await import('../expire-awaiting-payment.worker')

    await handle(
      { ...baseJob, payload: { tenantId: TENANT_ID, organizationId: ORG_ID } } as unknown as QueuedJob<ExpireAwaitingPaymentJob>,
      mockContext,
    )

    expect(mockConfirmOrderAndComplete).not.toHaveBeenCalled()
    expect(mockCompensateByCancellingOrder).toHaveBeenCalledWith(
      expect.anything(),
      mockEm,
      session,
      { tenantId: TENANT_ID, organizationId: ORG_ID },
      session.salesOrderId,
      'payment_expired',
    )
    expect(mockEmitCheckoutEvent).toHaveBeenCalledWith('checkout.payment.failed', expect.objectContaining({ sessionId: session.id, failureCode: 'payment_expired' }))
  })

  it('no definitive answer (gateway transaction not found) compensates rather than resuming', async () => {
    const session = makeSession()
    mockFindWithDecryption.mockResolvedValueOnce([session])
    mockFindTransactionBySessionId.mockResolvedValueOnce(null)
    const { default: handle } = await import('../expire-awaiting-payment.worker')

    await handle(
      { ...baseJob, payload: { tenantId: TENANT_ID, organizationId: ORG_ID } } as unknown as QueuedJob<ExpireAwaitingPaymentJob>,
      mockContext,
    )

    expect(mockGetPaymentStatus).not.toHaveBeenCalled()
    expect(mockConfirmOrderAndComplete).not.toHaveBeenCalled()
    expect(mockCompensateByCancellingOrder).toHaveBeenCalledTimes(1)
  })

  it('a probe that throws is treated as no answer and compensates, never as success', async () => {
    const session = makeSession()
    mockFindWithDecryption.mockResolvedValueOnce([session])
    mockGetPaymentStatus.mockRejectedValueOnce(new Error('gateway unreachable'))
    const { default: handle } = await import('../expire-awaiting-payment.worker')

    await handle(
      { ...baseJob, payload: { tenantId: TENANT_ID, organizationId: ORG_ID } } as unknown as QueuedJob<ExpireAwaitingPaymentJob>,
      mockContext,
    )

    expect(mockConfirmOrderAndComplete).not.toHaveBeenCalled()
    expect(mockCompensateByCancellingOrder).toHaveBeenCalledTimes(1)
  })

  it('a session missing required fields is skipped, never half-resolved', async () => {
    const session = makeSession({ salesOrderId: null })
    mockFindWithDecryption.mockResolvedValueOnce([session])
    const { default: handle } = await import('../expire-awaiting-payment.worker')

    await handle(
      { ...baseJob, payload: { tenantId: TENANT_ID, organizationId: ORG_ID } } as unknown as QueuedJob<ExpireAwaitingPaymentJob>,
      mockContext,
    )

    expect(mockFindTransactionBySessionId).not.toHaveBeenCalled()
    expect(mockConfirmOrderAndComplete).not.toHaveBeenCalled()
    expect(mockCompensateByCancellingOrder).not.toHaveBeenCalled()
  })

  it('a single session failure does not stop the batch', async () => {
    const session1 = makeSession({ id: 'session-expire-1' })
    const session2 = makeSession({ id: 'session-expire-2' })
    mockFindWithDecryption.mockResolvedValueOnce([session1, session2])
    mockGetPaymentStatus.mockResolvedValueOnce({ status: 'captured' })
    mockConfirmOrderAndComplete.mockRejectedValueOnce(new Error('unexpected'))
    mockGetPaymentStatus.mockResolvedValueOnce({ status: 'captured' })
    const { default: handle } = await import('../expire-awaiting-payment.worker')

    await handle(
      { ...baseJob, payload: { tenantId: TENANT_ID, organizationId: ORG_ID } } as unknown as QueuedJob<ExpireAwaitingPaymentJob>,
      mockContext,
    )

    expect(mockConfirmOrderAndComplete).toHaveBeenCalledTimes(2)
  })

  it('a session still within its deadline is never selected (no premature action)', async () => {
    mockFindWithDecryption.mockImplementationOnce(async (_em, _entity, where) => {
      expect(where.paymentExpiresAt.$lt).toBeInstanceOf(Date)
      return []
    })
    const { default: handle } = await import('../expire-awaiting-payment.worker')

    await handle(
      { ...baseJob, payload: { tenantId: TENANT_ID, organizationId: ORG_ID } } as unknown as QueuedJob<ExpireAwaitingPaymentJob>,
      mockContext,
    )

    expect(mockConfirmOrderAndComplete).not.toHaveBeenCalled()
    expect(mockCompensateByCancellingOrder).not.toHaveBeenCalled()
  })
})
