import type { EntityManager } from '@mikro-orm/postgresql'
import { createCacheService, type CacheStrategy } from '@open-mercato/cache'
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
  getDeclaredEvents: jest.fn(() => []),
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

function createForkableEntityManager(): EntityManager {
  const em = {
    fork: jest.fn(function fork() {
      return em
    }),
    flush: jest.fn(async () => undefined),
  } as unknown as EntityManager
  return em
}

function createContext(em: EntityManager, cache?: CacheStrategy | null, eventName = 'catalog.product.deleted') {
  const resolve = jest.fn(<T,>(name: string): T => {
    if (name === 'em') return em as T
    if (name === 'cache') {
      if (cache === null) throw new Error('cache unavailable')
      return cache as T
    }
    throw new Error(`Unexpected dependency: ${name}`)
  })
  return { eventName, resolve }
}

describe('webhooks outbound dispatch subscriber - subscription cache', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.OM_WEBHOOKS_SUBSCRIPTION_CACHE_TTL_MS
  })

  it('queries the database once for zero active webhooks and reuses the cached empty list', async () => {
    const em = createForkableEntityManager()
    const cache = createCacheService({ strategy: 'memory' })
    ;(findWithDecryption as jest.Mock).mockResolvedValue([])

    const payload = { id: 'p1', tenantId: 'tenant-1', organizationId: 'org-1' }
    await handler(payload, createContext(em, cache))
    await handler(payload, createContext(em, cache))

    expect(findWithDecryption).toHaveBeenCalledTimes(1)
  })

  it('does not resolve or fork an entity manager on the cached zero-webhook path', async () => {
    const em = createForkableEntityManager()
    const cache = createCacheService({ strategy: 'memory' })
    ;(findWithDecryption as jest.Mock).mockResolvedValue([])

    const payload = { id: 'p1', tenantId: 'tenant-1', organizationId: 'org-1' }
    await handler(payload, createContext(em, cache))
    expect(em.fork).toHaveBeenCalledTimes(1)

    const secondContext = createContext(em, cache)
    await handler(payload, secondContext)

    expect(em.fork).toHaveBeenCalledTimes(1)
    expect(secondContext.resolve).not.toHaveBeenCalledWith('em')
  })

  it('does not resolve or fork an entity manager when the cached list has no matching pattern', async () => {
    const em = createForkableEntityManager()
    const cache = createCacheService({ strategy: 'memory' })

    ;(findWithDecryption as jest.Mock).mockResolvedValueOnce([
      { id: 'webhook-1', tenantId: 'tenant-1', organizationId: 'org-1', subscribedEvents: ['catalog.product.created'] },
    ])

    await handler(
      { id: 'p1', tenantId: 'tenant-1', organizationId: 'org-1' },
      createContext(em, cache, 'catalog.product.created'),
    )
    expect(em.fork).toHaveBeenCalledTimes(1)

    const secondContext = createContext(em, cache, 'catalog.product.deleted')
    await handler({ id: 'p2', tenantId: 'tenant-1', organizationId: 'org-1' }, secondContext)

    expect(em.fork).toHaveBeenCalledTimes(1)
    expect(secondContext.resolve).not.toHaveBeenCalledWith('em')
  })

  it('does not hit the database for a cached non-matching subscribedEvents pattern', async () => {
    const em = createForkableEntityManager()
    const cache = createCacheService({ strategy: 'memory' })

    ;(findWithDecryption as jest.Mock).mockResolvedValueOnce([
      { id: 'webhook-1', tenantId: 'tenant-1', organizationId: 'org-1', subscribedEvents: ['catalog.product.created'] },
    ])

    await handler(
      { id: 'p1', tenantId: 'tenant-1', organizationId: 'org-1' },
      createContext(em, cache, 'catalog.product.created'),
    )
    expect(findWithDecryption).toHaveBeenCalledTimes(1)

    await handler(
      { id: 'p2', tenantId: 'tenant-1', organizationId: 'org-1' },
      createContext(em, cache, 'catalog.product.deleted'),
    )

    expect(findWithDecryption).toHaveBeenCalledTimes(1)
    expect(createWebhookDelivery).not.toHaveBeenCalled()
  })

  it('loads matching webhooks by id and creates a delivery on a cache hit', async () => {
    const em = createForkableEntityManager()
    const cache = createCacheService({ strategy: 'memory' })

    const fullWebhook = {
      id: 'webhook-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      subscribedEvents: ['catalog.product.deleted'],
    }

    ;(findWithDecryption as jest.Mock)
      .mockResolvedValueOnce([fullWebhook])
      .mockResolvedValueOnce([fullWebhook])
    ;(isWebhookIntegrationEnabled as jest.Mock).mockResolvedValue(true)
    ;(createWebhookDelivery as jest.Mock).mockResolvedValue({ id: 'delivery-1', tenantId: 'tenant-1', organizationId: 'org-1' })
    ;(enqueueWebhookDelivery as jest.Mock).mockResolvedValue('job-1')

    await handler(
      { id: 'p1', tenantId: 'tenant-1', organizationId: 'org-1' },
      createContext(em, cache, 'catalog.product.deleted'),
    )
    await handler(
      { id: 'p2', tenantId: 'tenant-1', organizationId: 'org-1' },
      createContext(em, cache, 'catalog.product.deleted'),
    )

    expect(findWithDecryption).toHaveBeenCalledTimes(2)
    expect(findWithDecryption).toHaveBeenNthCalledWith(
      2,
      em,
      expect.anything(),
      expect.objectContaining({ id: { $in: ['webhook-1'] } }),
      {},
      expect.objectContaining({ tenantId: 'tenant-1' }),
    )
    expect(createWebhookDelivery).toHaveBeenCalledTimes(2)
    expect(enqueueWebhookDelivery).toHaveBeenCalledTimes(2)
  })

  it('re-queries the database after the invalidation event runs', async () => {
    const em = createForkableEntityManager()
    const cache = createCacheService({ strategy: 'memory' })

    ;(findWithDecryption as jest.Mock).mockResolvedValue([])

    const payload = { id: 'p1', tenantId: 'tenant-1', organizationId: 'org-1' }
    await handler(payload, createContext(em, cache))
    expect(findWithDecryption).toHaveBeenCalledTimes(1)

    await handler(payload, createContext(em, cache))
    expect(findWithDecryption).toHaveBeenCalledTimes(1)

    await handler(
      { id: 'webhook-1', tenantId: 'tenant-1', organizationId: 'org-1' },
      createContext(em, cache, 'webhooks.webhook.created'),
    )

    await handler(payload, createContext(em, cache))
    expect(findWithDecryption).toHaveBeenCalledTimes(2)
  })

  it('never serves one tenant cached list to another tenant', async () => {
    const em = createForkableEntityManager()
    const cache = createCacheService({ strategy: 'memory' })

    ;(findWithDecryption as jest.Mock)
      .mockResolvedValueOnce([
        { id: 'webhook-1', tenantId: 'tenant-1', organizationId: 'org-1', subscribedEvents: ['catalog.product.deleted'] },
      ])
      .mockResolvedValueOnce([])

    await handler(
      { id: 'p1', tenantId: 'tenant-1', organizationId: 'org-1' },
      createContext(em, cache, 'catalog.product.deleted'),
    )
    await handler(
      { id: 'p2', tenantId: 'tenant-2', organizationId: 'org-1' },
      createContext(em, cache, 'catalog.product.deleted'),
    )

    expect(findWithDecryption).toHaveBeenCalledTimes(2)
    expect((findWithDecryption as jest.Mock).mock.calls[1][2]).toEqual(
      expect.objectContaining({ tenantId: 'tenant-2' }),
    )
  })

  it('never reads or writes the cache when OM_WEBHOOKS_SUBSCRIPTION_CACHE_TTL_MS=0', async () => {
    process.env.OM_WEBHOOKS_SUBSCRIPTION_CACHE_TTL_MS = '0'

    const em = createForkableEntityManager()
    const cache = createCacheService({ strategy: 'memory' })
    const getSpy = jest.spyOn(cache, 'get')
    const setSpy = jest.spyOn(cache, 'set')

    const fullWebhook = {
      id: 'webhook-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      subscribedEvents: ['catalog.product.deleted'],
    }

    ;(findWithDecryption as jest.Mock).mockResolvedValue([fullWebhook])
    ;(isWebhookIntegrationEnabled as jest.Mock).mockResolvedValue(true)
    ;(createWebhookDelivery as jest.Mock).mockResolvedValue({ id: 'delivery-1', tenantId: 'tenant-1', organizationId: 'org-1' })
    ;(enqueueWebhookDelivery as jest.Mock).mockResolvedValue('job-1')

    await handler(
      { id: 'p1', tenantId: 'tenant-1', organizationId: 'org-1' },
      createContext(em, cache, 'catalog.product.deleted'),
    )
    await handler(
      { id: 'p2', tenantId: 'tenant-1', organizationId: 'org-1' },
      createContext(em, cache, 'catalog.product.deleted'),
    )

    expect(getSpy).not.toHaveBeenCalled()
    expect(setSpy).not.toHaveBeenCalled()
    expect(findWithDecryption).toHaveBeenCalledTimes(2)
  })

  it('falls back to the uncached query and still dispatches when the cache is unavailable', async () => {
    const em = createForkableEntityManager()

    const fullWebhook = {
      id: 'webhook-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      subscribedEvents: ['catalog.product.deleted'],
    }

    ;(findWithDecryption as jest.Mock).mockResolvedValue([fullWebhook])
    ;(isWebhookIntegrationEnabled as jest.Mock).mockResolvedValue(true)
    ;(createWebhookDelivery as jest.Mock).mockResolvedValue({ id: 'delivery-1', tenantId: 'tenant-1', organizationId: 'org-1' })
    ;(enqueueWebhookDelivery as jest.Mock).mockResolvedValue('job-1')

    await handler(
      { id: 'p1', tenantId: 'tenant-1', organizationId: 'org-1' },
      createContext(em, null, 'catalog.product.deleted'),
    )
    await handler(
      { id: 'p2', tenantId: 'tenant-1', organizationId: 'org-1' },
      createContext(em, null, 'catalog.product.deleted'),
    )

    expect(findWithDecryption).toHaveBeenCalledTimes(2)
    expect(createWebhookDelivery).toHaveBeenCalledTimes(2)
    expect(enqueueWebhookDelivery).toHaveBeenCalledTimes(2)
  })
})
