/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const dictionaryId = '44444444-4444-4444-8444-444444444444'

const em = {
  fork: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
  count: jest.fn(),
}

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
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
  findWithDecryption: (emInstance: typeof em, entity: unknown, filters: unknown, opts?: Record<string, unknown>) =>
    emInstance.find(entity, filters, opts),
  findOneWithDecryption: (emInstance: typeof em, entity: unknown, filters: unknown, opts?: Record<string, unknown>) =>
    emInstance.findOne(entity, filters, opts),
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

const makeRequest = (search = '') =>
  new Request(`http://localhost/api/dictionaries/${dictionaryId}/entries${search}`)

const findOptions = () => em.find.mock.calls[0][2] as { limit?: number; offset?: number; orderBy?: unknown }

describe('GET /api/dictionaries/[dictionaryId]/entries pagination', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...ORIGINAL_ENV }
    delete process.env.ENABLE_CRUD_API_CACHE
    em.fork.mockReturnValue(em)
    em.findOne.mockResolvedValue({
      id: dictionaryId,
      organizationId,
      tenantId,
      deletedAt: null,
      entrySortMode: 'label_asc',
    })
    em.find.mockResolvedValue([makeEntry('a', 'Alpha', 0), makeEntry('b', 'Beta', 1)])
    em.count.mockResolvedValue(2)
  })

  afterAll(() => {
    process.env = ORIGINAL_ENV
  })

  it('bounds the entry query with the default page size instead of fetching every row', async () => {
    const { GET } = await loadRoute()

    const res = await GET(makeRequest(), { params: { dictionaryId } })

    expect(res.status).toBe(200)
    expect(findOptions().limit).toBe(500)
    expect(findOptions().offset).toBe(0)
    expect(findOptions().orderBy).toEqual({ position: 'asc', id: 'asc' })
  })

  it('reports the total and hasMore so truncation is observable', async () => {
    em.count.mockResolvedValue(1200)
    const { GET } = await loadRoute()

    const res = await GET(makeRequest(), { params: { dictionaryId } })

    const body = (await res.json()) as { total: number; limit: number; offset: number; hasMore: boolean }
    expect(body.total).toBe(1200)
    expect(body.limit).toBe(500)
    expect(body.offset).toBe(0)
    expect(body.hasMore).toBe(true)
  })

  it('honors an explicit limit and offset', async () => {
    em.count.mockResolvedValue(10)
    const { GET } = await loadRoute()

    const res = await GET(makeRequest('?limit=2&offset=8'), { params: { dictionaryId } })

    expect(res.status).toBe(200)
    expect(findOptions().limit).toBe(2)
    expect(findOptions().offset).toBe(8)
    const body = (await res.json()) as { hasMore: boolean }
    expect(body.hasMore).toBe(false)
  })

  it('clamps an oversized limit to the hard ceiling', async () => {
    const { GET } = await loadRoute()

    await GET(makeRequest('?limit=100000'), { params: { dictionaryId } })

    expect(findOptions().limit).toBe(500)
  })

  it('falls back to the defaults for malformed pagination input', async () => {
    const { GET } = await loadRoute()

    await GET(makeRequest('?limit=abc&offset=-5'), { params: { dictionaryId } })

    expect(findOptions().limit).toBe(500)
    expect(findOptions().offset).toBe(0)
  })

  it('keys the cache by the requested page', async () => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
    const cache = { get: jest.fn().mockResolvedValue(null), set: jest.fn() }
    container.resolve.mockImplementation((name: string) => {
      if (name === 'em') return em
      if (name === 'cache') return cache
      throw new Error(`Unexpected container resolve: ${name}`)
    })
    const { GET } = await loadRoute()

    await GET(makeRequest('?limit=25&offset=50'), { params: { dictionaryId } })

    expect(cache.set).toHaveBeenCalledTimes(1)
    const [key] = cache.set.mock.calls[0]
    expect(key).toBe(
      `dictionaries:entries:${dictionaryId}:org=${organizationId}:sort=label_asc:limit=25:offset=50`,
    )
  })
})
