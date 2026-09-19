/** @jest-environment node */

import { createCacheService, type CacheStrategy } from '@open-mercato/cache'
import {
  getCachedActiveWebhooks,
  setCachedActiveWebhooks,
} from '../../../../lib/subscription-cache'

const WEBHOOK_ID = '123e4567-e89b-12d3-a456-426614174071'

const webhookRecord = {
  id: WEBHOOK_ID,
  name: 'Hook',
  description: null,
  url: 'https://example.com/hook',
  subscribedEvents: ['catalog.product.created'],
  httpMethod: 'POST',
  isActive: true,
  organizationId: 'org-1',
  tenantId: 'tenant-1',
  updatedAt: new Date('2026-06-01T10:00:00.000Z'),
  deletedAt: null as Date | null,
}

const mockEm = {
  fork: jest.fn(() => mockEm),
  flush: jest.fn(async () => undefined),
}

let cache: CacheStrategy

const mockContainer = {
  resolve: (token: string) => {
    if (token === 'em') return mockEm
    if (token === 'cache') return cache
    if (token === 'commandOptimisticLockGuardService') throw new Error('not registered')
    return null
  },
}

jest.mock('../../../../events', () => ({
  emitWebhooksEvent: jest.fn(async () => undefined),
}))

jest.mock('../../../helpers', () => ({
  json: (payload: unknown, init: ResponseInit = { status: 200 }) =>
    new Response(JSON.stringify(payload), {
      ...init,
      headers: { 'content-type': 'application/json' },
    }),
  resolveWebhookRequestScope: jest.fn(async () => ({
    container: mockContainer,
    em: mockEm,
    tenantId: 'tenant-1',
    organizationId: 'org-1',
  })),
  findScopedWebhook: jest.fn(async () => webhookRecord),
  serializeWebhookDetail: (item: { id: string }) => ({ id: item.id }),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ translate: (_key: string, fallback?: string) => fallback ?? '' })),
}))

import { PUT, DELETE } from '../route'

function request(method: string, body?: unknown) {
  return new Request(`http://localhost/api/webhooks/${WEBHOOK_ID}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

const context = { params: Promise.resolve({ id: WEBHOOK_ID }) }

async function seedCache(): Promise<void> {
  await setCachedActiveWebhooks(
    cache,
    'tenant-1',
    'org-1',
    [{ id: WEBHOOK_ID, tenantId: 'tenant-1', organizationId: 'org-1', subscribedEvents: ['catalog.product.created'] }],
    60_000,
  )
}

describe('webhook endpoint PUT/DELETE inline subscription-cache invalidation', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    webhookRecord.deletedAt = null
    cache = createCacheService({ strategy: 'memory' })
    await seedCache()
    expect(await getCachedActiveWebhooks(cache, 'tenant-1', 'org-1')).not.toBeNull()
  })

  it('PUT drops the tenant subscription cache synchronously with the write', async () => {
    const res = await PUT(request('PUT', { isActive: false }), context)
    expect(res.status).toBe(200)
    expect(await getCachedActiveWebhooks(cache, 'tenant-1', 'org-1')).toBeNull()
  })

  it('DELETE drops the tenant subscription cache synchronously with the soft delete', async () => {
    const res = await DELETE(request('DELETE'), context)
    expect(res.status).toBe(200)
    expect(await getCachedActiveWebhooks(cache, 'tenant-1', 'org-1')).toBeNull()
  })
})
