/** @jest-environment node */
import handle from '../workers/webhook-processor'
import { claimWebhookProcessing } from '@open-mercato/core/modules/payment_gateways/lib/webhook-utils'
import { mapWebhookEventToStatus, mapStripeStatus } from '../lib/status-map'
import type { WebhookEvent } from '@open-mercato/shared/modules/payment_gateways/types'

jest.mock('@open-mercato/core/modules/payment_gateways/lib/webhook-utils', () => ({
  claimWebhookProcessing: jest.fn(async () => true),
  releaseWebhookClaim: jest.fn(async () => {}),
}))

jest.mock('../lib/status-map', () => ({
  mapWebhookEventToStatus: jest.fn(() => 'paid'),
  mapStripeStatus: jest.fn(() => 'paid'),
  mapRefundReason: jest.fn(() => undefined),
}))

type WorkerJob = Parameters<typeof handle>[0]
type WorkerCtx = Parameters<typeof handle>[1]

const paymentGatewayService = {
  findTransaction: jest.fn(),
  findTransactionBySessionId: jest.fn(),
  syncTransactionStatus: jest.fn(),
}

const integrationLogService = {
  scoped: jest.fn(() => ({ info: jest.fn(async () => {}) })),
  write: jest.fn(async () => {}),
}

const resolve = (token: string): unknown => {
  if (token === 'em') return {}
  if (token === 'paymentGatewayService') return paymentGatewayService
  if (token === 'integrationLogService') return integrationLogService
  throw new Error(`Unexpected token: ${token}`)
}

const ctx = { resolve } as unknown as WorkerCtx

function makeEvent(overrides: Partial<WebhookEvent> = {}): WebhookEvent {
  return {
    eventType: 'checkout.session.completed',
    eventId: 'evt_1',
    idempotencyKey: 'idem_1',
    timestamp: new Date('2026-01-01T00:00:00.000Z'),
    data: {},
    ...overrides,
  }
}

function makeJob(payload: {
  event: WebhookEvent
  scope?: { organizationId: string; tenantId: string } | null
  transactionId?: string | null
}): WorkerJob {
  return {
    id: 'job_1',
    createdAt: '2026-01-01T00:00:00.000Z',
    payload: { providerKey: 'stripe', ...payload },
  } as unknown as WorkerJob
}

describe('gateway_stripe webhook worker scope handling', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(claimWebhookProcessing as jest.Mock).mockResolvedValue(true)
    ;(mapWebhookEventToStatus as jest.Mock).mockReturnValue('paid')
    ;(mapStripeStatus as jest.Mock).mockReturnValue('paid')
  })

  it('never derives tenant scope from event.data.metadata (fails closed on a scope-less job)', async () => {
    const event = makeEvent({
      data: {
        id: 'cs_test_attacker',
        metadata: { organizationId: 'org-attacker', tenantId: 'tenant-attacker' },
      },
    })

    await handle(makeJob({ event, scope: null, transactionId: null }), ctx)

    expect(paymentGatewayService.findTransaction).not.toHaveBeenCalled()
    expect(paymentGatewayService.findTransactionBySessionId).not.toHaveBeenCalled()
    expect(paymentGatewayService.syncTransactionStatus).not.toHaveBeenCalled()
  })

  it('processes the webhook using the trusted scope from the job payload, ignoring event metadata', async () => {
    const scope = { organizationId: 'org-trusted', tenantId: 'tenant-trusted' }
    const event = makeEvent({
      data: {
        id: 'cs_test_ok',
        status: 'complete',
        metadata: { organizationId: 'org-attacker', tenantId: 'tenant-attacker' },
      },
    })
    paymentGatewayService.findTransactionBySessionId.mockResolvedValue({
      id: 'txn_1',
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    })

    await handle(makeJob({ event, scope, transactionId: null }), ctx)

    expect(paymentGatewayService.findTransactionBySessionId).toHaveBeenCalledWith('cs_test_ok', scope, 'stripe')
    expect(paymentGatewayService.syncTransactionStatus).toHaveBeenCalledWith(
      'txn_1',
      expect.objectContaining({ unifiedStatus: 'paid' }),
      { organizationId: scope.organizationId, tenantId: scope.tenantId },
    )
  })
})
