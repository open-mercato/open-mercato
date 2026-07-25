/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const dictionaryId = '44444444-4444-4444-8444-444444444444'
const entryId = '55555555-5555-4555-8555-555555555555'

const em = {
  fork: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
}

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

const context = {
  container,
  ctx: {
    container,
    auth: { tenantId, sub: userId },
    organizationScope: null,
    selectedOrganizationId: organizationId,
    organizationIds: [organizationId],
    request: null,
  },
  auth: { tenantId, sub: userId },
  em,
  organizationId,
  tenantId,
  readableOrganizationIds: [organizationId],
  translate: (_key: string, fallback?: string) => fallback ?? 'error',
}

jest.mock('@open-mercato/core/modules/dictionaries/api/context', () => ({
  resolveDictionariesRouteContext: jest.fn(async () => context),
  resolveDictionaryActorId: jest.fn(() => userId),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (emInstance: typeof em, entity: unknown, filters: unknown, opts?: Record<string, unknown>) => {
    const hasOpts = opts && Object.keys(opts).length > 0
    return hasOpts ? emInstance.find(entity, filters, opts) : emInstance.find(entity, filters)
  },
  findOneWithDecryption: (emInstance: typeof em, entity: unknown, filters: unknown, opts?: Record<string, unknown>) => {
    const hasOpts = opts && Object.keys(opts).length > 0
    return hasOpts ? emInstance.findOne(entity, filters, opts) : emInstance.findOne(entity, filters)
  },
}))

jest.mock('@open-mercato/cache', () => ({
  runWithCacheTenant: jest.fn((_tenantId: string, fn: () => unknown) => fn()),
}))

const makeEntry = (value: string, label: string, position: number) => ({
  id: `${value}-id`,
  value,
  label,
  color: null,
  icon: null,
  position,
  isDefault: false,
  createdAt: new Date('2026-04-11T08:00:00.000Z'),
  updatedAt: new Date('2026-04-11T08:00:00.000Z'),
})

const ORIGINAL_ENV = { ...process.env }

const loadRoute = async () => {
  jest.resetModules()
  return import('../route')
}

const makeRequest = () =>
  new Request(`http://localhost/api/dictionaries/${dictionaryId}/entries`)

describe('GET /api/dictionaries/[dictionaryId]/entries caching', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...ORIGINAL_ENV }
    em.fork.mockReturnValue(em)
    em.findOne.mockResolvedValue({
      id: dictionaryId,
      organizationId,
      tenantId,
      deletedAt: null,
      entrySortMode: 'label_asc',
    })
    em.find.mockResolvedValue([
      makeEntry('a', 'Alpha', 0),
      makeEntry('b', 'Beta', 1),
    ])
  })

  afterAll(() => {
    process.env = ORIGINAL_ENV
  })

  it('caches the entries payload with command-bus-compatible tags', async () => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
    const { GET } = await loadRoute()
    cache.get.mockResolvedValue(null)

    const res = await GET(makeRequest(), { params: { dictionaryId } })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: { value: string }[] }
    expect(body.items.map((item) => item.value)).toEqual(['a', 'b'])

    expect(cache.get).toHaveBeenCalledTimes(1)
    expect(cache.set).toHaveBeenCalledTimes(1)
    const [key, value, opts] = cache.set.mock.calls[0]
    expect(key).toBe(`dictionaries:entries:${dictionaryId}:org=${organizationId}:sort=label_asc`)
    expect((value as { items: unknown[] }).items).toHaveLength(2)
    expect(opts.ttl).toBe(5 * 60_000)
    expect(opts.tags).toEqual([
      `crud:dictionaries.entry:tenant:${tenantId}:org:${organizationId}:collection`,
      `crud:dictionaries.dictionary:tenant:${tenantId}:record:${dictionaryId}`,
    ])
  })

  it('serves the cached payload without querying entries on a cache hit', async () => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
    const { GET } = await loadRoute()
    const cachedPayload = { items: [{ id: entryId, value: 'cached', label: 'Cached' }] }
    cache.get.mockResolvedValue(cachedPayload)

    const res = await GET(makeRequest(), { params: { dictionaryId } })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual(cachedPayload)
    expect(em.find).not.toHaveBeenCalled()
    expect(cache.set).not.toHaveBeenCalled()
  })

  it('does not touch the cache when the crud cache flag is off', async () => {
    delete process.env.ENABLE_CRUD_API_CACHE
    const { GET } = await loadRoute()

    const res = await GET(makeRequest(), { params: { dictionaryId } })

    expect(res.status).toBe(200)
    expect(cache.get).not.toHaveBeenCalled()
    expect(cache.set).not.toHaveBeenCalled()
    expect(em.find).toHaveBeenCalledTimes(1)
  })

  it('keys the cache by the dictionary sort mode', async () => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
    em.findOne.mockResolvedValue({
      id: dictionaryId,
      organizationId,
      tenantId,
      deletedAt: null,
      entrySortMode: 'value_asc',
    })
    const { GET } = await loadRoute()
    cache.get.mockResolvedValue(null)

    await GET(makeRequest(), { params: { dictionaryId } })

    expect(cache.set).toHaveBeenCalledTimes(1)
    const [key] = cache.set.mock.calls[0]
    expect(key).toBe(`dictionaries:entries:${dictionaryId}:org=${organizationId}:sort=value_asc`)
  })
})
