import type { EntityManager } from '@mikro-orm/postgresql'
import { createWebhookDelivery } from '../delivery'
import type { WebhookEntity } from '../../data/entities'
import { clearWebhookEndpointAdapters, getWebhookEndpointAdapter, listWebhookEndpointAdapters, registerWebhookEndpointAdapter } from '../adapter-registry'

jest.mock('../../events', () => ({
  emitWebhooksEvent: jest.fn(async () => undefined),
}))

describe('webhooks delivery helpers', () => {
  afterEach(() => {
    clearWebhookEndpointAdapters()
    jest.clearAllMocks()
  })

  it('creates a delivery record and emits an enqueued event', async () => {
    const em = {
      create: jest.fn((_entity, data) => ({ id: 'delivery-1', ...data })),
      flush: jest.fn(async () => undefined),
    } as unknown as EntityManager

    const webhook = {
      id: 'webhook-1',
      url: 'https://example.test/hook',
      maxRetries: 5,
      organizationId: 'org-1',
      tenantId: 'tenant-1',
    } as WebhookEntity

    const delivery = await createWebhookDelivery({
      em,
      webhook,
      eventId: 'customers.person.created',
      payload: { id: 'person-1' },
    })

    expect(delivery).toEqual(expect.objectContaining({
      id: 'delivery-1',
      webhookId: 'webhook-1',
      eventType: 'customers.person.created',
      status: 'pending',
      maxAttempts: 5,
      targetUrl: 'https://example.test/hook',
    }))
    expect((delivery.payload as { type: string; data: Record<string, unknown> }).type).toBe('customers.person.created')
    expect((delivery.payload as { type: string; data: Record<string, unknown> }).data).toEqual({ id: 'person-1' })
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it('registers webhook endpoint adapters in the process registry', () => {
    const unregister = registerWebhookEndpointAdapter({
      providerKey: 'custom-provider',
      subscribedEvents: ['*'],
      verifyWebhook: async () => ({ eventType: 'custom.event', payload: {} }),
      processInbound: async () => undefined,
    })

    expect(getWebhookEndpointAdapter('custom-provider')).toEqual(expect.objectContaining({
      providerKey: 'custom-provider',
    }))
    expect(listWebhookEndpointAdapters()).toHaveLength(1)

    unregister()

    expect(getWebhookEndpointAdapter('custom-provider')).toBeUndefined()
    expect(listWebhookEndpointAdapters()).toHaveLength(0)
  })
})
