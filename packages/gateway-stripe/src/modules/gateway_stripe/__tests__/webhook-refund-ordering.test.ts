/** @jest-environment node */
import Stripe from 'stripe'
import { UniqueConstraintViolationException } from '@mikro-orm/core'
import { POST } from '@open-mercato/core/modules/payment_gateways/api/webhook/[provider]/route'
import { createPaymentGatewayService } from '@open-mercato/core/modules/payment_gateways/lib/gateway-service'
import type { PaymentGatewayWebhookJobPayload } from '@open-mercato/core/modules/payment_gateways/lib/webhook-processor'
import { setGlobalEventBus } from '@open-mercato/shared/modules/events'
import {
  clearGatewayAdapters,
  clearWebhookHandlers,
  registerGatewayAdapter,
  registerWebhookHandler,
} from '@open-mercato/shared/modules/payment_gateways/types'
import { stripeAdapterV20250224Acacia } from '../lib/adapters/v2025-02-24.acacia'
import { readStripeSessionIdHint, verifyStripeWebhook } from '../lib/webhook-handler'
import handleStripeWebhookJob from '../workers/webhook-processor'

const mockResolve = jest.fn()
const mockEnqueue = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({ resolve: mockResolve })),
}))

jest.mock('@open-mercato/core/modules/payment_gateways/lib/queue', () => ({
  getPaymentGatewayQueue: jest.fn(() => ({ enqueue: mockEnqueue })),
}))

type Row = Record<string, unknown>

const store = {
  transactions: [] as Row[],
  claims: [] as Row[],
}

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (key === 'deletedAt' && expected === null) return row.deletedAt == null
    return row[key] === expected
  })
}

function rowsFor(entity: unknown): Row[] {
  const name = (entity as { name?: string }).name
  if (name === 'GatewayTransaction') return store.transactions
  if (name === 'WebhookProcessedEvent') return store.claims
  throw new Error(`[internal] unexpected entity ${String(name)}`)
}

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async (_em: unknown, entity: unknown, where: Row) =>
    rowsFor(entity).filter((row) => matches(row, where))),
  findOneWithDecryption: jest.fn(async (_em: unknown, entity: unknown, where: Row) =>
    rowsFor(entity).find((row) => matches(row, where)) ?? null),
}))

function claimKey(row: Row): string {
  return `${row.providerKey}|${row.idempotencyKey}|${row.organizationId}|${row.tenantId}`
}

const em: Record<string, unknown> = {
  create: jest.fn((_entity: unknown, data: Row) => ({ ...data })),
  persist: jest.fn((record: Row) => ({
    flush: async () => {
      if (store.claims.some((claim) => claimKey(claim) === claimKey(record))) {
        throw new UniqueConstraintViolationException(new Error('duplicate key value violates unique constraint'))
      }
      store.claims.push(record)
    },
  })),
  remove: jest.fn((record: Row) => ({
    flush: async () => {
      store.claims = store.claims.filter((claim) => claim !== record)
    },
  })),
  flush: jest.fn(async () => {}),
  fork: jest.fn(() => em),
  transactional: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(em)),
}

const SECRET = 'whsec_reordering'
const SCOPE = { organizationId: 'org_reorder', tenantId: 'tenant_reorder' }
const credentialsService = { resolve: jest.fn(async () => ({ secretKey: 'sk_test_local', webhookSecret: SECRET })) }
const integrationLogService = {
  write: jest.fn(async () => {}),
  scoped: jest.fn(() => ({ info: jest.fn(async () => {}) })),
}
const realPaymentGatewayService = createPaymentGatewayService({
  em: em as never,
  integrationCredentialsService: credentialsService as never,
})
const failNextSync = { count: 0 }
const paymentGatewayService: typeof realPaymentGatewayService = {
  ...realPaymentGatewayService,
  async syncTransactionStatus(...args) {
    if (failNextSync.count > 0) {
      failNextSync.count -= 1
      throw new Error('database unavailable')
    }
    return realPaymentGatewayService.syncTransactionStatus(...args)
  },
}
const emitted: Array<{ eventId: string; previousStatus: unknown }> = []

let eventSequence = 0

function signedRequest(type: string, object: Row, apiVersion: string): Request {
  eventSequence += 1
  const body = JSON.stringify({
    id: `evt_${eventSequence}`,
    object: 'event',
    api_version: apiVersion,
    type,
    created: 1790000000 + eventSequence,
    data: { object },
  })
  const signature = new Stripe('sk_test_local').webhooks.generateTestHeaderString({ payload: body, secret: SECRET })
  return new Request('http://localhost/api/payment_gateways/webhook/stripe', {
    method: 'POST',
    headers: { 'stripe-signature': signature },
    body,
  })
}

type Delivery = {
  request: Request
  replay: () => Request
}

function stripeEvent(type: string, object: Row, apiVersion = '2025-02-24.acacia'): Delivery {
  const request = signedRequest(type, object, apiVersion)
  const cloneSource = request.clone()
  return { request, replay: () => cloneSource.clone() }
}

function seedTransaction(status: string, overrides: Row = {}): Row {
  const transaction: Row = {
    id: `txn_${store.transactions.length + 1}`,
    paymentId: 'pay_reorder',
    providerKey: 'stripe',
    providerSessionId: 'pi_reorder',
    unifiedStatus: status,
    amount: '10.0000',
    capturedAmount: status === 'captured' ? '10.0000' : '0',
    gatewayMetadata: {},
    webhookLog: [],
    deletedAt: null,
    ...SCOPE,
    ...overrides,
  }
  store.transactions.push(transaction)
  return transaction
}

function paymentIntent(status: string): Row {
  return { id: 'pi_reorder', object: 'payment_intent', status, amount: 1000, amount_received: status === 'succeeded' ? 1000 : 0 }
}

function charge(overrides: Row): Row {
  return {
    id: 'ch_reorder',
    object: 'charge',
    payment_intent: 'pi_reorder',
    amount: 1000,
    amount_captured: 1000,
    amount_refunded: 0,
    captured: true,
    refunded: false,
    status: 'succeeded',
    ...overrides,
  }
}

const strategies = [
  ['inline core processor', 'local'],
  ['async stripe worker', 'async'],
] as const

describe.each(strategies)('Stripe refund webhooks through the %s and the real payment service', (_label, queueStrategy) => {
  const originalQueueStrategy = process.env.QUEUE_STRATEGY

  async function deliver(request: Request): Promise<number> {
    mockEnqueue.mockClear()
    const response = await POST(request, { params: { provider: 'stripe' } })
    if (queueStrategy === 'async' && response.status === 202) {
      expect(mockEnqueue).toHaveBeenCalledTimes(1)
      const job = mockEnqueue.mock.calls[0][0] as PaymentGatewayWebhookJobPayload
      await handleStripeWebhookJob(
        { id: `job_${eventSequence}`, payload: JSON.parse(JSON.stringify(job)), createdAt: new Date().toISOString() } as never,
        { resolve: mockResolve } as never,
      )
    }
    return response.status
  }

  beforeEach(() => {
    store.transactions = []
    store.claims = []
    emitted.length = 0
    failNextSync.count = 0
    if (queueStrategy === 'async') process.env.QUEUE_STRATEGY = 'async'
    else delete process.env.QUEUE_STRATEGY
    setGlobalEventBus({
      emit: async (eventId: string, payload: unknown) => {
        emitted.push({ eventId, previousStatus: (payload as Row).previousStatus })
      },
    } as never)
    registerGatewayAdapter(stripeAdapterV20250224Acacia, { version: '2025-02-24.acacia' })
    registerWebhookHandler('stripe', verifyStripeWebhook, {
      queue: 'stripe-webhook',
      readSessionIdHint: readStripeSessionIdHint,
    })
    mockResolve.mockImplementation((token: string) => {
      if (token === 'em') return em
      if (token === 'paymentGatewayService') return paymentGatewayService
      if (token === 'integrationCredentialsService') return credentialsService
      if (token === 'integrationLogService') return integrationLogService
      throw new Error(`[internal] unexpected token ${token}`)
    })
  })

  afterEach(() => {
    clearGatewayAdapters()
    clearWebhookHandlers()
    if (originalQueueStrategy === undefined) delete process.env.QUEUE_STRATEGY
    else process.env.QUEUE_STRATEGY = originalQueueStrategy
  })

  it('moves a captured payment through a partial, a second partial and a full refund', async () => {
    const transaction = seedTransaction('captured')

    expect(await deliver(stripeEvent('charge.refunded', charge({ amount_refunded: 400 })).request)).toBe(202)
    expect(transaction.unifiedStatus).toBe('partially_refunded')
    expect(await deliver(stripeEvent('charge.refunded', charge({ amount_refunded: 700 })).request)).toBe(202)
    expect(transaction.unifiedStatus).toBe('partially_refunded')
    expect(await deliver(stripeEvent('charge.refunded', charge({ amount_refunded: 1000, refunded: true })).request)).toBe(202)

    expect(transaction.unifiedStatus).toBe('refunded')
    expect(emitted).toEqual([{ eventId: 'payment_gateways.payment.refunded', previousStatus: 'partially_refunded' }])
  })

  it('keeps the full refund when an earlier partial refund event arrives after it', async () => {
    const transaction = seedTransaction('captured')

    await deliver(stripeEvent('charge.refunded', charge({ amount_refunded: 1000, refunded: true })).request)
    await deliver(stripeEvent('charge.refunded', charge({ amount_refunded: 400 })).request)

    expect(transaction.unifiedStatus).toBe('refunded')
    expect(emitted.map((entry) => entry.eventId)).toEqual(['payment_gateways.payment.refunded'])
  })

  it('applies a duplicate delivery of the same Stripe event once', async () => {
    const transaction = seedTransaction('captured')
    const partialRefund = stripeEvent('charge.refunded', charge({ amount_refunded: 400 }))

    expect(await deliver(partialRefund.request)).toBe(202)
    const webhookLogLength = (transaction.webhookLog as unknown[]).length
    expect(await deliver(partialRefund.replay())).toBe(202)

    expect(transaction.unifiedStatus).toBe('partially_refunded')
    expect((transaction.webhookLog as unknown[]).length).toBe(webhookLogLength)
    expect(store.claims).toHaveLength(1)
  })

  it.each(['pending', 'authorized'])(
    'records a refund that arrives before the capture of a %s payment, and ignores the late capture',
    async (initialStatus) => {
      const transaction = seedTransaction(initialStatus)

      expect(await deliver(stripeEvent('charge.refunded', charge({ amount_refunded: 400 })).request)).toBe(202)
      expect(transaction.unifiedStatus).toBe('partially_refunded')
      expect(transaction.capturedAmount).toBe('10.0000')

      expect(await deliver(stripeEvent('payment_intent.succeeded', paymentIntent('succeeded')).request)).toBe(202)
      expect(transaction.unifiedStatus).toBe('partially_refunded')

      expect(await deliver(stripeEvent('charge.refunded', charge({ amount_refunded: 1000, refunded: true })).request)).toBe(202)
      expect(transaction.unifiedStatus).toBe('refunded')
      expect(emitted).toEqual([
        { eventId: 'payment_gateways.payment.captured', previousStatus: initialStatus },
        { eventId: 'payment_gateways.payment.refunded', previousStatus: 'partially_refunded' },
      ])
    },
  )

  it('records a full refund that overtakes the capture of a pending payment', async () => {
    const transaction = seedTransaction('pending')

    await deliver(stripeEvent('charge.refunded', charge({ amount_refunded: 1000, refunded: true })).request)
    await deliver(stripeEvent('payment_intent.succeeded', paymentIntent('succeeded')).request)

    expect(transaction.unifiedStatus).toBe('refunded')
    expect(emitted).toEqual([
      { eventId: 'payment_gateways.payment.captured', previousStatus: 'pending' },
      { eventId: 'payment_gateways.payment.refunded', previousStatus: 'captured' },
    ])
  })

  it('does not invent a capture for a released authorization', async () => {
    const transaction = seedTransaction('authorized')

    await deliver(stripeEvent('charge.refunded', charge({
      captured: false, amount_captured: 0, amount_refunded: 1000, refunded: true,
    })).request)

    expect(transaction.unifiedStatus).toBe('authorized')
    expect(emitted).toEqual([])
  })

  it('reads pre-Basil partial-capture payloads: the uncaptured remainder is not a refund', async () => {
    const transaction = seedTransaction('partially_captured', { capturedAmount: '6.0000' })
    const legacy = '2025-02-24.acacia'

    await deliver(stripeEvent('charge.refunded', charge({ amount_captured: 600, amount_refunded: 400 }), legacy).request)
    expect(transaction.unifiedStatus).toBe('partially_captured')
    await deliver(stripeEvent('charge.refunded', charge({ amount_captured: 600, amount_refunded: 700 }), legacy).request)
    expect(transaction.unifiedStatus).toBe('partially_refunded')
    await deliver(stripeEvent('charge.refunded', charge({ amount_captured: 600, amount_refunded: 1000, refunded: true }), legacy).request)
    expect(transaction.unifiedStatus).toBe('refunded')
    expect(transaction.capturedAmount).toBe('6.0000')
  })

  it('reads Basil partial-capture payloads: every refunded unit is a refund of captured funds', async () => {
    const transaction = seedTransaction('partially_captured', { capturedAmount: '6.0000' })
    const basil = '2025-03-31.basil'

    await deliver(stripeEvent('charge.refunded', charge({ amount_captured: 600, amount_refunded: 300 }), basil).request)
    expect(transaction.unifiedStatus).toBe('partially_refunded')
    await deliver(stripeEvent('charge.refunded', charge({ amount_captured: 600, amount_refunded: 400 }), basil).request)
    expect(transaction.unifiedStatus).toBe('partially_refunded')
    await deliver(stripeEvent('charge.refunded', charge({ amount_captured: 600, amount_refunded: 600, refunded: true }), basil).request)
    expect(transaction.unifiedStatus).toBe('refunded')
    expect(transaction.capturedAmount).toBe('6.0000')
  })

  it('releases the claim when processing fails so the redelivery is applied', async () => {
    const transaction = seedTransaction('captured')
    const fullRefund = stripeEvent('charge.refunded', charge({ amount_refunded: 1000, refunded: true }))
    failNextSync.count = 1

    if (queueStrategy === 'async') {
      await expect(deliver(fullRefund.request)).rejects.toThrow('database unavailable')
    } else {
      expect(await deliver(fullRefund.request)).toBe(401)
    }
    expect(store.claims).toHaveLength(0)

    expect(await deliver(fullRefund.replay())).toBe(202)
    expect(transaction.unifiedStatus).toBe('refunded')
    expect(store.claims).toHaveLength(1)
  })

  it.each([
    ['charge.refund.updated', { id: 're_1', object: 'refund', payment_intent: 'pi_reorder', charge: 'ch_reorder', amount: 400, status: 'succeeded' }],
    ['charge.dispute.created', { id: 'dp_1', object: 'dispute', payment_intent: 'pi_reorder', charge: 'ch_reorder', amount: 1000, status: 'needs_response' }],
    ['charge.dispute.closed', { id: 'dp_1', object: 'dispute', payment_intent: 'pi_reorder', charge: 'ch_reorder', amount: 1000, status: 'lost' }],
  ])('accepts %s without changing the status', async (eventType, object) => {
    const transaction = seedTransaction('captured')

    expect(await deliver(stripeEvent(eventType, object).request)).toBe(202)

    expect(transaction.unifiedStatus).toBe('captured')
    expect(emitted).toEqual([])
  })
})
