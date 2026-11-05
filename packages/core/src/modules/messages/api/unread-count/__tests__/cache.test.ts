/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const orgId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'

const executeTakeFirst = jest.fn()

const cache = {
  get: jest.fn(),
  set: jest.fn(),
} as { get: jest.Mock; set: jest.Mock }

const em = {
  getKysely: () => {
    const chain: any = {}
    chain.innerJoin = jest.fn(() => chain)
    chain.where = jest.fn(() => chain)
    chain.select = jest.fn(() => chain)
    chain.executeTakeFirst = executeTakeFirst
    return { selectFrom: () => chain }
  },
}

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'cache') return cache
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

const resolveMessageContextMock = jest.fn(async () => ({
  ctx: { container },
  scope: { userId, tenantId, organizationId: orgId },
}))

jest.mock('@open-mercato/core/modules/messages/lib/routeHelpers', () => ({
  resolveMessageContext: (...args: unknown[]) => resolveMessageContextMock(...args),
}))

jest.mock('@open-mercato/cache', () => ({
  runWithCacheTenant: jest.fn((_tenantId: string, fn: () => unknown) => fn()),
}))

const ORIGINAL_ENV = { ...process.env }

const loadRoute = async () => {
  jest.resetModules()
  return import('../route')
}

describe('GET /api/messages/unread-count caching', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...ORIGINAL_ENV }
    resolveMessageContextMock.mockResolvedValue({
      ctx: { container },
      scope: { userId, tenantId, organizationId: orgId },
    })
  })

  afterAll(() => {
    process.env = ORIGINAL_ENV
  })

  it('caches the count with command-bus-compatible collection tags keyed by user + org', async () => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
    const { GET } = await loadRoute()
    cache.get.mockResolvedValue(null)
    executeTakeFirst.mockResolvedValue({ count: '7' })

    const res = await GET(new Request('http://localhost/api/messages/unread-count'))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ unreadCount: 7 })

    expect(cache.get).toHaveBeenCalledTimes(1)
    expect(cache.set).toHaveBeenCalledTimes(1)
    const [key, value, opts] = cache.set.mock.calls[0]
    expect(key).toBe(`messages:unread-count:u=${userId}:org=${orgId}`)
    expect(value).toBe(7)
    expect(opts.ttl).toBe(10_000)
    expect(opts.tags).toEqual([
      `crud:messages.message:tenant:${tenantId}:org:${orgId}:collection`,
    ])
  })

  it('serves the cached count without querying the database on a cache hit', async () => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
    const { GET } = await loadRoute()
    cache.get.mockResolvedValue(4)

    const res = await GET(new Request('http://localhost/api/messages/unread-count'))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ unreadCount: 4 })
    expect(executeTakeFirst).not.toHaveBeenCalled()
    expect(cache.set).not.toHaveBeenCalled()
  })

  it('uses the org=null axis in the key and tags when scope has no organization', async () => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
    const { GET } = await loadRoute()
    resolveMessageContextMock.mockResolvedValue({
      ctx: { container },
      scope: { userId, tenantId, organizationId: null },
    })
    cache.get.mockResolvedValue(null)
    executeTakeFirst.mockResolvedValue({ count: '2' })

    const res = await GET(new Request('http://localhost/api/messages/unread-count'))

    expect(res.status).toBe(200)
    const [key, , opts] = cache.set.mock.calls[0]
    expect(key).toBe(`messages:unread-count:u=${userId}:org=null`)
    expect(opts.tags).toEqual([
      `crud:messages.message:tenant:${tenantId}:org:null:collection`,
    ])
  })

  it('does not cache when the crud cache flag is off', async () => {
    delete process.env.ENABLE_CRUD_API_CACHE
    const { GET } = await loadRoute()
    executeTakeFirst.mockResolvedValue({ count: '5' })

    const res = await GET(new Request('http://localhost/api/messages/unread-count'))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ unreadCount: 5 })
    expect(cache.get).not.toHaveBeenCalled()
    expect(cache.set).not.toHaveBeenCalled()
  })
})
