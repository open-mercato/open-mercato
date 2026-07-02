/** @jest-environment node */

const mockRunWithCacheTenant = jest.fn(
  async <T>(_tenant: string | null, fn: () => Promise<T> | T) => fn(),
)
jest.mock('@open-mercato/cache', () => ({
  runWithCacheTenant: (...args: unknown[]) =>
    (mockRunWithCacheTenant as unknown as (...a: unknown[]) => unknown)(...args),
}))

let cacheEnabled = false
const mockCache = {
  get: jest.fn(),
  set: jest.fn(),
}
jest.mock('@open-mercato/shared/lib/crud/cache', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/crud/cache')
  return {
    ...actual,
    isCrudCacheEnabled: () => cacheEnabled,
    resolveCrudCache: () => (cacheEnabled ? mockCache : null),
  }
})

const mockFindWithDecryption = jest.fn()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

const mockLoadCustomFieldValues = jest.fn()
jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: (...args: unknown[]) => mockLoadCustomFieldValues(...args),
}))

const mockLogCrudAccess = jest.fn()
jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  logCrudAccess: (...args: unknown[]) => mockLogCrudAccess(...args),
  makeCrudRoute: () => ({ POST: jest.fn(), PUT: jest.fn(), DELETE: jest.fn() }),
}))

const authResult: { sub: string; tenantId: string | null; orgId: string | null } = {
  sub: 'user-1',
  tenantId: 'tenant-1',
  orgId: 'org-1',
}
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => authResult),
}))

const mockFindAndCount = jest.fn()
const mockEm = { findAndCount: (...args: unknown[]) => mockFindAndCount(...args) }
const mockRbacService = { loadAcl: jest.fn(async () => ({ isSuperAdmin: false })) }
const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    if (token === 'rbacService') return mockRbacService
    return null
  }),
}
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { GET } = require('@open-mercato/core/modules/auth/api/roles/route')

function makeRequest(query: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/auth/roles')
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
  return new Request(url.toString())
}

function primeSingleRolePage() {
  // Non-superadmin path: superadmin-acl sweep (empty) then user-role sweep (one grant).
  mockFindWithDecryption
    .mockResolvedValueOnce([]) // RoleAcl superadmin sweep
    .mockResolvedValueOnce([{ role: { id: 'role-1' } }]) // UserRole counts sweep
    .mockResolvedValueOnce([]) // Tenant names (none, role.tenantId null)
  mockFindAndCount.mockResolvedValueOnce([[{ id: 'role-1', name: 'editor', tenantId: null }], 1])
  mockLoadCustomFieldValues.mockResolvedValue({})
}

describe('GET /api/auth/roles — list cache (#2919)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    cacheEnabled = false
    authResult.tenantId = 'tenant-1'
    authResult.orgId = 'org-1'
    mockRbacService.loadAcl.mockResolvedValue({ isSuperAdmin: false })
  })

  it('does not touch the cache when the CRUD cache flag is off', async () => {
    primeSingleRolePage()

    const res = await GET(makeRequest())
    const json = await res.json()

    expect(json.items).toHaveLength(1)
    expect(json.items[0].usersCount).toBe(1)
    expect(mockCache.get).not.toHaveBeenCalled()
    expect(mockCache.set).not.toHaveBeenCalled()
  })

  it('stores the assembled payload with reused auth.role + auth.user collection tags', async () => {
    cacheEnabled = true
    mockCache.get.mockResolvedValueOnce(null)
    primeSingleRolePage()

    const res = await GET(makeRequest({ page: '1', pageSize: '50' }))
    await res.json()

    expect(mockCache.get).toHaveBeenCalledTimes(1)
    expect(mockCache.set).toHaveBeenCalledTimes(1)

    const [key, payload, options] = mockCache.set.mock.calls[0]
    expect(typeof key).toBe('string')
    expect(key).toContain('auth:roles:list')
    expect(key).toContain('tenant:tenant-1')
    expect(key).toContain('page:1')
    expect(key).toContain('size:50')
    expect(payload.total).toBe(1)

    expect(options.ttl).toBe(120_000)
    expect(options.tags).toEqual(
      expect.arrayContaining([
        'crud:auth.role:tenant:tenant-1:org:null:collection',
        'crud:auth.user:tenant:tenant-1:org:null:collection',
        'rbac:tenant:tenant-1',
      ]),
    )
  })

  it('returns the cached payload without re-running the per-role user-count sweep', async () => {
    cacheEnabled = true
    const cached = { items: [{ id: 'role-1', name: 'editor', usersCount: 7 }], total: 1, totalPages: 1, isSuperAdmin: false }
    mockCache.get.mockResolvedValueOnce(cached)

    const res = await GET(makeRequest())
    const json = await res.json()

    expect(json).toEqual(cached)
    expect(mockCache.set).not.toHaveBeenCalled()
    // A hit returns before any DB work: no role page query, no per-role user-count
    // sweep, no superadmin-acl sweep, no custom-field load.
    expect(mockFindAndCount).not.toHaveBeenCalled()
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
    expect(mockLoadCustomFieldValues).not.toHaveBeenCalled()
  })

  it('keys distinctly for different query shapes so pages do not collide', async () => {
    cacheEnabled = true
    mockCache.get.mockResolvedValue(null)

    primeSingleRolePage()
    await (await GET(makeRequest({ page: '1', pageSize: '50' }))).json()
    primeSingleRolePage()
    await (await GET(makeRequest({ page: '2', pageSize: '50' }))).json()

    const firstKey = mockCache.set.mock.calls[0][0]
    const secondKey = mockCache.set.mock.calls[1][0]
    expect(firstKey).not.toBe(secondKey)
    expect(firstKey).toContain('page:1')
    expect(secondKey).toContain('page:2')
  })
})
