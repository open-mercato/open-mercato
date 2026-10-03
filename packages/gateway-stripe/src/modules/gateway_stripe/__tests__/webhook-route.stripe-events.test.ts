/** @jest-environment node */
import Stripe from 'stripe'
import { POST } from '@open-mercato/core/modules/payment_gateways/api/webhook/[provider]/route'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { getPaymentGatewayQueue } from '@open-mercato/core/modules/payment_gateways/lib/queue'
import { claimWebhookProcessing } from '@open-mercato/core/modules/payment_gateways/lib/webhook-utils'
import {
  clearGatewayAdapters,
  clearWebhookHandlers,
  registerGatewayAdapter,
  registerWebhookHandler,
} from '@open-mercato/shared/modules/payment_gateways/types'
import { stripeAdapterV20250224Acacia } from '../lib/adapters/v2025-02-24.acacia'
import { readStripeSessionIdHint, verifyStripeWebhook } from '../lib/webhook-handler'

const mockResolve = jest.fn()
const mockEnqueue = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({ resolve: mockResolve })),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/payment_gateways/lib/queue', () => ({
  getPaymentGatewayQueue: jest.fn(() => ({ enqueue: mockEnqueue })),
}))

jest.mock('@open-mercato/core/modules/payment_gateways/lib/webhook-utils', () => ({
  claimWebhookProcessing: jest.fn(async () => true),
  releaseWebhookClaim: jest.fn(async () => {}),
}))

const TENANT_A = { organizationId: 'org_a', tenantId: 'tenant_a' }
const TENANT_B = { organizationId: 'org_b', tenantId: 'tenant_b' }
const SECRET_A = 'whsec_tenant_a'
const SECRET_B = 'whsec_tenant_b'
const TRANSACTIONS = [
  { id: 'txn_a', providerKey: 'stripe', providerSessionId: 'pi_tenant_a', ...TENANT_A },
  { id: 'txn_b', providerKey: 'stripe', providerSessionId: 'pi_tenant_b', ...TENANT_B },
]

const paymentGatewayService = {
  findTransaction: jest.fn(),
  findTransactionBySessionId: jest.fn(),
  syncTransactionStatus: jest.fn(),
}
const integrationLogService = { write: jest.fn(async () => {}) }
const credentialsService = {
  resolve: jest.fn(async (_integrationId: string, scope: { tenantId: string }) => ({
    secretKey: 'sk_test_local',
    webhookSecret: scope.tenantId === TENANT_A.tenantId ? SECRET_A : SECRET_B,
  })),
}

function signedRequest(
  type: string,
  object: Record<string, unknown>,
  secret = SECRET_A,
  apiVersion = '2025-02-24.acacia',
): Request {
  const body = JSON.stringify({ id: `evt_${type}`, object: 'event', api_version: apiVersion, type, created: 1790000000, data: { object } })
  const signature = new Stripe('sk_test_local').webhooks.generateTestHeaderString({ payload: body, secret })
  return new Request('http://localhost/api/payment_gateways/webhook/stripe', {
    method: 'POST',
    headers: { 'stripe-signature': signature },
    body,
  })
}

async function post(request: Request): Promise<Response> {
  return POST(request, { params: { provider: 'stripe' } })
}

function charge(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'ch_1',
    object: 'charge',
    payment_intent: 'pi_tenant_a',
    amount: 1000,
    amount_captured: 1000,
    amount_refunded: 0,
    captured: true,
    refunded: false,
    status: 'succeeded',
    ...overrides,
  }
}

describe('stripe webhooks through the payment gateway webhook route', () => {
  const originalQueueStrategy = process.env.QUEUE_STRATEGY

  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.QUEUE_STRATEGY
    registerGatewayAdapter(stripeAdapterV20250224Acacia, { version: '2025-02-24.acacia' })
    registerWebhookHandler('stripe', verifyStripeWebhook, {
      queue: 'stripe-webhook',
      readSessionIdHint: readStripeSessionIdHint,
    })
    ;(claimWebhookProcessing as jest.Mock).mockResolvedValue(true)
    ;(findWithDecryption as jest.Mock).mockImplementation(
      async (_em: unknown, _entity: unknown, where: { providerKey: string; providerSessionId: string }) =>
        TRANSACTIONS.filter((transaction) =>
          transaction.providerKey === where.providerKey && transaction.providerSessionId === where.providerSessionId),
    )
    paymentGatewayService.findTransaction.mockImplementation(
      async (id: string, scope: { tenantId: string }) =>
        TRANSACTIONS.find((transaction) => transaction.id === id && transaction.tenantId === scope.tenantId) ?? null,
    )
    mockResolve.mockImplementation((token: string) => {
      if (token === 'rateLimiterService') {
        return {
          trustProxyDepth: 1,
          consume: jest.fn(async () => ({ allowed: true, remainingPoints: 59, msBeforeNext: 0, consumedPoints: 1 })),
        }
      }
      if (token === 'em') return {}
      if (token === 'paymentGatewayService') return paymentGatewayService
      if (token === 'integrationCredentialsService') return credentialsService
      if (token === 'integrationLogService') return integrationLogService
      throw new Error(`Unexpected token: ${token}`)
    })
  })

  afterEach(() => {
    clearGatewayAdapters()
    clearWebhookHandlers()
    if (originalQueueStrategy === undefined) delete process.env.QUEUE_STRATEGY
    else process.env.QUEUE_STRATEGY = originalQueueStrategy
  })

  function expectSyncedStatus(unifiedStatus: string, eventType: string) {
    expect(paymentGatewayService.syncTransactionStatus).toHaveBeenCalledTimes(1)
    expect(paymentGatewayService.syncTransactionStatus).toHaveBeenCalledWith(
      'txn_a',
      expect.objectContaining({
        unifiedStatus,
        providerStatus: eventType,
        webhookEvent: expect.objectContaining({ eventType, processed: true }),
      }),
      TENANT_A,
    )
  }

  it('still syncs payment_intent.succeeded as captured', async () => {
    const response = await post(signedRequest('payment_intent.succeeded', {
      id: 'pi_tenant_a',
      object: 'payment_intent',
      status: 'succeeded',
    }))

    expect(response.status).toBe(202)
    expectSyncedStatus('captured', 'payment_intent.succeeded')
  })

  it('accepts a full charge.refunded and syncs the transaction as refunded', async () => {
    const response = await post(signedRequest('charge.refunded', charge({ amount_refunded: 1000, refunded: true })))

    expect(response.status).toBe(202)
    expect(findWithDecryption).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ providerKey: 'stripe', providerSessionId: 'pi_tenant_a' }),
      expect.anything(),
    )
    expectSyncedStatus('refunded', 'charge.refunded')
  })

  it('accepts a partial charge.refunded and syncs the transaction as partially_refunded', async () => {
    const response = await post(signedRequest('charge.refunded', charge({ amount_refunded: 400 })))

    expect(response.status).toBe(202)
    expectSyncedStatus('partially_refunded', 'charge.refunded')
  })

  it.each([
    ['2025-02-24.acacia', 700, 'partially_refunded'],
    ['2025-02-24.acacia', 400, 'unknown'],
    ['2025-03-31.basil', 300, 'partially_refunded'],
    ['2025-03-31.basil', 600, 'refunded'],
  ])('reads a partial capture of 600 out of 1000 with the event API version %s (amount_refunded %d → %s)', async (apiVersion, amountRefunded, expected) => {
    const response = await post(signedRequest(
      'charge.refunded',
      charge({ amount_captured: 600, amount_refunded: amountRefunded }),
      SECRET_A,
      apiVersion,
    ))

    expect(response.status).toBe(202)
    expectSyncedStatus(expected, 'charge.refunded')
  })

  it.each([
    ['charge.refund.updated', { id: 're_1', object: 'refund', payment_intent: 'pi_tenant_a', charge: 'ch_1', amount: 400, status: 'succeeded' }],
    ['charge.dispute.created', { id: 'dp_1', object: 'dispute', payment_intent: 'pi_tenant_a', charge: 'ch_1', amount: 1000, status: 'needs_response' }],
    ['charge.dispute.closed', { id: 'dp_1', object: 'dispute', payment_intent: 'pi_tenant_a', charge: 'ch_1', amount: 1000, status: 'lost' }],
    ['charge.succeeded', charge({ captured: false, amount_captured: 0 })],
  ])('accepts %s and syncs it with no status to apply', async (eventType, object) => {
    const response = await post(signedRequest(eventType, object))

    expect(response.status).toBe(202)
    expectSyncedStatus('unknown', eventType)
  })

  it('syncs a charge.refunded for a released authorization with no status to apply', async () => {
    const response = await post(signedRequest('charge.refunded', charge({
      captured: false,
      amount_captured: 0,
      amount_refunded: 1000,
      refunded: true,
    })))

    expect(response.status).toBe(202)
    expectSyncedStatus('unknown', 'charge.refunded')
  })

  it('skips a duplicate delivery of an accepted charge event', async () => {
    ;(claimWebhookProcessing as jest.Mock).mockResolvedValue(false)

    const response = await post(signedRequest('charge.refunded', charge({ amount_refunded: 1000, refunded: true })))

    expect(response.status).toBe(202)
    expect(paymentGatewayService.syncTransactionStatus).not.toHaveBeenCalled()
  })

  it('enqueues the located transaction on the stripe queue under the async strategy', async () => {
    process.env.QUEUE_STRATEGY = 'async'

    const response = await post(signedRequest('charge.refunded', charge({ amount_refunded: 400 })))

    expect(response.status).toBe(202)
    expect(getPaymentGatewayQueue).toHaveBeenCalledWith('stripe-webhook')
    expect(mockEnqueue).toHaveBeenCalledTimes(1)
    expect(mockEnqueue).toHaveBeenCalledWith(expect.objectContaining({
      providerKey: 'stripe',
      transactionId: 'txn_a',
      scope: TENANT_A,
      event: expect.objectContaining({ eventType: 'charge.refunded', apiVersion: '2025-02-24.acacia' }),
    }))
    expect(paymentGatewayService.syncTransactionStatus).not.toHaveBeenCalled()
  })

  it('guard: rejects a charge event signed with the wrong secret', async () => {
    const response = await post(signedRequest('charge.refunded', charge({ amount_refunded: 1000, refunded: true }), 'whsec_forged'))

    expect(response.status).toBe(401)
    expect(paymentGatewayService.syncTransactionStatus).not.toHaveBeenCalled()
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('guard: rejects a charge event that references another tenant\'s PaymentIntent', async () => {
    const response = await post(signedRequest(
      'charge.refunded',
      charge({ payment_intent: 'pi_tenant_b', amount_refunded: 1000, refunded: true }),
      SECRET_A,
    ))

    expect(response.status).toBe(401)
    expect(credentialsService.resolve).toHaveBeenCalledTimes(1)
    expect(credentialsService.resolve).toHaveBeenCalledWith('gateway_stripe', TENANT_B)
    expect(paymentGatewayService.syncTransactionStatus).not.toHaveBeenCalled()
  })

  it('guard: rejects a charge event for a PaymentIntent that has no transaction', async () => {
    const response = await post(signedRequest('charge.refunded', charge({ payment_intent: 'pi_unknown', amount_refunded: 1000, refunded: true })))

    expect(response.status).toBe(401)
    expect(credentialsService.resolve).not.toHaveBeenCalled()
    expect(paymentGatewayService.syncTransactionStatus).not.toHaveBeenCalled()
  })
})
