/** @jest-environment node */

/**
 * #7174 review (major): the fail-closed consumer must be exercised through a real
 * producer, not only by calling the handler with hand-built trusted context.
 * `emitOrderLifecycleEventsForTransition` (sales/commands/documents.ts) is the shipped
 * producer behind `sales.order.confirmed`/`sales.order.cancelled`; when it emitted the
 * scope only in the payload, the event bus handed this subscriber `tenantId: null` and
 * every subscribed webhook silently stopped firing.
 */

import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/di/container'),
  createRequestContainer: jest.fn(),
}))
jest.mock('@open-mercato/checkout/modules/checkout/lib/rateLimiter', () => ({
  enforceCheckoutRateLimit: jest.fn(async () => null),
}))

jest.mock('@open-mercato/shared/lib/logger', () => {
  const mocked = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(),
  }
  mocked.child.mockImplementation(() => mocked)
  return { createLogger: jest.fn(() => mocked) }
})

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
  findOneWithDecryption: jest.fn(),
}))

jest.mock('../../lib/delivery', () => ({
  createWebhookDelivery: jest.fn(),
}))
jest.mock('../../lib/queue', () => ({
  enqueueWebhookDelivery: jest.fn(),
}))
jest.mock('../../lib/integration-state', () => ({
  isWebhookIntegrationEnabled: jest.fn(),
}))

import handler from '../outbound-dispatch'
import { POST as submitPayLink } from '@open-mercato/checkout/modules/checkout/api/pay/[slug]/submit/route'
import '@open-mercato/checkout/modules/checkout/commands/transactions'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { emitOrderLifecycleEventsForTransition } from '@open-mercato/core/modules/sales/commands/documents'
import { setGlobalEventBus } from '@open-mercato/shared/modules/events'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { createWebhookDelivery } from '../../lib/delivery'
import { enqueueWebhookDelivery } from '../../lib/queue'
import { isWebhookIntegrationEnabled } from '../../lib/integration-state'

const dispatchLoggerWarn = createLogger('webhooks').warn as jest.Mock

type EmitOptionsLike = { tenantId?: string | null; organizationId?: string | null }

/**
 * Mirrors the event bus contract this subscriber depends on
 * (packages/events/src/bus.ts `deliver`): the handler's `tenantId`/`organizationId` come
 * from the emit options and are null when the producer passes none.
 */
function installCapturingBus(rootEm: EntityManager) {
  const emit = jest.fn(
    async (
      event: string,
      payload: Record<string, unknown>,
      options?: EmitOptionsLike,
    ): Promise<void> => {
      await handler(payload, {
        eventName: event,
        tenantId: options?.tenantId ?? null,
        organizationId: options?.organizationId ?? null,
        resolve: <T,>(name: string): T => {
          if (name === 'em') return rootEm as T
          throw new Error(`Unexpected dependency: ${name}`)
        },
      })
    },
  )
  setGlobalEventBus({ emit } as never)
  return emit
}

function createDispatchEntityManagers() {
  const webhookEm = {
    flush: jest.fn(async () => undefined),
  } as unknown as EntityManager
  const handlerEm = {
    fork: jest.fn(() => webhookEm),
    flush: jest.fn(async () => undefined),
  } as unknown as EntityManager
  const rootEm = {
    fork: jest.fn(() => handlerEm),
    flush: jest.fn(async () => undefined),
  } as unknown as EntityManager
  return { rootEm, handlerEm, webhookEm }
}

const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve))

describe('outbound dispatch through a real producer', () => {
  afterEach(() => {
    setGlobalEventBus({ emit: jest.fn() } as never)
    jest.clearAllMocks()
  })

  it('delivers webhooks for sales.order.confirmed emitted by the sales producer', async () => {
    const { rootEm, handlerEm, webhookEm } = createDispatchEntityManagers()
    ;(findWithDecryption as jest.Mock).mockResolvedValue([
      {
        id: 'webhook-1',
        organizationId: 'org-1',
        tenantId: 'tenant-1',
        subscribedEvents: ['sales.order.confirmed'],
      },
    ])
    ;(isWebhookIntegrationEnabled as jest.Mock).mockResolvedValue(true)
    ;(createWebhookDelivery as jest.Mock).mockResolvedValue({
      id: 'delivery-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    ;(enqueueWebhookDelivery as jest.Mock).mockResolvedValue('job-1')

    const emit = installCapturingBus(rootEm)

    emitOrderLifecycleEventsForTransition({
      order: {
        id: 'order-1',
        orderNumber: 'SO-1',
        status: 'confirmed',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      } as never,
      previousStatus: 'draft',
    })
    await flushMicrotasks()

    expect(emit).toHaveBeenCalledWith(
      'sales.order.confirmed',
      expect.objectContaining({ orderId: 'order-1', tenantId: 'tenant-1' }),
      { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
    expect(findWithDecryption).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ tenantId: 'tenant-1', organizationId: 'org-1' }),
      expect.anything(),
      { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
    expect(createWebhookDelivery).toHaveBeenCalledWith(expect.objectContaining({
      em: webhookEm,
      eventId: 'sales.order.confirmed',
    }))
    expect(handlerEm.fork).toHaveBeenCalled()
  })

  it('stays fail-closed when a producer supplies the scope only in the payload', async () => {
    const { rootEm } = createDispatchEntityManagers()
    const emit = installCapturingBus(rootEm)

    await emit(
      'sales.order.confirmed',
      {
        orderId: 'order-1',
        tenantId: 'attacker-tenant',
        organizationId: 'attacker-org',
      },
      undefined,
    )

    expect(findWithDecryption).not.toHaveBeenCalled()
    expect(createWebhookDelivery).not.toHaveBeenCalled()
    expect(dispatchLoggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('no trusted scope'),
      expect.objectContaining({ eventId: 'sales.order.confirmed' }),
    )
  })

  it('dispatches both Pay Links events only to subscriptions in the persisted checkout scope', async () => {
    const scope = {
      tenantId: '11111111-1111-4111-8111-111111111111',
      organizationId: '22222222-2222-4222-8222-222222222222',
    }
    const link = {
      ...scope,
      id: '33333333-3333-4333-8333-333333333333',
      slug: 'donate',
      status: 'active',
      pricingMode: 'custom_amount',
      customAmountMin: '1.00',
      customAmountMax: '100.00',
      customAmountCurrencyCode: 'USD',
      gatewayProviderKey: 'mock',
      collectCustomerDetails: false,
    }
    const transactionId = '44444444-4444-4444-8444-444444444444'
    const transaction = {
      ...scope,
      id: transactionId,
      linkId: link.id,
      amount: '25.00',
      currencyCode: 'USD',
      status: 'processing',
    }
    const gatewayTransactionId = '55555555-5555-4555-8555-555555555555'
    const subscribedEvents = ['checkout.transaction.customerDataCaptured', 'checkout.transaction.sessionStarted']
    const subscriptions = [
      { ...scope, id: 'matching', subscribedEvents },
      { ...scope, id: 'other-organization', organizationId: 'other-org', subscribedEvents },
      { ...scope, id: 'other-tenant', tenantId: 'other-tenant', subscribedEvents },
    ]
    const { rootEm } = createDispatchEntityManagers()
    installCapturingBus(rootEm)
    ;(findWithDecryption as jest.Mock).mockImplementation(async (_em, _entity, where: EmitOptionsLike) =>
      subscriptions.filter((subscription) =>
        (!where.tenantId || subscription.tenantId === where.tenantId)
        && (!where.organizationId || subscription.organizationId === where.organizationId)),
    )
    ;(findOneWithDecryption as jest.Mock)
      .mockResolvedValueOnce(link)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(transaction)
      .mockResolvedValueOnce({ ...transaction, gatewayTransactionId })
    ;(isWebhookIntegrationEnabled as jest.Mock).mockResolvedValue(true)
    ;(createWebhookDelivery as jest.Mock).mockResolvedValue({ ...scope, id: 'delivery' })

    const tx = {
      findOne: jest.fn(async () => link),
      create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data, id: transactionId })),
      persist: jest.fn(),
      flush: jest.fn(),
      execute: jest.fn(async () => [{ active_reservation_count: 2 }]),
    }
    const services = {
      em: {
        transactional: (work: (em: typeof tx) => Promise<unknown>) => work(tx),
        findOne: jest.fn(async () => null),
      },
      paymentGatewayService: {
        createPaymentSession: async () => ({
          transaction: { id: gatewayTransactionId, unifiedStatus: 'pending' },
        }),
      },
      commandBus: {
        execute: async (id: string, { input, ctx }: { input: Record<string, unknown>; ctx: CommandRuntimeContext }) => {
          if (id === 'checkout.transaction.updateStatus') return { result: { ok: true } }
          const command = commandRegistry.get(id)
          if (!command) throw new Error(`Unknown command ${id}`)
          return { result: await command.execute(input, ctx) }
        },
      },
    }
    ;(createRequestContainer as jest.Mock).mockResolvedValue({ resolve: (name: keyof typeof services) => services[name] })

    const previousOrigin = process.env.APP_URL
    process.env.APP_URL = 'https://merchant.example'
    try {
      const response = await submitPayLink(new Request('https://merchant.example/api/checkout/pay/donate/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'Idempotency-Key': 'checkout-webhook-scope-9524' },
        body: JSON.stringify({ amount: 25, customerData: {}, acceptedLegalConsents: {} }),
      }), { params: { slug: link.slug } })
      expect(response.status).toBe(201)
      expect(tx.findOne).toHaveBeenCalledWith(
        expect.anything(), expect.objectContaining({ id: link.id, ...scope }),
      )
      const delivered = jest.mocked(createWebhookDelivery).mock.calls.map(([delivery]) => ({
        event: delivery.eventId,
        subscription: delivery.webhook.id,
        transactionId: delivery.payload.transactionId,
      }))
      expect(delivered).toEqual(subscribedEvents.map((event) => ({ event, subscription: 'matching', transactionId })))
      expect(enqueueWebhookDelivery).toHaveBeenCalledTimes(2)
    } finally {
      if (previousOrigin === undefined) delete process.env.APP_URL
      else process.env.APP_URL = previousOrigin
    }
  })
})
