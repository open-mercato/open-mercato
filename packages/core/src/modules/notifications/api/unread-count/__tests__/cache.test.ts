/** @jest-environment node */

import { createHash } from 'node:crypto'

const tenantId = '11111111-1111-4111-8111-111111111111'
const orgId = '22222222-2222-4222-8222-222222222222'
const childOrgId = '55555555-5555-4555-8555-555555555555'
const userId = '33333333-3333-4333-8333-333333333333'

function scopeFingerprint(organizationIds: string[]): string {
  return createHash('sha256')
    .update(Array.from(new Set(organizationIds)).sort((left, right) => left.localeCompare(right)).join('\0'))
    .digest('hex')
    .slice(0, 16)
}

const count = jest.fn()

const cache = {
  get: jest.fn(),
  set: jest.fn(),
} as { get: jest.Mock; set: jest.Mock }

const em = {
  count: (...args: unknown[]) => count(...args),
}

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'cache') return cache
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

const resolveNotificationContextMock = jest.fn(async () => ({
  ctx: { container },
  scope: { userId, tenantId, organizationId: orgId, organizationIds: [orgId] },
}))

jest.mock('@open-mercato/core/modules/notifications/lib/routeHelpers', () => ({
  resolveNotificationContext: (...args: unknown[]) => resolveNotificationContextMock(...args),
}))

jest.mock('@open-mercato/cache', () => ({
  runWithCacheTenant: jest.fn((_tenantId: string, fn: () => unknown) => fn()),
}))

const ORIGINAL_ENV = { ...process.env }

const loadRoute = async () => {
  jest.resetModules()
  return import('../route')
}

describe('GET /api/notifications/unread-count caching', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...ORIGINAL_ENV }
    resolveNotificationContextMock.mockResolvedValue({
      ctx: { container },
      scope: { userId, tenantId, organizationId: orgId, organizationIds: [orgId] },
    })
  })

  afterAll(() => {
    process.env = ORIGINAL_ENV
  })

  it('caches the count with organization-scoped filters, key, and collection tags', async () => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
    const { GET } = await loadRoute()
    cache.get.mockResolvedValue(null)
    count.mockResolvedValue(7)

    const res = await GET(new Request('http://localhost/api/notifications/unread-count'))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ unreadCount: 7 })

    expect(cache.get).toHaveBeenCalledTimes(1)
    expect(cache.set).toHaveBeenCalledTimes(1)
    const [key, value, opts] = cache.set.mock.calls[0]
    expect(key).toBe(
      `notifications:unread-count:u=${userId}:org=${orgId}:scope=${scopeFingerprint([orgId])}`,
    )
    expect(value).toBe(7)
    expect(opts.ttl).toBe(10_000)
    expect(opts.tags).toEqual([
      `crud:notifications.notification:tenant:${tenantId}:org:${orgId}:collection`,
      `crud:notifications.notification:tenant:${tenantId}:org:null:collection`,
    ])
    expect(count).toHaveBeenCalledWith(expect.anything(), {
      recipientUserId: userId,
      tenantId,
      status: 'unread',
      $or: [
        { organizationId: { $in: [orgId] } },
        { organizationId: null },
      ],
    })
  })

  it('serves the cached count without querying the database on a cache hit', async () => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
    const { GET } = await loadRoute()
    cache.get.mockResolvedValue(4)

    const res = await GET(new Request('http://localhost/api/notifications/unread-count'))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ unreadCount: 4 })
    expect(count).not.toHaveBeenCalled()
    expect(cache.set).not.toHaveBeenCalled()
  })

  it('uses different keys for different readable trees under the same selected organization', async () => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
    const { GET } = await loadRoute()
    cache.get.mockResolvedValue(null)
    count.mockResolvedValue(1)

    await GET(new Request('http://localhost/api/notifications/unread-count'))
    const firstKey = cache.set.mock.calls[0][0]

    resolveNotificationContextMock.mockResolvedValue({
      ctx: { container },
      scope: {
        userId,
        tenantId,
        organizationId: orgId,
        organizationIds: [orgId, childOrgId],
      },
    })
    await GET(new Request('http://localhost/api/notifications/unread-count'))
    const secondKey = cache.set.mock.calls[1][0]

    expect(firstKey).not.toBe(secondKey)
    expect(secondKey).toBe(
      `notifications:unread-count:u=${userId}:org=${orgId}:scope=${scopeFingerprint([orgId, childOrgId])}`,
    )
  })

  it('falls back to the database count when the cache read throws', async () => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
    const { GET } = await loadRoute()
    cache.get.mockRejectedValue(new Error('cache backend unavailable'))
    count.mockResolvedValue(9)

    const res = await GET(new Request('http://localhost/api/notifications/unread-count'))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ unreadCount: 9 })
    expect(cache.get).toHaveBeenCalledTimes(1)
    expect(count).toHaveBeenCalledTimes(1)
  })

  it('leaves unrestricted all-organizations counts tenant-wide and uncached', async () => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
    const { GET } = await loadRoute()
    resolveNotificationContextMock.mockResolvedValue({
      ctx: { container },
      scope: { userId, tenantId, organizationId: null, organizationIds: null },
    })
    cache.get.mockResolvedValue(null)
    count.mockResolvedValue(2)

    const res = await GET(new Request('http://localhost/api/notifications/unread-count'))

    expect(res.status).toBe(200)
    expect(cache.get).not.toHaveBeenCalled()
    expect(cache.set).not.toHaveBeenCalled()
    expect(count).toHaveBeenCalledWith(expect.anything(), {
      recipientUserId: userId,
      tenantId,
      status: 'unread',
    })
  })

  it('uses a distinct tenant-wide-only key when no organization is accessible', async () => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
    const { GET } = await loadRoute()
    resolveNotificationContextMock.mockResolvedValue({
      ctx: { container },
      scope: { userId, tenantId, organizationId: null, organizationIds: [] },
    })
    cache.get.mockResolvedValue(null)
    count.mockResolvedValue(1)

    const res = await GET(new Request('http://localhost/api/notifications/unread-count'))

    expect(res.status).toBe(200)
    const [key, , opts] = cache.set.mock.calls[0]
    expect(key).toBe(`notifications:unread-count:u=${userId}:org=no-access`)
    expect(opts.tags).toEqual([
      `crud:notifications.notification:tenant:${tenantId}:org:null:collection`,
    ])
    expect(count).toHaveBeenCalledWith(expect.anything(), {
      recipientUserId: userId,
      tenantId,
      organizationId: null,
      status: 'unread',
    })
  })

  it('does not cache when the crud cache flag is off', async () => {
    delete process.env.ENABLE_CRUD_API_CACHE
    const { GET } = await loadRoute()
    count.mockResolvedValue(5)

    const res = await GET(new Request('http://localhost/api/notifications/unread-count'))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ unreadCount: 5 })
    expect(cache.get).not.toHaveBeenCalled()
    expect(cache.set).not.toHaveBeenCalled()
  })

  it('does not cache when there is no user in scope', async () => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
    const { GET } = await loadRoute()
    resolveNotificationContextMock.mockResolvedValue({
      ctx: { container },
      scope: { userId: null, tenantId, organizationId: orgId, organizationIds: [orgId] },
    })
    count.mockResolvedValue(3)

    const res = await GET(new Request('http://localhost/api/notifications/unread-count'))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ unreadCount: 3 })
    expect(cache.get).not.toHaveBeenCalled()
    expect(cache.set).not.toHaveBeenCalled()
  })
})
