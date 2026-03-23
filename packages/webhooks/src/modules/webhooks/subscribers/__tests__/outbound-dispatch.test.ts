import type { EntityManager } from '@mikro-orm/postgresql'
import handler from '../outbound-dispatch'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
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

import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createWebhookDelivery } from '../../lib/delivery'
import { enqueueWebhookDelivery } from '../../lib/queue'
import { isWebhookIntegrationEnabled } from '../../lib/integration-state'

describe('webhooks outbound dispatch subscriber', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('uses the event bus eventName for wildcard subscribers and schedules matching webhook deliveries', async () => {
    const em = {
      fork: jest.fn(function fork() {
        return em
      }),
      findOne: jest.fn(),
      flush: jest.fn(async () => undefined),
    } as unknown as EntityManager

    ;(findWithDecryption as jest.Mock).mockResolvedValue([
      {
        id: 'webhook-1',
        organizationId: 'org-1',
        tenantId: 'tenant-1',
        subscribedEvents: ['catalog.product.deleted'],
      },
    ])
    ;(isWebhookIntegrationEnabled as jest.Mock).mockResolvedValue(true)
    ;(createWebhookDelivery as jest.Mock).mockResolvedValue({
      id: 'delivery-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    ;(enqueueWebhookDelivery as jest.Mock).mockResolvedValue('job-1')

    await handler(
      {
        id: 'product-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      },
      {
        eventName: 'catalog.product.deleted',
        resolve: <T,>(name: string): T => {
          if (name === 'em') return em as T
          throw new Error(`Unexpected dependency: ${name}`)
        },
      },
    )

    expect(createWebhookDelivery).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'catalog.product.deleted',
      payload: expect.objectContaining({
        id: 'product-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      }),
    }))
    expect(enqueueWebhookDelivery).toHaveBeenCalledWith({
      deliveryId: 'delivery-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
  })

  it('does not crash when the event bus provides only ctx.resolve during reindex flows', async () => {
    const em = {
      fork: jest.fn(function fork() {
        return em
      }),
      findOne: jest.fn(),
      flush: jest.fn(async () => undefined),
    } as unknown as EntityManager

    ;(findWithDecryption as jest.Mock).mockResolvedValue([])

    await expect(handler(
      {
        id: 'record-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      },
      {
        eventName: 'query_index.vectorize_one',
        resolve: <T,>(name: string): T => {
          if (name === 'em') return em as T
          throw new Error(`Unexpected dependency: ${name}`)
        },
      },
    )).resolves.toBeUndefined()

    expect(findWithDecryption).toHaveBeenCalled()
  })
})
