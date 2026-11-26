import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import handleAuthorized from '../gateway-payment-authorized'
import handleCancelled from '../gateway-payment-cancelled'
import handleCaptured from '../gateway-payment-captured'
import handleFailed from '../gateway-payment-failed'

const executeMock = jest.fn()
const findOneMock = jest.fn()
const refundPaymentMock = jest.fn()
const reportErrorMock = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: jest.fn((name: string) => {
      if (name === 'em') return { findOne: findOneMock }
      if (name === 'paymentGatewayService') return { refundPayment: refundPaymentMock }
      return { execute: executeMock }
    }),
  })),
}))

jest.mock('@open-mercato/shared/lib/logger', () => {
  const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() }
  logger.child.mockReturnValue(logger)
  return { createLogger: jest.fn(() => logger) }
})

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/telemetry/runtime'),
  getTelemetryRuntime: jest.fn(() => ({ reportError: reportErrorMock })),
}))

type LoggerMock = Record<'debug' | 'info' | 'warn' | 'error', jest.Mock>
const logger = jest.requireMock<{ createLogger: () => LoggerMock }>('@open-mercato/shared/lib/logger').createLogger()

const payload = {
  paymentId: 'payment-1',
  organizationId: 'untrusted-org',
  tenantId: 'untrusted-tenant',
  transactionId: 'gw-tx-1',
}

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

const subscribers = [
  { name: 'gateway-payment-authorized', handle: handleAuthorized, status: 'completed', conflictingStatus: 'expired' },
  { name: 'gateway-payment-captured', handle: handleCaptured, status: 'completed', conflictingStatus: 'expired' },
  { name: 'gateway-payment-cancelled', handle: handleCancelled, status: 'cancelled', conflictingStatus: 'completed' },
  { name: 'gateway-payment-failed', handle: handleFailed, status: 'failed', conflictingStatus: 'completed' },
]

describe.each(subscribers)('checkout $name subscriber', ({ handle, status, conflictingStatus }) => {
  beforeEach(() => {
    jest.clearAllMocks()
    findOneMock.mockResolvedValue(undefined)
    refundPaymentMock.mockResolvedValue({ status: 'refunded' })
  })

  it('reports an unexpected status-update failure without rethrowing', async () => {
    const failure = new Error('db unavailable')
    executeMock.mockRejectedValueOnce(failure)

    await expect(handle(payload, scope)).resolves.toBeUndefined()

    expect(reportErrorMock).toHaveBeenCalledTimes(1)
    expect(reportErrorMock).toHaveBeenCalledWith(failure, expect.objectContaining({
      module: 'checkout',
      code: 'checkout.gateway_status_sync_failed',
      attributes: expect.objectContaining({
        paymentId: 'payment-1',
        organizationId: 'org-1',
        tenantId: 'tenant-1',
      }),
    }))
    expect(logger.error).toHaveBeenCalledTimes(1)
  })

  it('reports a refused transition between a paid and an unpaid end state', async () => {
    const refusal = new CrudHttpError(409, {
      error: '[internal] Cannot transition payment',
      code: 'invalid_status_transition',
      currentStatus: conflictingStatus,
      requestedStatus: status,
    })
    executeMock.mockRejectedValueOnce(refusal)

    await expect(handle(payload, scope)).resolves.toBeUndefined()

    expect(reportErrorMock).toHaveBeenCalledTimes(1)
    expect(reportErrorMock).toHaveBeenCalledWith(refusal, expect.objectContaining({
      module: 'checkout',
      code: 'checkout.gateway_status_sync_failed',
    }))
  })

  it('reports a concurrent writer whose status contradicts the gateway outcome', async () => {
    const conflict = new CrudHttpError(409, {
      error: '[internal] Transaction status was already updated by a concurrent process',
      code: 'concurrent_status_update',
      expectedStatus: 'processing',
      currentStatus: conflictingStatus,
      requestedStatus: status,
    })
    executeMock.mockRejectedValueOnce(conflict)

    await expect(handle(payload, scope)).resolves.toBeUndefined()

    expect(reportErrorMock).toHaveBeenCalledTimes(1)
    expect(reportErrorMock).toHaveBeenCalledWith(conflict, expect.objectContaining({
      code: 'checkout.gateway_status_sync_failed',
    }))
  })

  it('reports a checkout transaction whose payment link is gone', async () => {
    const missingLink = new CrudHttpError(404, { error: 'Payment link not found' })
    executeMock.mockRejectedValueOnce(missingLink)

    await expect(handle(payload, scope)).resolves.toBeUndefined()

    expect(reportErrorMock).toHaveBeenCalledTimes(1)
    expect(reportErrorMock).toHaveBeenCalledWith(missingLink, expect.objectContaining({
      code: 'checkout.gateway_status_sync_failed',
    }))
  })

  it('stays quiet when the payment does not belong to a checkout transaction', async () => {
    executeMock.mockRejectedValueOnce(new CrudHttpError(404, { error: 'Transaction not found' }))

    await expect(handle(payload, scope)).resolves.toBeUndefined()

    expect(reportErrorMock).not.toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('stays quiet when a concurrent writer already applied the same status', async () => {
    executeMock.mockRejectedValueOnce(new CrudHttpError(409, {
      error: '[internal] Transaction status was already updated by a concurrent process',
      code: 'concurrent_status_update',
      expectedStatus: 'processing',
      currentStatus: status,
      requestedStatus: status,
    }))

    await expect(handle(payload, scope)).resolves.toBeUndefined()

    expect(reportErrorMock).not.toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('refuses a payment update without trusted scope', async () => {
    await expect(handle(payload, {})).rejects.toThrow('requires trusted event scope')
    expect(executeMock).not.toHaveBeenCalled()
  })

  it('does not report a successful status update', async () => {
    executeMock.mockResolvedValueOnce({ ok: true })

    await expect(handle(payload, scope)).resolves.toBeUndefined()

    expect(executeMock).toHaveBeenCalledWith('checkout.transaction.updateStatus', expect.objectContaining({
      input: expect.objectContaining({ id: 'payment-1', status, ...scope }),
    }))
    expect(reportErrorMock).not.toHaveBeenCalled()
  })
})

describe('checkout gateway-payment-captured subscriber after expiry', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    refundPaymentMock.mockResolvedValue({ status: 'refunded' })
  })

  it('automatically refunds a capture received for an expired checkout transaction', async () => {
    findOneMock.mockResolvedValueOnce({ status: 'expired' })

    await expect(handleCaptured(payload, scope)).resolves.toBeUndefined()

    expect(refundPaymentMock).toHaveBeenCalledWith(
      'gw-tx-1',
      undefined,
      'Checkout transaction expired before payment capture was received',
      scope,
      'checkout-late-capture-payment-1',
    )
    expect(executeMock).toHaveBeenCalledWith('checkout.transaction.updateStatus', expect.objectContaining({
      input: expect.objectContaining({ id: 'payment-1', status: 'expired', paymentStatus: 'refunded' }),
    }))
  })

  it('refunds when expiration wins the race with the captured-payment update', async () => {
    const conflict = new CrudHttpError(409, {
      error: 'Transaction status changed concurrently',
      code: 'concurrent_status_update',
      currentStatus: 'expired',
      requestedStatus: 'completed',
    })
    findOneMock.mockResolvedValueOnce({ status: 'processing' }).mockResolvedValueOnce({ status: 'expired' })
    executeMock.mockRejectedValueOnce(conflict)

    await expect(handleCaptured(payload, scope)).resolves.toBeUndefined()

    expect(refundPaymentMock).toHaveBeenCalledTimes(1)
    expect(executeMock).toHaveBeenCalledTimes(2)
    expect(reportErrorMock).not.toHaveBeenCalled()
  })
})

describe.each(subscribers.filter(({ status }) => status !== 'completed'))(
  'checkout $name subscriber on an unpaid transaction',
  ({ handle, status }) => {
    beforeEach(() => jest.clearAllMocks())

    it('stays quiet when the transaction already reached another unpaid end state', async () => {
      executeMock.mockRejectedValueOnce(new CrudHttpError(409, {
        error: '[internal] Cannot transition payment',
        code: 'invalid_status_transition',
        currentStatus: 'expired',
        requestedStatus: status,
      }))

      await expect(handle(payload, scope)).resolves.toBeUndefined()

      expect(reportErrorMock).not.toHaveBeenCalled()
      expect(logger.error).not.toHaveBeenCalled()
    })
  },
)
