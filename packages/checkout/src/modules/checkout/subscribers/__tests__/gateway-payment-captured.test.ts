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

jest.mock('../../events', () => ({
  emitCheckoutEvent: jest.fn(async () => undefined),
}))

import handle from '../gateway-payment-captured'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import '../../commands/transactions'

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

  it.each([
    ['gateway-payment-captured'],
    ['gateway-payment-authorized'],
    ['gateway-payment-cancelled'],
    ['gateway-payment-failed'],
  ])('%s treats a payment with no checkout transaction as an idempotent no-op (never rethrown, never reported)', async (name) => {
    const { default: subscriber } = await import(`../${name}`)
    mockExecute.mockRejectedValueOnce(new CrudHttpError(404, {
      error: 'Transaction not found',
      code: 'checkout_transaction_not_found',
    }))

    await expect(subscriber(PAYLOAD)).resolves.toBeUndefined()

    expect(mockReportError).not.toHaveBeenCalled()
    expect(mockResumeSession).not.toHaveBeenCalled()
  })

  // #8268 review finding 3: a session-backed payment authorized at submit already has its
  // authorized-only `SalesPayment` recorded (`paymentRecordedAt` set). The later capture
  // webhook must clear that marker in the same status write, or `repair-gateway-payments`
  // (which selects only unrecorded rows) never reconciles the captured amount.
  it('a capture webhook on an already-recorded authorized session transaction clears paymentRecordedAt', async () => {
    const ids = {
      transaction: '123e4567-e89b-12d3-a456-426614175001',
      gateway: '123e4567-e89b-12d3-a456-426614175002',
      tenant: '123e4567-e89b-12d3-a456-426614175003',
      organization: '123e4567-e89b-12d3-a456-426614175004',
    }
    const row: Record<string, unknown> = {
      id: ids.transaction,
      tenantId: ids.tenant,
      organizationId: ids.organization,
      linkId: null,
      sessionId: 'session-1',
      status: 'completed',
      paymentStatus: 'authorized',
      gatewayTransactionId: ids.gateway,
      paymentRecordedAt: new Date('2026-11-01T00:00:00.000Z'),
    }
    const matches = (where: Record<string, unknown>) => Object.entries(where).every(([key, value]) => row[key] === value)
    const em: Record<string, unknown> = {
      findOne: async (_entity: unknown, where: Record<string, unknown>) => (matches(where) ? { ...row } : null),
      nativeUpdate: async (_entity: unknown, where: Record<string, unknown>, set: Record<string, unknown>) => {
        if (!matches(where)) return 0
        Object.assign(row, set)
        return 1
      },
      refresh: async () => undefined,
    }
    em.transactional = async (callback: (tx: Record<string, unknown>) => Promise<unknown>) => callback(em)
    mockExecute.mockImplementationOnce(async (id: string, options: { input: Record<string, unknown>; ctx: CommandRuntimeContext }) => {
      const command = commandRegistry.get(id)
      if (!command) throw new Error(`[internal] ${id} is not registered`)
      const container = { resolve: (name: string) => (name === 'em' ? em : undefined) } as unknown as CommandRuntimeContext['container']
      return command.execute(options.input, { ...options.ctx, container })
    })

    await handle({ paymentId: ids.transaction, organizationId: ids.organization, tenantId: ids.tenant, transactionId: ids.gateway })

    expect(row).toMatchObject({ status: 'completed', paymentStatus: 'captured', paymentRecordedAt: null })
    expect(mockResumeSession).toHaveBeenCalledTimes(1)
  })

  it('still propagates a 404 that is not the missing-transaction case (for example a missing link)', async () => {
    mockExecute.mockRejectedValueOnce(new CrudHttpError(404, { error: 'Payment link not found' }))

    await expect(handle(PAYLOAD)).rejects.toMatchObject({ status: 404 })
    expect(mockReportError).toHaveBeenCalled()
  })
})
