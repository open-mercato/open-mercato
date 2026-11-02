/** @jest-environment node */
import handle from '../workers/webhook-processor'
import { claimWebhookProcessing } from '@open-mercato/core/modules/payment_gateways/lib/webhook-utils'
import type { WebhookEvent } from '@open-mercato/shared/modules/payment_gateways/types'

jest.mock('@open-mercato/core/modules/payment_gateways/lib/webhook-utils', () => ({
  claimWebhookProcessing: jest.fn(async () => true),
  releaseWebhookClaim: jest.fn(async () => {}),
}))

type WorkerJob = Parameters<typeof handle>[0]
type WorkerCtx = Parameters<typeof handle>[1]

const scope = { organizationId: 'org_1', tenantId: 'tenant_1' }

const paymentGatewayService = {
  findTransaction: jest.fn(),
  findTransactionBySessionId: jest.fn(),
  syncTransactionStatus: jest.fn(),
}

const logInfo = jest.fn(async () => {})
const integrationLogService = {
  scoped: jest.fn(() => ({ info: logInfo })),
  write: jest.fn(async () => {}),
}

const resolve = (token: string): unknown => {
  if (token === 'em') return {}
  if (token === 'paymentGatewayService') return paymentGatewayService
  if (token === 'integrationLogService') return integrationLogService
  throw new Error(`Unexpected token: ${token}`)
}

const ctx = { resolve } as unknown as WorkerCtx

function makeJob(eventType: string, data: Record<string, unknown>): WorkerJob {
  const event: WebhookEvent = {
    eventType,
    eventId: 'evt_1',
    idempotencyKey: 'evt_1',
    timestamp: new Date('2026-01-01T00:00:00.000Z'),
    data,
  }
  return {
    id: 'job_1',
    createdAt: '2026-01-01T00:00:00.000Z',
    payload: { providerKey: 'stripe', _jobOrigin: 'inbound-webhook', event, scope, transactionId: 'txn_1' },
  } as unknown as WorkerJob
}

describe('gateway_stripe webhook worker status resolution', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(claimWebhookProcessing as jest.Mock).mockResolvedValue(true)
    paymentGatewayService.findTransaction.mockResolvedValue({ id: 'txn_1', ...scope })
  })

  it('records a partial refund as partially_refunded', async () => {
    const charge = { id: 'ch_1', payment_intent: 'pi_123', amount: 1000, amount_captured: 1000, amount_refunded: 400, refunded: false, status: 'succeeded' }

    await handle(makeJob('charge.refunded', charge), ctx)

    expect(paymentGatewayService.syncTransactionStatus).toHaveBeenCalledTimes(1)
    expect(paymentGatewayService.syncTransactionStatus).toHaveBeenCalledWith(
      'txn_1',
      { unifiedStatus: 'partially_refunded', providerStatus: 'charge.refunded', providerData: charge },
      scope,
    )
  })

  it('records a full refund as refunded', async () => {
    const charge = { id: 'ch_1', payment_intent: 'pi_123', amount: 1000, amount_captured: 1000, amount_refunded: 1000, refunded: true, status: 'succeeded' }

    await handle(makeJob('charge.refunded', charge), ctx)

    expect(paymentGatewayService.syncTransactionStatus).toHaveBeenCalledWith(
      'txn_1',
      expect.objectContaining({ unifiedStatus: 'refunded' }),
      scope,
    )
  })

  it('keeps mapping PaymentIntent events', async () => {
    await handle(makeJob('payment_intent.succeeded', { id: 'pi_123', status: 'succeeded' }), ctx)

    expect(paymentGatewayService.syncTransactionStatus).toHaveBeenCalledWith(
      'txn_1',
      expect.objectContaining({ unifiedStatus: 'captured' }),
      scope,
    )
  })

  it.each([
    ['charge.refund.updated', { id: 're_1', payment_intent: 'pi_123', amount: 400, status: 'succeeded' }],
    ['charge.dispute.created', { id: 'dp_1', payment_intent: 'pi_123', amount: 1000, status: 'needs_response' }],
    ['charge.dispute.closed', { id: 'dp_1', payment_intent: 'pi_123', amount: 1000, status: 'lost' }],
    ['charge.succeeded', { id: 'ch_1', payment_intent: 'pi_123', amount: 1000, captured: false, status: 'succeeded' }],
  ])('logs %s without changing the transaction status', async (eventType, data) => {
    await handle(makeJob(eventType, data), ctx)

    expect(paymentGatewayService.syncTransactionStatus).not.toHaveBeenCalled()
    expect(logInfo).toHaveBeenCalledWith('Stripe webhook processed', {
      eventType,
      transactionId: 'txn_1',
      unifiedStatus: 'unknown',
    })
  })
})
