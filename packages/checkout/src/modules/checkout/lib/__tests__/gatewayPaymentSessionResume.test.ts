// Release 5, Step 4.2-fix (§7.2 step 7, C1). `createGatewayPaymentSessionResumeHandler`
// resumes a session-backed `CheckoutSession` left in `awaiting_payment` once the gateway
// webhook answers — the gap the review flagged: nothing previously called
// `confirmOrderAndComplete`/`compensateByCancellingOrder` for a session-backed payment, so
// a paid order stayed unconfirmed until the (much later) expiry sweep.

const mockConfirmOrderAndComplete = jest.fn(async () => undefined)
const mockCompensateByCancellingOrder = jest.fn(async () => undefined)
jest.mock('../../commands/submit', () => ({
  confirmOrderAndComplete: (...args: unknown[]) => mockConfirmOrderAndComplete(...args),
  compensateByCancellingOrder: (...args: unknown[]) => mockCompensateByCancellingOrder(...args),
}))

jest.mock('../../events', () => ({
  emitCheckoutEvent: jest.fn(async () => undefined),
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

const mockEm = {
  findOne: jest.fn(async () => seededTransaction),
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
  return { id: 'txn-1', sessionId: 'session-1', linkId: null, ...overrides }
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
    )
    expect(mockCompensateByCancellingOrder).not.toHaveBeenCalled()
  })

  it('failed: compensates by cancelling the order', async () => {
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

  it('cancelled: compensates with the cancelled failure code', async () => {
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
})
