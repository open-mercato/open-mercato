import type { EntityManager } from '@mikro-orm/postgresql'
import handler from '../outbound-dispatch'

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
jest.mock('@open-mercato/shared/modules/events', () => ({
  getDeclaredEvents: jest.fn(),
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

import { findWithDecryption, findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { getDeclaredEvents } from '@open-mercato/shared/modules/events'
import { createLogger } from '@open-mercato/shared/lib/logger'

const dispatchLoggerError = createLogger('webhooks').error as jest.Mock
import { createWebhookDelivery } from '../../lib/delivery'
import { enqueueWebhookDelivery } from '../../lib/queue'
import { isWebhookIntegrationEnabled } from '../../lib/integration-state'

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

describe('webhooks outbound dispatch subscriber', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  beforeEach(() => {
    ;(getDeclaredEvents as jest.Mock).mockReturnValue([])
  })

  it('uses the event bus eventName for wildcard subscribers and schedules matching webhook deliveries', async () => {
    const { rootEm, handlerEm, webhookEm } = createDispatchEntityManagers()

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
          if (name === 'em') return rootEm as T
          throw new Error(`Unexpected dependency: ${name}`)
        },
      },
    )

    expect(handlerEm.fork).toHaveBeenCalled()
    expect(createWebhookDelivery).toHaveBeenCalledWith(expect.objectContaining({
      em: webhookEm,
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

  it('normalizes a missing organizationId to null in the decryption scope', async () => {
    const { rootEm } = createDispatchEntityManagers()

    ;(findWithDecryption as jest.Mock).mockResolvedValue([])

    await handler(
      {
        id: 'product-1',
        tenantId: 'tenant-1',
      },
      {
        eventName: 'catalog.product.deleted',
        resolve: <T,>(name: string): T => {
          if (name === 'em') return rootEm as T
          throw new Error(`Unexpected dependency: ${name}`)
        },
      },
    )

    expect(findWithDecryption).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ tenantId: 'tenant-1' }),
      expect.anything(),
      { tenantId: 'tenant-1', organizationId: null },
    )
    const decryptionScope = (findWithDecryption as jest.Mock).mock.calls[0][4]
    expect(decryptionScope.organizationId).toBeNull()
    expect(decryptionScope.organizationId).not.toBe('')
  })

  it('checks integration state once per organization when multiple webhooks match', async () => {
    const { rootEm, handlerEm } = createDispatchEntityManagers()

    ;(findWithDecryption as jest.Mock).mockResolvedValue([
      {
        id: 'webhook-1',
        organizationId: 'org-1',
        tenantId: 'tenant-1',
        subscribedEvents: ['catalog.product.deleted'],
      },
      {
        id: 'webhook-2',
        organizationId: 'org-1',
        tenantId: 'tenant-1',
        subscribedEvents: ['catalog.product.deleted'],
      },
    ])
    ;(isWebhookIntegrationEnabled as jest.Mock).mockResolvedValue(true)
    ;(createWebhookDelivery as jest.Mock)
      .mockResolvedValueOnce({
        id: 'delivery-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      })
      .mockResolvedValueOnce({
        id: 'delivery-2',
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
          if (name === 'em') return rootEm as T
          throw new Error(`Unexpected dependency: ${name}`)
        },
      },
    )

    expect(isWebhookIntegrationEnabled).toHaveBeenCalledTimes(1)
    expect(isWebhookIntegrationEnabled).toHaveBeenCalledWith(handlerEm, {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(createWebhookDelivery).toHaveBeenCalledTimes(2)
    expect(enqueueWebhookDelivery).toHaveBeenCalledTimes(2)
  })

  it('scopes the failed-delivery lookup to webhook tenantId and organizationId when enqueue throws', async () => {
    dispatchLoggerError.mockClear()

    try {
      const { rootEm, webhookEm } = createDispatchEntityManagers()

      ;(findWithDecryption as jest.Mock).mockResolvedValue([
        {
          id: 'webhook-1',
          organizationId: 'org-1',
          tenantId: 'tenant-1',
          subscribedEvents: ['catalog.product.created'],
        },
      ])
      ;(isWebhookIntegrationEnabled as jest.Mock).mockResolvedValue(true)
      ;(createWebhookDelivery as jest.Mock).mockResolvedValue({
        id: 'delivery-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      })
      ;(enqueueWebhookDelivery as jest.Mock).mockRejectedValue(new Error('Queue unavailable'))
      ;(findOneWithDecryption as jest.Mock).mockResolvedValue({
        id: 'delivery-1',
        status: 'pending',
        nextRetryAt: null,
      })

      await handler(
        { id: 'product-2', tenantId: 'tenant-1', organizationId: 'org-1' },
        {
          eventName: 'catalog.product.created',
          resolve: <T,>(name: string): T => {
            if (name === 'em') return rootEm as T
            throw new Error(`Unexpected dependency: ${name}`)
          },
        },
      )

      expect(findOneWithDecryption).toHaveBeenCalledWith(
        webhookEm,
        expect.anything(),
        expect.objectContaining({ id: 'delivery-1', tenantId: 'tenant-1', organizationId: 'org-1' }),
        undefined,
        expect.objectContaining({ tenantId: 'tenant-1', organizationId: 'org-1' }),
      )
      expect(webhookEm.flush).toHaveBeenCalled()
      expect(dispatchLoggerError).toHaveBeenCalledWith(
        'Failed to enqueue outbound delivery',
        expect.objectContaining({
          webhookId: 'webhook-1',
          eventId: 'catalog.product.created',
          tenantId: 'tenant-1',
          organizationId: 'org-1',
          err: expect.objectContaining({ message: 'Queue unavailable' }),
        }),
      )
    } finally {
      dispatchLoggerError.mockClear()
    }
  })

  it('does not crash when the event bus provides only ctx.resolve', async () => {
    const em = {
      fork: jest.fn(function fork() {
        return em
      }),
      findOne: jest.fn(),
      flush: jest.fn(async () => undefined),
    } as unknown as EntityManager

    (findWithDecryption as jest.Mock).mockResolvedValue([])

    await expect(handler(
      {
        id: 'record-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      },
      {
        eventName: 'catalog.product.updated',
        resolve: <T,>(name: string): T => {
          if (name === 'em') return em as T
          throw new Error(`Unexpected dependency: ${name}`)
        },
      },
    )).resolves.toBeUndefined()

    expect(findWithDecryption).toHaveBeenCalled()
  })

  it('skips application lifecycle events before resolving the entity manager', async () => {
    const resolve = jest.fn()

    await expect(handler(
      {
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      },
      {
        eventName: 'application.request.auth_resolved',
        resolve,
      },
    )).resolves.toBeUndefined()

    expect(resolve).not.toHaveBeenCalled()
    expect(findWithDecryption).not.toHaveBeenCalled()
  })

  it('skips declared events that are excluded from triggers before hitting the database', async () => {
    ;(getDeclaredEvents as jest.Mock).mockReturnValue([
      {
        id: 'sales.document.calculate.before',
        label: 'Before document calculate',
        excludeFromTriggers: true,
      },
    ])

    const resolve = jest.fn()

    await expect(handler(
      {
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      },
      {
        eventName: 'sales.document.calculate.before',
        resolve,
      },
    )).resolves.toBeUndefined()

    expect(resolve).not.toHaveBeenCalled()
    expect(findWithDecryption).not.toHaveBeenCalled()
  })

  it('skips processing for internal query_index events', async () => {
    ;(findWithDecryption as jest.Mock).mockResolvedValue([])

    await expect(handler(
      { id: 'record-1', tenantId: 'tenant-1', organizationId: 'org-1' },
      {
        eventName: 'query_index.coverage.refresh',
        resolve: <T,>(_name: string): T => { throw new Error('should not be called') },
      },
    )).resolves.toBeUndefined()

    expect(findWithDecryption).not.toHaveBeenCalled()
  })
})
