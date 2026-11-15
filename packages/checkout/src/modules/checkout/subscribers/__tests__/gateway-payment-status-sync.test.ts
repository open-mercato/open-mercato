import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import handleAuthorized from '../gateway-payment-authorized'
import handleCancelled from '../gateway-payment-cancelled'
import handleCaptured from '../gateway-payment-captured'
import handleFailed from '../gateway-payment-failed'

const executeMock = jest.fn()
const reportErrorMock = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: jest.fn(() => ({ execute: executeMock })),
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

const payload = {
  paymentId: 'payment-1',
  organizationId: 'org-1',
  tenantId: 'tenant-1',
  transactionId: 'gw-tx-1',
}

const subscribers = [
  { name: 'gateway-payment-authorized', handle: handleAuthorized, status: 'completed' },
  { name: 'gateway-payment-captured', handle: handleCaptured, status: 'completed' },
  { name: 'gateway-payment-cancelled', handle: handleCancelled, status: 'cancelled' },
  { name: 'gateway-payment-failed', handle: handleFailed, status: 'failed' },
]

describe.each(subscribers)('checkout $name subscriber', ({ handle, status }) => {
  beforeEach(() => jest.clearAllMocks())

  it('reports an unexpected status-update failure without rethrowing', async () => {
    const failure = new Error('db unavailable')
    executeMock.mockRejectedValueOnce(failure)

    await expect(handle(payload)).resolves.toBeUndefined()

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
  })

  it('reports a refused transition that leaves the transaction in another terminal state', async () => {
    const refusal = new CrudHttpError(409, {
      error: '[internal] Cannot transition payment',
      code: 'invalid_status_transition',
      currentStatus: 'expired',
      requestedStatus: status,
    })
    executeMock.mockRejectedValueOnce(refusal)

    await expect(handle(payload)).resolves.toBeUndefined()

    expect(reportErrorMock).toHaveBeenCalledTimes(1)
    expect(reportErrorMock).toHaveBeenCalledWith(refusal, expect.objectContaining({
      module: 'checkout',
      code: 'checkout.gateway_status_sync_failed',
    }))
  })

  it('reports a concurrent writer that left the transaction in a different status', async () => {
    const conflict = new CrudHttpError(409, {
      error: '[internal] Transaction status was already updated by a concurrent process',
      code: 'concurrent_status_update',
      expectedStatus: 'processing',
      currentStatus: 'expired',
      requestedStatus: status,
    })
    executeMock.mockRejectedValueOnce(conflict)

    await expect(handle(payload)).resolves.toBeUndefined()

    expect(reportErrorMock).toHaveBeenCalledTimes(1)
    expect(reportErrorMock).toHaveBeenCalledWith(conflict, expect.objectContaining({
      code: 'checkout.gateway_status_sync_failed',
    }))
  })

  it('reports a checkout transaction whose payment link is gone', async () => {
    const missingLink = new CrudHttpError(404, { error: 'Payment link not found' })
    executeMock.mockRejectedValueOnce(missingLink)

    await expect(handle(payload)).resolves.toBeUndefined()

    expect(reportErrorMock).toHaveBeenCalledTimes(1)
    expect(reportErrorMock).toHaveBeenCalledWith(missingLink, expect.objectContaining({
      code: 'checkout.gateway_status_sync_failed',
    }))
  })

  it('stays quiet when the payment does not belong to a checkout transaction', async () => {
    executeMock.mockRejectedValueOnce(new CrudHttpError(404, { error: 'Transaction not found' }))

    await expect(handle(payload)).resolves.toBeUndefined()

    expect(reportErrorMock).not.toHaveBeenCalled()
  })

  it('stays quiet when a concurrent writer already applied the same status', async () => {
    executeMock.mockRejectedValueOnce(new CrudHttpError(409, {
      error: '[internal] Transaction status was already updated by a concurrent process',
      code: 'concurrent_status_update',
      expectedStatus: 'processing',
      currentStatus: status,
      requestedStatus: status,
    }))

    await expect(handle(payload)).resolves.toBeUndefined()

    expect(reportErrorMock).not.toHaveBeenCalled()
  })

  it('does not report a successful status update', async () => {
    executeMock.mockResolvedValueOnce({ ok: true })

    await expect(handle(payload)).resolves.toBeUndefined()

    expect(executeMock).toHaveBeenCalledWith('checkout.transaction.updateStatus', expect.objectContaining({
      input: expect.objectContaining({ id: 'payment-1', status }),
    }))
    expect(reportErrorMock).not.toHaveBeenCalled()
  })
})
