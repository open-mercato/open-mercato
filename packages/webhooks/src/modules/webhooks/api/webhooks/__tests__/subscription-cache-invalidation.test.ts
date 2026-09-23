/** @jest-environment node */

import { createCacheService, type CacheStrategy } from '@open-mercato/cache'
import {
  getCachedActiveWebhooks,
  setCachedActiveWebhooks,
} from '../../../lib/subscription-cache'

type CapturedHooks = {
  afterCreate?: (entity: unknown, ctx: unknown) => Promise<void> | void
  afterUpdate?: (entity: unknown, ctx: unknown) => Promise<void> | void
  afterDelete?: (id: string, ctx: unknown) => Promise<void> | void
}

const captured: { hooks: CapturedHooks | null } = { hooks: null }

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: jest.fn((options: { hooks?: CapturedHooks }) => {
    captured.hooks = options.hooks ?? null
    return {
      metadata: {},
      GET: jest.fn(),
      POST: jest.fn(),
      PUT: jest.fn(),
      DELETE: jest.fn(),
    }
  }),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ translate: (_key: string, fallback?: string) => fallback ?? '' })),
}))

import '../route'

const WEBHOOK_ID = '123e4567-e89b-12d3-a456-426614174072'

describe('webhooks CRUD route inline subscription-cache invalidation', () => {
  let cache: CacheStrategy
  let container: { resolve: (token: string) => unknown }

  beforeEach(async () => {
    cache = createCacheService({ strategy: 'memory' })
    container = { resolve: (token: string) => (token === 'cache' ? cache : null) }
    await setCachedActiveWebhooks(
      cache,
      'tenant-1',
      'org-1',
      [{ id: WEBHOOK_ID, tenantId: 'tenant-1', organizationId: 'org-1', subscribedEvents: ['catalog.product.created'] }],
      60_000,
    )
    expect(await getCachedActiveWebhooks(cache, 'tenant-1', 'org-1')).not.toBeNull()
  })

  it('registers afterCreate, afterUpdate and afterDelete hooks', () => {
    expect(typeof captured.hooks?.afterCreate).toBe('function')
    expect(typeof captured.hooks?.afterUpdate).toBe('function')
    expect(typeof captured.hooks?.afterDelete).toBe('function')
  })

  it('afterCreate invalidates the tenant subscription cache', async () => {
    await captured.hooks?.afterCreate?.(
      { id: WEBHOOK_ID, tenantId: 'tenant-1' },
      { container, auth: { tenantId: 'tenant-1', orgId: 'org-1' } },
    )
    expect(await getCachedActiveWebhooks(cache, 'tenant-1', 'org-1')).toBeNull()
  })

  it('afterUpdate invalidates the tenant subscription cache', async () => {
    await captured.hooks?.afterUpdate?.(
      { id: WEBHOOK_ID, tenantId: 'tenant-1' },
      { container, auth: { tenantId: 'tenant-1', orgId: 'org-1' } },
    )
    expect(await getCachedActiveWebhooks(cache, 'tenant-1', 'org-1')).toBeNull()
  })

  it('afterDelete invalidates the tenant subscription cache from the auth scope', async () => {
    await captured.hooks?.afterDelete?.(
      WEBHOOK_ID,
      { container, auth: { tenantId: 'tenant-1', orgId: 'org-1' } },
    )
    expect(await getCachedActiveWebhooks(cache, 'tenant-1', 'org-1')).toBeNull()
  })

  it('leaves another tenant cache entry intact', async () => {
    await setCachedActiveWebhooks(cache, 'tenant-2', 'org-1', [], 60_000)
    await captured.hooks?.afterUpdate?.(
      { id: WEBHOOK_ID, tenantId: 'tenant-1' },
      { container, auth: { tenantId: 'tenant-1', orgId: 'org-1' } },
    )
    expect(await getCachedActiveWebhooks(cache, 'tenant-2', 'org-1')).not.toBeNull()
  })
})
