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
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/auth/server'),
  getAuthFromRequest: jest.fn(),
}))
jest.mock('@open-mercato/core/modules/customer_accounts/lib/customerAuth', () => ({
  getCustomerAuthFromRequest: jest.fn(),
  requireCustomerFeature: jest.fn(),
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
jest.mock('@open-mercato/core/modules/notifications/lib/notificationRecipients', () => ({
  getScopedNotificationRecipientUserIds: jest.fn(),
}))
jest.mock('../../lib/integration-state', () => ({
  isWebhookIntegrationEnabled: jest.fn(),
}))

import handler, { metadata as dispatchMetadata } from '../outbound-dispatch'
import { createEventBus, registerGlobalEventTap } from '@open-mercato/events/bus'
import { createNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import { getScopedNotificationRecipientUserIds } from '@open-mercato/core/modules/notifications/lib/notificationRecipients'
import { NOTIFICATION_SSE_EVENTS } from '@open-mercato/core/modules/notifications/lib/events'
import type { Notification } from '@open-mercato/core/modules/notifications/data/entities'
import { DELETE as deleteAdminUser } from '@open-mercato/core/modules/customer_accounts/api/admin/users/[id]'
import { DELETE as deletePortalUser } from '@open-mercato/core/modules/customer_accounts/api/portal/users/[id]'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { getCustomerAuthFromRequest } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import { organizationEventScope } from '@open-mercato/shared/lib/events/organization-scope'
import { POST as submitPayLink } from '@open-mercato/checkout/modules/checkout/api/pay/[slug]/submit/route'
import '@open-mercato/checkout/modules/checkout/commands/transactions'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { emitOrderLifecycleEventsForTransition } from '@open-mercato/core/modules/sales/commands/documents'
import { setGlobalEventBus, type EventModuleConfig, type EventPayload, type EmitOptions } from '@open-mercato/shared/modules/events'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { createWebhookDelivery } from '../../lib/delivery'
import { enqueueWebhookDelivery } from '../../lib/queue'
import { isWebhookIntegrationEnabled } from '../../lib/integration-state'

import AiAssistantEvents from '@open-mercato/ai-assistant/modules/ai_assistant/events'
import CheckoutEvents from '@open-mercato/checkout/modules/checkout/events'
import CartEvents from '@open-mercato/core/modules/cart/events'
import CommunicationChannelsEvents from '@open-mercato/core/modules/communication_channels/events'
import CustomerAccountsEvents from '@open-mercato/core/modules/customer_accounts/events'
import CustomersEvents from '@open-mercato/core/modules/customers/events'
import DataSyncEvents from '@open-mercato/core/modules/data_sync/events'
import DevicesEvents from '@open-mercato/core/modules/devices/events'
import InboxOpsEvents from '@open-mercato/core/modules/inbox_ops/events'
import IntegrationsEvents from '@open-mercato/core/modules/integrations/events'
import NotificationsEvents from '@open-mercato/core/modules/notifications/events'
import PaymentGatewaysEvents from '@open-mercato/core/modules/payment_gateways/events'
import PhoneCallsEvents from '@open-mercato/core/modules/phone_calls/events'
import PromotionsEvents from '@open-mercato/core/modules/promotions/events'
import PushNotificationsEvents from '@open-mercato/core/modules/push_notifications/events'
import StaffEvents from '@open-mercato/core/modules/staff/events'
import TranslationsEvents from '@open-mercato/core/modules/translations/events'
import WmsEvents from '@open-mercato/core/modules/wms/events'
import WorkflowsEvents from '@open-mercato/core/modules/workflows/events'
import AgentOrchestratorEvents from '@open-mercato/enterprise/modules/agent_orchestrator/events'
import RecordLocksEvents from '@open-mercato/enterprise/modules/record_locks/events'
import SecurityEvents from '@open-mercato/enterprise/modules/security/events'
import SsoEvents from '@open-mercato/enterprise/modules/sso/events'
import SchedulerEvents from '@open-mercato/scheduler/modules/scheduler/events'
import EudrEvents from '@open-mercato/core/modules/eudr/events'
import BusinessRulesEvents from '@open-mercato/core/modules/business_rules/events'
import ProgressEvents from '@open-mercato/core/modules/progress/events'
import ExampleCustomersSyncEvents from '@/modules/example_customers_sync/events'
import ExampleEvents from '@/modules/example/events'
import SearchEvents from '@open-mercato/search/modules/search/events'

function eventCase<Id extends string>(events: EventModuleConfig<Id>, id: NoInfer<Id>) {
  return [id, (payload: EventPayload, options: EmitOptions) => events.emit(id, payload, options)] as const
}

const eventFamilies = [
  eventCase(AiAssistantEvents, 'ai_assistant.moderation_flag.created'),
  eventCase(CheckoutEvents, 'checkout.link.created'),
  eventCase(CartEvents, 'cart.lock.acquired'),
  eventCase(CommunicationChannelsEvents, 'communication_channels.conversation.created'),
  eventCase(CustomerAccountsEvents, 'customer_accounts.user.deleted'),
  eventCase(CustomersEvents, 'customers.email.conversation_visibility_changed'),
  eventCase(DataSyncEvents, 'data_sync.run.completed'),
  eventCase(DevicesEvents, 'devices.user_device.registered'),
  eventCase(InboxOpsEvents, 'inbox_ops.action.edited'),
  eventCase(IntegrationsEvents, 'integrations.credentials.updated'),
  eventCase(NotificationsEvents, 'notifications.preference.updated'),
  eventCase(PaymentGatewaysEvents, 'payment_gateways.session.created'),
  eventCase(PhoneCallsEvents, 'phone_calls.call.ingest_failed'),
  eventCase(PromotionsEvents, 'promotions.generated_code.created'),
  eventCase(PushNotificationsEvents, 'push_notifications.delivery.sent'),
  eventCase(StaffEvents, 'staff.timesheets.time_entry.locked'),
  eventCase(TranslationsEvents, 'translations.translation.updated'),
  eventCase(WmsEvents, 'wms.inventory.reserved'),
  eventCase(WorkflowsEvents, 'workflows.task.assigned'),
  eventCase(AgentOrchestratorEvents, 'agent_orchestrator.run.created'),
  eventCase(RecordLocksEvents, 'record_locks.lock.acquired'),
  eventCase(SecurityEvents, 'security.password.changed'),
  eventCase(SsoEvents, 'sso.config.created'),
  eventCase(SchedulerEvents, 'scheduler.job.completed'),
  eventCase(EudrEvents, 'eudr.mitigation_action.completed'),
  eventCase(BusinessRulesEvents, 'business_rules.rule.execution_failed'),
  eventCase(ProgressEvents, 'progress.job.started'),
  eventCase(ExampleCustomersSyncEvents, 'example_customers_sync.mapping.updated'),
  eventCase(ExampleEvents, 'example.todo_announcement.published'),
  eventCase(SearchEvents, 'search.index_record'),
] as const

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

function setUpIsolatedSubscriptions(scope: { tenantId: string; organizationId: string }) {
  const subscriptions = [
    { ...scope, id: 'matching', subscribedEvents: ['*'] },
    { ...scope, id: 'other-org', organizationId: 'outside-org', subscribedEvents: ['*'] },
    { ...scope, id: 'other-tenant', tenantId: 'outside-tenant', subscribedEvents: ['*'] },
  ]
  const { rootEm } = createDispatchEntityManagers()
  const bus = createEventBus({
    queueStrategy: 'local',
    resolve: <T,>(key: string): T => {
      if (key === 'em') return rootEm as T
      throw new Error(`Unexpected dependency: ${key}`)
    },
  })
  bus.on(dispatchMetadata.event, (payload, ctx) => handler(payload as Record<string, unknown>, ctx), {
    persistent: dispatchMetadata.persistent,
    id: dispatchMetadata.id,
  })
  setGlobalEventBus(bus)
  ;(findWithDecryption as jest.Mock).mockImplementation(async (_em, _entity, where: EmitOptionsLike) =>
    subscriptions.filter((subscription) =>
      (!where.tenantId || where.tenantId === subscription.tenantId)
      && (!where.organizationId || where.organizationId === subscription.organizationId)),
  )
  ;(isWebhookIntegrationEnabled as jest.Mock).mockResolvedValue(true)
  ;(createWebhookDelivery as jest.Mock).mockResolvedValue({ ...scope, id: 'delivery' })
  return bus
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

  it('keeps recipient-only notifications on the browser bridge and delivers organization-scoped webhooks', async () => {
    const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }
    const recipientUserId = 'user-1'
    const bus = setUpIsolatedSubscriptions(scope)
    const tap = jest.fn()
    const unsubscribe = registerGlobalEventTap(tap)
    const transaction = {
      getKysely: jest.fn(),
      create: (_entity: unknown, data: Partial<Notification>) => ({ id: 'note-1', ...data }),
      persist: jest.fn(),
      flush: jest.fn(),
    }
    const em = {
      fork: () => ({
        transactional: (write: (tx: typeof transaction) => Promise<Notification>) => write(transaction),
      }),
    }
    const service = createNotificationService({ em: em as unknown as EntityManager, eventBus: bus })
    jest.mocked(getScopedNotificationRecipientUserIds).mockResolvedValue([recipientUserId])
    const input = { type: 'test.notification', title: 'Notice', recipientUserId }
    try {
      await service.create(input, { tenantId: scope.tenantId, organizationId: null })
      expect(tap).toHaveBeenCalledWith(NOTIFICATION_SSE_EVENTS.CREATED, expect.objectContaining({
        tenantId: scope.tenantId, organizationId: null, recipientUserId,
      }), undefined)
      expect(createWebhookDelivery).not.toHaveBeenCalled()

      await service.create(input, scope)
      expect(tap).toHaveBeenCalledWith(NOTIFICATION_SSE_EVENTS.CREATED, expect.objectContaining({
        ...scope, recipientUserId,
      }), scope)
      const deliveries = jest.mocked(createWebhookDelivery).mock.calls.map(([delivery]) => [
        delivery.eventId, delivery.webhook.id,
      ])
      expect(deliveries).toEqual([['notifications.created', 'matching'], [NOTIFICATION_SSE_EVENTS.CREATED, 'matching']])
    } finally {
      unsubscribe()
    }
  })

  it.each(eventFamilies)('keeps the %s webhook in its verified organization', async (id, emit) => {
    const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }
    setUpIsolatedSubscriptions(scope)
    const payload = { id: 'fixture', tenantId: 'outside-tenant', organizationId: 'outside-org' }
    await emit(payload, organizationEventScope(scope))
    await emit(payload, organizationEventScope({ tenantId: scope.tenantId }))
    expect(jest.mocked(createWebhookDelivery).mock.calls.map(([delivery]) => [
      delivery.eventId, delivery.webhook.id,
    ])).toEqual([[id, 'matching']])
    expect(enqueueWebhookDelivery).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['admin', deleteAdminUser],
    ['portal', deletePortalUser],
  ] as const)('delivers customer deletion from the %s route only in the deleted account scope', async (_role, remove) => {
    const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }
    const user = { ...scope, id: 'user', email: 'user@example.test' }
    const identity = { tenantId: scope.tenantId, orgId: scope.organizationId, sub: 'admin', customerEntityId: 'company' }
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue(identity)
    ;(getCustomerAuthFromRequest as jest.Mock).mockResolvedValue(identity)
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(user)
    const services = {
      em: { findOne: jest.fn(async () => user) },
      rbacService: { userHasAllFeatures: jest.fn(async () => true) },
      customerRbacService: {},
      customerUserService: { softDelete: jest.fn() },
      customerSessionService: { revokeAllUserSessions: jest.fn() },
    }
    ;(createRequestContainer as jest.Mock).mockResolvedValue({ resolve: (name: keyof typeof services) => services[name] })
    setUpIsolatedSubscriptions(scope)

    const response = await remove(new Request('https://merchant.example', { method: 'DELETE' }), { params: { id: user.id } })
    await flushMicrotasks()
    expect(response.status).toBe(200)
    expect(services.customerUserService.softDelete).toHaveBeenCalled()
    expect(jest.mocked(createWebhookDelivery).mock.calls.map(([delivery]) => [
      delivery.eventId, delivery.webhook.id, delivery.payload.id,
    ])).toEqual([['customer_accounts.user.deleted', 'matching', user.id]])
    expect(enqueueWebhookDelivery).toHaveBeenCalledTimes(1)
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
