// Release 5, Step 4.2-fix (§7.2 step 7, C1). `createGatewayPaymentSessionResumeHandler`
// resumes a session-backed `CheckoutSession` left in `awaiting_payment` once the gateway
// webhook answers — the gap the review flagged: nothing previously called
// `confirmOrderAndComplete`/`compensateByCancellingOrder` for a session-backed payment, so
// a paid order stayed unconfirmed until the (much later) expiry sweep.

const mockConfirmOrderAndComplete = jest.fn(async (..._args: unknown[]) => ({ completedByThisCall: true }))
const mockCompensateByCancellingOrder = jest.fn(async (..._args: unknown[]) => true)
jest.mock('../../commands/submit', () => ({
  confirmOrderAndComplete: (...args: unknown[]) => mockConfirmOrderAndComplete(...args),
  compensateByCancellingOrder: (...args: unknown[]) => mockCompensateByCancellingOrder(...args),
}))

const mockEmitCheckoutEvent = jest.fn(async (..._args: unknown[]) => undefined)
jest.mock('../../events', () => ({
  emitCheckoutEvent: (...args: unknown[]) => mockEmitCheckoutEvent(...args),
}))

jest.mock('../sessionEvents', () => ({
  writeSessionEvent: jest.fn(async () => undefined),
}))

const mockReportError = jest.fn()
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => mockReportError(...args) }),
}))

type FakeRow = Record<string, any>

let seededTransaction: FakeRow | null = null
let seededSession: FakeRow | null = null

const mockFindOneWithDecryption = jest.fn(async () => seededSession)
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

const mockNativeUpdate = jest.fn(async (..._args: unknown[]) => 1)
const mockEm = {
  findOne: jest.fn(async () => seededTransaction),
  nativeUpdate: (...args: unknown[]) => mockNativeUpdate(...args),
  fork: jest.fn(),
}
mockEm.fork.mockReturnValue(mockEm)

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (name: string) => (name === 'em' ? mockEm : undefined),
  })),
}))

import { createGatewayPaymentSessionResumeHandler } from '../gatewayPaymentSessionResume'
const PAYLOAD = { paymentId: 'txn-1', organizationId: 'org-1', tenantId: 'tenant-1', transactionId: 'gw-1' }

function makeTransaction(overrides: FakeRow = {}): FakeRow {
  return { id: 'txn-1', sessionId: 'session-1', linkId: null, status: 'completed', amount: '125.00', currencyCode: 'USD', gatewayTransactionId: null, ...overrides }
}

function makeSession(overrides: FakeRow = {}): FakeRow {
  return {
    id: 'session-1',
    status: 'awaiting_payment',
    salesOrderId: 'order-1',
    salesQuoteId: 'quote-1',
    stockReservationKey: 'stock-1',
    creditReservationKey: null,
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  seededTransaction = makeTransaction()
  seededSession = makeSession()
  mockNativeUpdate.mockResolvedValue(1)
})

describe('createGatewayPaymentSessionResumeHandler', () => {
  it('completed: confirms the order for a session-backed (linkId=null) transaction', async () => {
    const handle = createGatewayPaymentSessionResumeHandler('completed')
    await handle(PAYLOAD)

    expect(mockConfirmOrderAndComplete).toHaveBeenCalledWith(
      expect.anything(),
      mockEm,
      seededSession,
      { tenantId: 'tenant-1', organizationId: 'org-1' },
      'order-1',
      'quote-1',
      { stockReservationKey: 'stock-1', creditReservationKey: null },
      { amount: '125.00', currencyCode: 'USD', paymentReference: 'txn-1', captured: true, checkoutTransaction: { id: 'txn-1', paymentStatus: null } },
    )
    expect(mockCompensateByCancellingOrder).not.toHaveBeenCalled()
  })

  it('failed: compensates by cancelling the order', async () => {
    seededTransaction = makeTransaction({ status: 'failed' })
    const handle = createGatewayPaymentSessionResumeHandler('failed')
    await handle(PAYLOAD)

    expect(mockCompensateByCancellingOrder).toHaveBeenCalledWith(
      expect.anything(),
      mockEm,
      seededSession,
      { tenantId: 'tenant-1', organizationId: 'org-1' },
      'order-1',
      'payment_failed',
    )
    expect(mockConfirmOrderAndComplete).not.toHaveBeenCalled()
  })

  it('failed: emits no payment result when the compensation lost its status CAS', async () => {
    seededTransaction = makeTransaction({ status: 'failed' })
    mockCompensateByCancellingOrder.mockResolvedValueOnce(false)
    const handle = createGatewayPaymentSessionResumeHandler('failed')
    await handle(PAYLOAD)

    expect(mockEmitCheckoutEvent).not.toHaveBeenCalledWith('checkout.payment.failed', expect.anything())
  })

  it('cancelled: compensates with the cancelled failure code', async () => {
    seededTransaction = makeTransaction({ status: 'cancelled' })
    const handle = createGatewayPaymentSessionResumeHandler('cancelled')
    await handle(PAYLOAD)

    expect(mockCompensateByCancellingOrder).toHaveBeenCalledWith(
      expect.anything(),
      mockEm,
      seededSession,
      { tenantId: 'tenant-1', organizationId: 'org-1' },
      'order-1',
      'payment_cancelled',
    )
  })

  it('is a no-op for a link-backed transaction (sessionId null) — Phase A already handles it', async () => {
    seededTransaction = makeTransaction({ sessionId: null })
    const handle = createGatewayPaymentSessionResumeHandler('completed')
    await handle(PAYLOAD)

    expect(mockConfirmOrderAndComplete).not.toHaveBeenCalled()
    expect(mockCompensateByCancellingOrder).not.toHaveBeenCalled()
  })

  it('is a no-op when the session already moved past awaiting_payment (idempotent redelivery / lost the race)', async () => {
    seededSession = makeSession({ status: 'completed' })
    const handle = createGatewayPaymentSessionResumeHandler('completed')
    await handle(PAYLOAD)

    expect(mockConfirmOrderAndComplete).not.toHaveBeenCalled()
  })

  it('is a no-op when the transaction cannot be found', async () => {
    seededTransaction = null
    const handle = createGatewayPaymentSessionResumeHandler('completed')
    await handle(PAYLOAD)

    expect(mockConfirmOrderAndComplete).not.toHaveBeenCalled()
  })

  it('is a no-op when the payload is incomplete', async () => {
    const handle = createGatewayPaymentSessionResumeHandler('completed')
    await handle({ paymentId: 'txn-1' })

    expect(mockConfirmOrderAndComplete).not.toHaveBeenCalled()
  })

  // BLOCKER regression: a transient failure (e.g. a DB hiccup inside confirmOrderAndComplete)
  // used to be caught and swallowed, returning successfully — which acks a `persistent: true`
  // subscriber's event for good, leaving the order confirmed-at-the-gateway but never
  // confirmed in checkout. It must now propagate so the event bus redelivers, and report the
  // error for observability.
  it('propagates a transient failure (never swallows it) and reports it, so a persistent subscriber redelivery can retry', async () => {
    mockConfirmOrderAndComplete.mockRejectedValueOnce(new Error('transient db error'))
    const handle = createGatewayPaymentSessionResumeHandler('completed')

    await expect(handle(PAYLOAD)).rejects.toThrow('transient db error')
    expect(mockReportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ module: 'checkout', code: 'checkout.gateway_payment_session_resume_failed' }),
    )
  })

  it('redelivery after a transient failure completes exactly once', async () => {
    mockConfirmOrderAndComplete.mockRejectedValueOnce(new Error('transient db error'))
    const handle = createGatewayPaymentSessionResumeHandler('completed')

    await expect(handle(PAYLOAD)).rejects.toThrow('transient db error')
    expect(mockConfirmOrderAndComplete).toHaveBeenCalledTimes(1)

    // Redelivery: the session is still `awaiting_payment` (confirmOrderAndComplete never
    // got far enough to flip it), so the retry resumes and this time succeeds.
    await handle(PAYLOAD)
    expect(mockConfirmOrderAndComplete).toHaveBeenCalledTimes(2)
    expect(mockCompensateByCancellingOrder).not.toHaveBeenCalled()
  })

  it('emits no payment.succeeded event when confirmOrderAndComplete lost the session claim to a concurrent capture', async () => {
    mockConfirmOrderAndComplete.mockResolvedValueOnce({ completedByThisCall: false })
    await createGatewayPaymentSessionResumeHandler('completed')(PAYLOAD)

    expect(mockConfirmOrderAndComplete).toHaveBeenCalledTimes(1)
    expect(mockEmitCheckoutEvent).not.toHaveBeenCalledWith('checkout.payment.succeeded', expect.anything())
  })

  it('records an authorized-only transaction as not captured, keying its recorded marker on that status', async () => {
    seededTransaction = makeTransaction({ paymentStatus: 'authorized' })
    await createGatewayPaymentSessionResumeHandler('completed')(PAYLOAD)

    expect(mockConfirmOrderAndComplete).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.anything(), expect.anything(), expect.anything(), expect.anything(), expect.anything(),
      expect.objectContaining({ captured: false, checkoutTransaction: { id: 'txn-1', paymentStatus: 'authorized' } }),
    )
  })

  it('is a no-op when the persisted transaction state differs from the event outcome (captured event, failed transaction)', async () => {
    seededTransaction = makeTransaction({ status: 'failed' })
    await createGatewayPaymentSessionResumeHandler('completed')(PAYLOAD)

    expect(mockNativeUpdate).not.toHaveBeenCalled()
    expect(mockConfirmOrderAndComplete).not.toHaveBeenCalled()
    expect(mockCompensateByCancellingOrder).not.toHaveBeenCalled()
  })

  it('is a no-op for a failed event when the persisted transaction was already completed', async () => {
    seededTransaction = makeTransaction({ status: 'completed' })
    await createGatewayPaymentSessionResumeHandler('failed')(PAYLOAD)

    expect(mockConfirmOrderAndComplete).not.toHaveBeenCalled()
    expect(mockCompensateByCancellingOrder).not.toHaveBeenCalled()
  })

  it('is a no-op while the persisted transaction is still processing', async () => {
    seededTransaction = makeTransaction({ status: 'processing' })
    await createGatewayPaymentSessionResumeHandler('completed')(PAYLOAD)

    expect(mockConfirmOrderAndComplete).not.toHaveBeenCalled()
  })

  it('atomically claims the awaiting_payment session before any finalizer side effect and no-ops when the claim is lost', async () => {
    mockNativeUpdate.mockResolvedValueOnce(0)
    await createGatewayPaymentSessionResumeHandler('completed')(PAYLOAD)

    expect(mockNativeUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'session-1', status: 'awaiting_payment' }),
      expect.objectContaining({ submitProgress: 'payment_resolving' }),
    )
    expect(mockConfirmOrderAndComplete).not.toHaveBeenCalled()
    expect(mockCompensateByCancellingOrder).not.toHaveBeenCalled()
  })

  it('releases the claim when the finalizer fails so a redelivery can reclaim', async () => {
    mockConfirmOrderAndComplete.mockRejectedValueOnce(new Error('transient db error'))
    await expect(createGatewayPaymentSessionResumeHandler('completed')(PAYLOAD)).rejects.toThrow('transient db error')

    expect(mockNativeUpdate).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'session-1', submitProgress: 'payment_resolving' }),
      expect.objectContaining({ submitProgress: 'payment_initiated' }),
    )
  })
})
