/** @jest-environment node */

// BLOCKER regression: this subscriber is `persistent: true` — a swallowed failure from
// `checkout.transaction.updateStatus` used to ack the event for good, leaving a captured
// payment unconfirmed with no retry. Only a PROVEN terminal/idempotent conflict (the
// transaction already reached a different terminal state) may be swallowed; everything
// else must propagate so the event bus redelivers.

const mockExecute = jest.fn()
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (name: string) => (name === 'commandBus' ? { execute: mockExecute } : undefined),
  })),
}))

const mockResumeSession = jest.fn(async () => undefined)
jest.mock('../../lib/gatewayPaymentSessionResume', () => ({
  createGatewayPaymentSessionResumeHandler: () => (...args: unknown[]) => mockResumeSession(...args),
}))

const mockReportError = jest.fn()
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => mockReportError(...args) }),
}))

import handle from '../gateway-payment-captured'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const PAYLOAD = { paymentId: 'txn-1', organizationId: 'org-1', tenantId: 'tenant-1', transactionId: 'gw-1' }

describe('checkout-gateway-payment-captured subscriber', () => {
  beforeEach(() => jest.clearAllMocks())

  it('propagates a transient failure and reports it — never acks the event', async () => {
    mockExecute.mockRejectedValueOnce(new Error('db unavailable'))

    await expect(handle(PAYLOAD)).rejects.toThrow('db unavailable')

    expect(mockReportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ module: 'checkout', code: 'checkout.gateway_payment_captured_update_status_failed' }),
    )
    // The session-resume step never runs for a status-update failure that must retry —
    // retrying the whole handler on redelivery is simpler and safer than resuming only half.
    expect(mockResumeSession).not.toHaveBeenCalled()
  })

  it('swallows a proven terminal conflict (transaction already failed) and still resumes the session', async () => {
    mockExecute.mockRejectedValueOnce(new CrudHttpError(409, {
      code: 'invalid_status_transition',
      currentStatus: 'failed',
      requestedStatus: 'completed',
    }))

    await expect(handle(PAYLOAD)).resolves.toBeUndefined()

    expect(mockReportError).not.toHaveBeenCalled()
    expect(mockResumeSession).toHaveBeenCalledWith(PAYLOAD)
  })

  it('propagates a non-terminal 409 (a genuine race, not a proven dead end)', async () => {
    mockExecute.mockRejectedValueOnce(new CrudHttpError(409, {
      code: 'concurrent_status_update',
      currentStatus: 'processing',
      requestedStatus: 'completed',
    }))

    await expect(handle(PAYLOAD)).rejects.toMatchObject({ status: 409 })
    expect(mockReportError).toHaveBeenCalled()
  })

  it('redelivery after a transient failure eventually succeeds and resumes the session exactly once', async () => {
    mockExecute.mockRejectedValueOnce(new Error('transient'))
    await expect(handle(PAYLOAD)).rejects.toThrow('transient')
    expect(mockResumeSession).not.toHaveBeenCalled()

    mockExecute.mockResolvedValueOnce({ result: { ok: true } })
    await handle(PAYLOAD)
    expect(mockResumeSession).toHaveBeenCalledTimes(1)
  })
})
