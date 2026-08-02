/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const orgId = '22222222-2222-4222-8222-222222222222'
const firstUserId = '33333333-3333-4333-8333-333333333333'
const secondUserId = '44444444-4444-4444-8444-444444444444'

const find = jest.fn()
const count = jest.fn()

const cache = {
  get: jest.fn(),
  set: jest.fn(),
} as { get: jest.Mock; set: jest.Mock }

const em = {
  find: (...args: unknown[]) => find(...args),
  count: (...args: unknown[]) => count(...args),
}

let cacheAvailable = true
const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'cache' && cacheAvailable) return cache
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

const resolveNotificationContextMock = jest.fn(async () => ({
  ctx: { container },
  scope: { userId: firstUserId, tenantId, organizationId: orgId },
}))

const runWithCacheTenantMock = jest.fn((_tenantId: string, fn: () => unknown) => fn())
const mockDebugCrudCache = jest.fn()

jest.mock('@open-mercato/core/modules/notifications/lib/routeHelpers', () => ({
  resolveNotificationContext: (...args: unknown[]) => resolveNotificationContextMock(...args),
}))

jest.mock('@open-mercato/cache', () => ({
  runWithCacheTenant: (...args: unknown[]) => runWithCacheTenantMock(...args),
}))

jest.mock('@open-mercato/shared/lib/crud/cache', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/crud/cache'),
  debugCrudCache: (...args: unknown[]) => mockDebugCrudCache(...args),
}))

const ORIGINAL_ENV = { ...process.env }

const loadRoute = async () => {
  jest.resetModules()
  return import('../route')
}

describe('GET /api/notifications caching', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...ORIGINAL_ENV }
    cacheAvailable = true
    resolveNotificationContextMock.mockResolvedValue({
      ctx: { container },
      scope: { userId: firstUserId, tenantId, organizationId: orgId },
    })
    find.mockResolvedValue([])
    count.mockResolvedValue(0)
  })

  afterAll(() => {
    process.env = ORIGINAL_ENV
  })

  it('caches the assembled page for ten seconds in the tenant namespace', async () => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
    const { GET } = await loadRoute()
    cache.get.mockResolvedValue(null)
    count.mockResolvedValue(7)

    const response = await GET(new Request('http://localhost/api/notifications?pageSize=50'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      items: [],
      total: 7,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    })
    expect(runWithCacheTenantMock).toHaveBeenCalledWith(tenantId, expect.any(Function))
    expect(cache.get).toHaveBeenCalledTimes(1)
    expect(cache.set).toHaveBeenCalledTimes(1)
    const [key, value, options] = cache.set.mock.calls[0]
    expect(key).toContain(`notifications:list:v1:u=${firstUserId}:filters=`)
    expect(value).toEqual({
      items: [],
      total: 7,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    })
    expect(options).toEqual({
      ttl: 10_000,
      tags: [
        `crud:notifications.notification:tenant:${tenantId}:org:null:collection`,
      ],
    })
  })

  it('serves a cached page without querying the database', async () => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
    const { GET } = await loadRoute()
    const cachedPayload = {
      items: [],
      total: 3,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    }
    cache.get.mockResolvedValue(cachedPayload)

    const response = await GET(new Request('http://localhost/api/notifications'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(cachedPayload)
    expect(find).not.toHaveBeenCalled()
    expect(count).not.toHaveBeenCalled()
    expect(cache.set).not.toHaveBeenCalled()
  })

  it('uses distinct cache keys for different users', async () => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
    const { GET } = await loadRoute()
    cache.get.mockResolvedValue(null)

    await GET(new Request('http://localhost/api/notifications?pageSize=50'))
    resolveNotificationContextMock.mockResolvedValueOnce({
      ctx: { container },
      scope: { userId: secondUserId, tenantId, organizationId: orgId },
    })
    await GET(new Request('http://localhost/api/notifications?pageSize=50'))

    const keys = cache.get.mock.calls.map(([key]) => key)
    expect(keys[0]).toContain(`u=${firstUserId}:`)
    expect(keys[1]).toContain(`u=${secondUserId}:`)
    expect(keys[0]).not.toBe(keys[1])
  })

  it('uses distinct cache keys for different filter signatures', async () => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
    const { GET } = await loadRoute()
    cache.get.mockResolvedValue(null)

    await GET(new Request('http://localhost/api/notifications?status=unread&pageSize=50'))
    await GET(new Request('http://localhost/api/notifications?status=read&pageSize=50'))

    const keys = cache.get.mock.calls.map(([key]) => key)
    expect(keys[0]).not.toBe(keys[1])
    expect(keys[0]).toContain('"status":"unread"')
    expect(keys[1]).toContain('"status":"read"')
  })

  it('falls back to the database when cache access fails', async () => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
    const { GET } = await loadRoute()
    cache.get.mockRejectedValue(new Error('cache backend unavailable'))
    cache.set.mockRejectedValue(new Error('cache backend unavailable'))
    count.mockResolvedValue(2)

    const response = await GET(new Request('http://localhost/api/notifications'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      items: [],
      total: 2,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    })
    expect(find).toHaveBeenCalledTimes(1)
    expect(count).toHaveBeenCalledTimes(1)
    expect(mockDebugCrudCache).toHaveBeenCalledWith(
      'notifications-list-cache-read-failed',
      { error: 'cache backend unavailable' },
    )
    expect(mockDebugCrudCache).toHaveBeenCalledWith(
      'notifications-list-cache-write-failed',
      { error: 'cache backend unavailable' },
    )
  })

  it('falls back to the database when the cache service is unavailable', async () => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
    cacheAvailable = false
    const { GET } = await loadRoute()
    count.mockResolvedValue(4)

    const response = await GET(new Request('http://localhost/api/notifications'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ total: 4 })
    expect(find).toHaveBeenCalledTimes(1)
    expect(count).toHaveBeenCalledTimes(1)
    expect(cache.get).not.toHaveBeenCalled()
    expect(cache.set).not.toHaveBeenCalled()
  })

  it('does not cache when the crud cache flag is off', async () => {
    delete process.env.ENABLE_CRUD_API_CACHE
    const { GET } = await loadRoute()

    const response = await GET(new Request('http://localhost/api/notifications'))

    expect(response.status).toBe(200)
    expect(cache.get).not.toHaveBeenCalled()
    expect(cache.set).not.toHaveBeenCalled()
  })

  it('does not cache when there is no user in scope', async () => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
    const { GET } = await loadRoute()
    resolveNotificationContextMock.mockResolvedValue({
      ctx: { container },
      scope: { userId: null, tenantId, organizationId: orgId },
    })

    const response = await GET(new Request('http://localhost/api/notifications'))

    expect(response.status).toBe(200)
    expect(cache.get).not.toHaveBeenCalled()
    expect(cache.set).not.toHaveBeenCalled()
  })

  it('ignores malformed cached payloads', async () => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
    const { GET } = await loadRoute()
    cache.get.mockResolvedValue({
      items: 'not-an-array',
      total: 99,
    })
    count.mockResolvedValue(2)

    const response = await GET(new Request('http://localhost/api/notifications'))

    await expect(response.json()).resolves.toMatchObject({ total: 2 })
    expect(find).toHaveBeenCalledTimes(1)
    expect(count).toHaveBeenCalledTimes(1)
  })
})
