/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const orgId = '22222222-2222-4222-8222-222222222222'

const em = {
  find: jest.fn(),
} as { find: jest.Mock }

const cache = {
  get: jest.fn(),
  set: jest.fn(),
} as { get: jest.Mock; set: jest.Mock }

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'cache') return cache
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({
    sub: 'user-1',
    tenantId,
    orgId,
  })),
}))

jest.mock('@open-mercato/cache', () => ({
  runWithCacheTenant: jest.fn((_tenantId: string, fn: () => unknown) => fn()),
}))

const makeRow = (code: string, name: string) => ({
  id: `00000000-0000-4000-8000-${code.padEnd(12, '0')}`,
  organizationId: orgId,
  tenantId,
  code,
  name,
  symbol: null,
  isActive: true,
})

const ORIGINAL_ENV = { ...process.env }

const loadRoute = async () => {
  jest.resetModules()
  return import('../route')
}

describe('GET /api/currencies/options caching', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...ORIGINAL_ENV }
  })

  afterAll(() => {
    process.env = ORIGINAL_ENV
  })

  it('caches the option payload with command-bus-compatible collection tags', async () => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
    const { GET } = await loadRoute()
    cache.get.mockResolvedValue(null)
    em.find.mockResolvedValue([makeRow('USD', 'US Dollar'), makeRow('EUR', 'Euro')])

    const res = await GET(new Request('http://localhost/api/currencies/options'))

    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: { value: string; label: string }[] }
    expect(body.items).toEqual([
      { value: 'USD', label: 'USD - US Dollar' },
      { value: 'EUR', label: 'EUR - Euro' },
    ])

    expect(cache.get).toHaveBeenCalledTimes(1)
    expect(cache.set).toHaveBeenCalledTimes(1)
    const [key, value, opts] = cache.set.mock.calls[0]
    expect(key).toBe('currencies:options:org=22222222-2222-4222-8222-222222222222:active=active:limit=50')
    expect(value).toEqual({ items: body.items })
    expect(opts.ttl).toBe(5 * 60_000)
    expect(opts.tags).toEqual([
      `crud:currencies.currency:tenant:${tenantId}:org:${orgId}:collection`,
    ])
  })

  it('serves the cached payload without hitting the database on a cache hit', async () => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
    const { GET } = await loadRoute()
    const cachedPayload = { items: [{ value: 'GBP', label: 'GBP - British Pound' }] }
    cache.get.mockResolvedValue(cachedPayload)

    const res = await GET(new Request('http://localhost/api/currencies/options'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual(cachedPayload)
    expect(em.find).not.toHaveBeenCalled()
    expect(cache.set).not.toHaveBeenCalled()
  })

  it('does not cache when the crud cache flag is off', async () => {
    delete process.env.ENABLE_CRUD_API_CACHE
    const { GET } = await loadRoute()
    em.find.mockResolvedValue([makeRow('USD', 'US Dollar')])

    const res = await GET(new Request('http://localhost/api/currencies/options'))

    expect(res.status).toBe(200)
    expect(cache.get).not.toHaveBeenCalled()
    expect(cache.set).not.toHaveBeenCalled()
    expect(em.find).toHaveBeenCalledTimes(1)
  })

  it('skips the cache entirely when a search term is present', async () => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
    const { GET } = await loadRoute()
    em.find.mockResolvedValue([makeRow('USD', 'US Dollar')])

    const res = await GET(new Request('http://localhost/api/currencies/options?q=us'))

    expect(res.status).toBe(200)
    expect(cache.get).not.toHaveBeenCalled()
    expect(cache.set).not.toHaveBeenCalled()
    expect(em.find).toHaveBeenCalledTimes(1)
  })

  it('keys the cache by includeInactive and limit axes', async () => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
    const { GET } = await loadRoute()
    cache.get.mockResolvedValue(null)
    em.find.mockResolvedValue([])

    await GET(
      new Request('http://localhost/api/currencies/options?includeInactive=true&limit=10'),
    )

    expect(cache.set).toHaveBeenCalledTimes(1)
    const [key] = cache.set.mock.calls[0]
    expect(key).toBe('currencies:options:org=22222222-2222-4222-8222-222222222222:active=all:limit=10')
  })
})
