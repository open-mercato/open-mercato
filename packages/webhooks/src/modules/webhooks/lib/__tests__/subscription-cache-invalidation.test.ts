import type { EntityManager } from '@mikro-orm/postgresql'
import { createCacheService, type CacheStrategy } from '@open-mercato/cache'
import {
  getCachedActiveWebhooks,
  invalidateWebhookSubscriptionCacheFor,
  setCachedActiveWebhooks,
} from '../subscription-cache'
import { processWebhookDeliveryJob } from '../delivery'

jest.mock('../../events', () => ({
  emitWebhooksEvent: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

jest.mock('../integration-state', () => ({
  isWebhookIntegrationEnabled: jest.fn(async () => true),
  WEBHOOK_INTEGRATION_DISABLED_MESSAGE: 'disabled',
}))

jest.mock('@open-mercato/shared/lib/webhooks', () => ({
  buildWebhookHeaders: jest.fn(() => ({})),
  generateMessageId: jest.fn(() => 'msg-1'),
}))

import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

const findOneWithDecryptionMock = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>

async function seed(cache: CacheStrategy): Promise<void> {
  await setCachedActiveWebhooks(
    cache,
    'tenant-1',
    'org-1',
    [{ id: 'w-1', tenantId: 'tenant-1', organizationId: 'org-1', subscribedEvents: ['a.b.c'] }],
    60_000,
  )
}

describe('invalidateWebhookSubscriptionCacheFor', () => {
  it('accepts a bare resolve function', async () => {
    const cache = createCacheService({ strategy: 'memory' })
    await seed(cache)
    await invalidateWebhookSubscriptionCacheFor((token: string) => (token === 'cache' ? cache : null), 'tenant-1')
    expect(await getCachedActiveWebhooks(cache, 'tenant-1', 'org-1')).toBeNull()
  })

  it('accepts a container', async () => {
    const cache = createCacheService({ strategy: 'memory' })
    await seed(cache)
    await invalidateWebhookSubscriptionCacheFor({ resolve: (token: string) => (token === 'cache' ? cache : null) }, 'tenant-1')
    expect(await getCachedActiveWebhooks(cache, 'tenant-1', 'org-1')).toBeNull()
  })

  it('is a no-op when no cache resolves, when the resolver throws, and when the tenant is missing', async () => {
    const cache = createCacheService({ strategy: 'memory' })
    await seed(cache)

    await expect(invalidateWebhookSubscriptionCacheFor(undefined, 'tenant-1')).resolves.toBeUndefined()
    await expect(invalidateWebhookSubscriptionCacheFor(() => null, 'tenant-1')).resolves.toBeUndefined()
    await expect(invalidateWebhookSubscriptionCacheFor(() => { throw new Error('unavailable') }, 'tenant-1')).resolves.toBeUndefined()
    await expect(invalidateWebhookSubscriptionCacheFor({ resolve: () => cache }, '  ')).resolves.toBeUndefined()

    expect(await getCachedActiveWebhooks(cache, 'tenant-1', 'org-1')).not.toBeNull()
  })

  it('swallows a cache backend failure instead of throwing', async () => {
    const brokenCache = {
      get: jest.fn(async () => null),
      set: jest.fn(async () => undefined),
      deleteByTags: jest.fn(async () => { throw new Error('redis down') }),
    }
    await expect(invalidateWebhookSubscriptionCacheFor(() => brokenCache, 'tenant-1')).resolves.toBeUndefined()
    expect(brokenCache.deleteByTags).toHaveBeenCalled()
  })
})

describe('processWebhookDeliveryJob auto-disable invalidates the subscription cache', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.OM_WEBHOOKS_ALLOW_PRIVATE_URLS = '1'
    globalThis.fetch = jest.fn(async () => new Response('nope', { status: 500 })) as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    delete process.env.OM_WEBHOOKS_ALLOW_PRIVATE_URLS
  })

  function buildDelivery() {
    return {
      id: 'delivery-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      webhookId: 'w-1',
      status: 'pending',
      payload: { type: 'a.b.c', timestamp: new Date().toISOString(), data: {} },
      enqueuedAt: new Date(),
      eventType: 'a.b.c',
      maxAttempts: 1,
      attemptNumber: 0,
      messageId: 'msg-1',
      responseBody: null,
      responseHeaders: null,
      responseStatus: null,
      nextRetryAt: null,
      errorMessage: null,
      lastAttemptAt: null,
      deliveredAt: null,
      durationMs: null,
    }
  }

  function buildWebhook(autoDisableThreshold: number) {
    return {
      id: 'w-1',
      url: 'http://127.0.0.1:3001/hook',
      isActive: true,
      timeoutMs: 1000,
      httpMethod: 'POST',
      customHeaders: null,
      consecutiveFailures: 0,
      lastFailureAt: null,
      lastSuccessAt: null,
      autoDisableThreshold,
      maxRetries: 1,
      secret: 'secret',
      previousSecret: null,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    }
  }

  function buildEm(delivery: Record<string, unknown>) {
    return {
      findOne: jest.fn(async () => delivery),
      flush: jest.fn(async () => undefined),
    } as unknown as EntityManager
  }

  it('drops the cached tenant list when the webhook is auto-disabled', async () => {
    const cache = createCacheService({ strategy: 'memory' })
    await seed(cache)

    const webhook = buildWebhook(1)
    findOneWithDecryptionMock.mockResolvedValueOnce(webhook as never)

    await processWebhookDeliveryJob(buildEm(buildDelivery()), {
      deliveryId: 'delivery-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    }, { scheduleRetries: false, resolver: () => cache })

    expect(webhook.isActive).toBe(false)
    expect(await getCachedActiveWebhooks(cache, 'tenant-1', 'org-1')).toBeNull()
  })

  it('commits isActive=false before emitting and invalidating, so no concurrent read can repopulate a stale entry', async () => {
    const webhook = buildWebhook(1)
    const delivery = buildDelivery()
    const calls: string[] = []

    const cache = {
      get: jest.fn(async () => null),
      set: jest.fn(async () => undefined),
      deleteByTags: jest.fn(async () => { calls.push('deleteByTags') }),
    }
    const em = {
      findOne: jest.fn(async () => delivery),
      flush: jest.fn(async () => { calls.push(`flush:isActive=${webhook.isActive}`) }),
    } as unknown as EntityManager

    findOneWithDecryptionMock.mockResolvedValueOnce(webhook as never)

    await processWebhookDeliveryJob(em, {
      deliveryId: 'delivery-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    }, { scheduleRetries: false, resolver: () => cache })

    const invalidateIndex = calls.indexOf('deleteByTags')
    expect(invalidateIndex).toBeGreaterThan(-1)
    expect(calls.slice(0, invalidateIndex)).toContain('flush:isActive=false')
    expect(calls.slice(invalidateIndex)).not.toContain('flush:isActive=true')
  })

  it('keeps the cached tenant list when the failure does not trip auto-disable', async () => {
    const cache = createCacheService({ strategy: 'memory' })
    await seed(cache)

    const webhook = buildWebhook(0)
    findOneWithDecryptionMock.mockResolvedValueOnce(webhook as never)

    await processWebhookDeliveryJob(buildEm(buildDelivery()), {
      deliveryId: 'delivery-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    }, { scheduleRetries: false, resolver: () => cache })

    expect(webhook.isActive).toBe(true)
    expect(await getCachedActiveWebhooks(cache, 'tenant-1', 'org-1')).not.toBeNull()
  })
})
