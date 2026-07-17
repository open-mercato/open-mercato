/** @jest-environment node */

import { features } from '../../acl'
import { RoleAcl } from '@open-mercato/core/modules/auth/data/entities'

const secretFixture = { secret: 'omk_test.secret', prefix: 'omk_testpref' }

type QueueEntry = { entity?: unknown }
type OrmEntityInput = { data: Record<string, unknown>; [key: string]: unknown }
type DeleteOrmEntityInput = { where: Record<string, unknown>; [key: string]: unknown }

interface MockEntityManager {
  findOne: jest.Mock<Promise<unknown>, [unknown, Record<string, unknown>?]>
  find: jest.Mock<Promise<unknown[]>, [unknown, Record<string, unknown>?]>
  fork: jest.Mock<MockEntityManager, []>
  transactional: jest.Mock<Promise<unknown>, [(em: MockEntityManager) => Promise<unknown>]>
}

interface MockDataEngine {
  __queue: QueueEntry[]
  createOrmEntity: jest.Mock<Promise<Record<string, unknown>>, [OrmEntityInput]>
  deleteOrmEntity: jest.Mock<Promise<Record<string, unknown> | null>, [DeleteOrmEntityInput]>
  emitOrmEntityEvent: jest.Mock<Promise<void>, [QueueEntry | undefined]>
  markOrmEntityChange: jest.Mock<void, [QueueEntry | undefined]>
  flushOrmEntityChanges: jest.Mock<Promise<void>, []>
}

type MockAcl = { isSuperAdmin: boolean; features?: string[]; organizations?: string[] | null }

interface MockRbacService {
  invalidateUserCache: jest.Mock<Promise<void>, [string]>
  loadAcl: jest.Mock<Promise<MockAcl | null>, [string, { tenantId: string | null; organizationId: string | null }]>
}

interface MockContainer {
  resolve: jest.Mock<unknown, [string]>
}

const queue: QueueEntry[] = []

const mockGetAuthFromCookies = jest.fn()
const mockGetAuthFromRequest = jest.fn()
const mockResolveScope = jest.fn()
const mockEm: MockEntityManager = {
  findOne: jest.fn<Promise<unknown>, [unknown, Record<string, unknown>?]>(),
  find: jest.fn<Promise<unknown[]>, [unknown, Record<string, unknown>?]>(),
  fork: jest.fn<MockEntityManager, []>(),
  transactional: jest.fn<Promise<unknown>, [(em: MockEntityManager) => Promise<unknown>]>(
    async (fn) => fn(mockEm),
  ),
}
const mockDataEngine: MockDataEngine = {
  __queue: queue,
  createOrmEntity: jest.fn<Promise<Record<string, unknown>>, [OrmEntityInput]>(),
  deleteOrmEntity: jest.fn<Promise<Record<string, unknown> | null>, [DeleteOrmEntityInput]>(),
  emitOrmEntityEvent: jest.fn<Promise<void>, [QueueEntry | undefined]>(),
  markOrmEntityChange: jest.fn<void, [QueueEntry | undefined]>(),
  flushOrmEntityChanges: jest.fn<Promise<void>, []>(),
}
const mockFindOneWithDecryption = jest.fn()
const mockRbac: MockRbacService = {
  invalidateUserCache: jest.fn<Promise<void>, [string]>(),
  loadAcl: jest.fn<Promise<MockAcl | null>, [string, { tenantId: string | null; organizationId: string | null }]>(),
}
const mockContainer: MockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    if (token === 'dataEngine') return mockDataEngine
    if (token === 'rbacService') return mockRbac
    return undefined
  }),
}
const mockHashApiKey = jest.fn<Promise<string>, [string]>((secret) => Promise.resolve(`hashed:${secret}`))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromCookies: jest.fn(() => mockGetAuthFromCookies()),
  getAuthFromRequest: jest.fn((request: Request) => mockGetAuthFromRequest(request)),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn((args) => mockResolveScope(args)),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback: string) => fallback,
  })),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn((...args: unknown[]) => mockFindOneWithDecryption(...args)),
}))

jest.mock('../../services/apiKeyService', () => {
  const actual = jest.requireActual('../../services/apiKeyService')
  return {
    ...actual,
    generateApiKeySecret: jest.fn(() => secretFixture),
    hashApiKey: jest.fn((secret: string) => mockHashApiKey(secret)),
  }
})

type RouteModule = typeof import('../keys/route')
let routeMetadata: RouteModule['metadata']
let postHandler: RouteModule['POST']
let deleteHandler: RouteModule['DELETE']

beforeAll(async () => {
  const routeModule = await import('../keys/route')
  routeMetadata = routeModule.metadata
  postHandler = routeModule.POST
  deleteHandler = routeModule.DELETE
})

describe('API Keys route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockDataEngine.__queue.length = 0
    mockFindOneWithDecryption.mockReset()
    mockFindOneWithDecryption.mockResolvedValue(null)
    mockEm.fork.mockReturnValue(mockEm)
    mockEm.transactional.mockImplementation((cb) => cb(mockEm))
    mockGetAuthFromCookies.mockResolvedValue({
      sub: 'user-1',
      tenantId: '123e4567-e89b-12d3-a456-426614174000',
      orgId: null,
    })
    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      tenantId: '123e4567-e89b-12d3-a456-426614174000',
      orgId: null,
    })
    mockResolveScope.mockResolvedValue({
      selectedId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      filterIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
      allowedIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
    })
    mockEm.findOne.mockResolvedValue(null)
    mockEm.find.mockImplementation(async (_entity: unknown, criteria: Record<string, unknown> = {}) => {
      const nameValue = typeof criteria.name === 'string' ? criteria.name : null
      if (nameValue && nameValue.toLowerCase() === 'manager') {
        return [
          {
            id: 'role-123',
            name: 'Manager',
            tenantId: '123e4567-e89b-12d3-a456-426614174000',
          },
        ]
      }
      if (criteria && typeof criteria === 'object' && 'id' in criteria) {
        const idCandidate = (criteria as { id?: unknown }).id
        if (idCandidate && typeof idCandidate === 'object' && '$in' in idCandidate) {
          const ids = (idCandidate as { $in?: unknown }).$in
          if (Array.isArray(ids)) {
            return ids.map((id) => ({
              id: String(id),
              name: id === 'role-123' ? 'Manager' : null,
              tenantId: '123e4567-e89b-12d3-a456-426614174000',
            }))
          }
        }
      }
      return []
    })
    mockDataEngine.createOrmEntity.mockImplementation(async ({ data }: OrmEntityInput) => ({
      id: 'key-1',
      ...data,
    }))
    mockDataEngine.deleteOrmEntity.mockResolvedValue(null)
    mockDataEngine.emitOrmEntityEvent.mockResolvedValue(undefined)
    mockDataEngine.markOrmEntityChange.mockImplementation((entry: QueueEntry | undefined) => {
      if (!entry?.entity) return
      mockDataEngine.__queue.push(entry)
    })
    mockDataEngine.flushOrmEntityChanges.mockImplementation(async () => {
      while (mockDataEngine.__queue.length > 0) {
        const next = mockDataEngine.__queue.shift()
        await mockDataEngine.emitOrmEntityEvent(next)
      }
    })
    mockRbac.invalidateUserCache.mockResolvedValue(undefined)
    mockRbac.loadAcl.mockResolvedValue({ isSuperAdmin: false })
    mockHashApiKey.mockClear()
  })

  it('exports the expected ACL features', () => {
    const featureIds = features.map((entry) => entry.id)
    expect(featureIds).toEqual(expect.arrayContaining(['api_keys.view', 'api_keys.create', 'api_keys.delete']))
  })

  it('declares authorization metadata for GET/POST/DELETE', () => {
    expect(routeMetadata.GET?.requireAuth).toBe(true)
    expect(routeMetadata.GET?.requireFeatures).toEqual(['api_keys.view'])
    expect(routeMetadata.POST?.requireAuth).toBe(true)
    expect(routeMetadata.POST?.requireFeatures).toEqual(['api_keys.create'])
    expect(routeMetadata.DELETE?.requireAuth).toBe(true)
    expect(routeMetadata.DELETE?.requireFeatures).toEqual(['api_keys.delete'])
  })

  it('creates API keys with organization scope, hashed secret, and role mapping', async () => {
    const body = {
      name: 'Integration key',
      description: 'Machine access',
      roles: ['manager'],
    }
    const res = await postHandler(
      new Request('http://localhost/api/api_keys/keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    )
    expect(res.status).toBe(201)
    const payload = await res.json()
    expect(payload).toMatchObject({
      id: 'key-1',
      name: 'Integration key',
      keyPrefix: secretFixture.prefix,
      secret: secretFixture.secret,
      organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      tenantId: '123e4567-e89b-12d3-a456-426614174000',
    })
    expect(payload.roles).toEqual([{ id: 'role-123', name: 'Manager' }])
    expect(mockDataEngine.createOrmEntity).toHaveBeenCalledTimes(1)
    const createArgs = mockDataEngine.createOrmEntity.mock.calls[0][0]
    expect(createArgs.data).toMatchObject({
      name: 'Integration key',
      description: 'Machine access',
      organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      tenantId: '123e4567-e89b-12d3-a456-426614174000',
      createdBy: 'user-1',
      rolesJson: ['role-123'],
      keyPrefix: secretFixture.prefix,
      keyHash: `hashed:${secretFixture.secret}`,
    })
    expect(mockHashApiKey).toHaveBeenCalledWith(secretFixture.secret)
    expect(mockRbac.invalidateUserCache).toHaveBeenCalledWith('api_key:key-1')
  })

  it('rejects role-backed API keys when the requested role grants features outside the actor ACL', async () => {
    mockRbac.loadAcl.mockResolvedValueOnce({
      isSuperAdmin: false,
      features: ['api_keys.create'],
    })
    mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown) => {
      if (entity === RoleAcl) {
        return {
          isSuperAdmin: false,
          featuresJson: ['auth.*'],
          organizationsJson: null,
          tenantId: '123e4567-e89b-12d3-a456-426614174000',
        }
      }
      return null
    })

    const res = await postHandler(
      new Request('http://localhost/api/api_keys/keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Escalating key',
          roles: ['manager'],
        }),
      }),
    )
    const payload = await res.json()

    expect(res.status).toBe(403)
    expect(payload.error).toContain('Cannot grant feature wildcard auth.*')
    expect(mockDataEngine.createOrmEntity).not.toHaveBeenCalled()
  })

  it('rejects creation when organization is outside the allowed scope', async () => {
    mockResolveScope.mockResolvedValueOnce({
      selectedId: null,
      filterIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
      allowedIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
    })
    const res = await postHandler(
      new Request('http://localhost/api/api_keys/keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Forbidden key',
          organizationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        }),
      }),
    )
    expect(res.status).toBe(403)
    const payload = await res.json()
    expect(payload.error).toBe('Organization out of scope')
    expect(mockDataEngine.createOrmEntity).not.toHaveBeenCalled()
  })

  it('denies deletion when the resolved organization allowlist is empty', async () => {
    const record = {
      id: '11111111-1111-4111-8111-111111111111',
      tenantId: '123e4567-e89b-12d3-a456-426614174000',
      organizationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      deletedAt: null,
    }
    mockResolveScope.mockResolvedValueOnce({ selectedId: null, filterIds: [], allowedIds: [] })
    mockEm.findOne.mockResolvedValueOnce(record)
    mockFindOneWithDecryption.mockResolvedValueOnce(record)
    mockDataEngine.deleteOrmEntity.mockResolvedValueOnce(record)

    const response = await deleteHandler(
      new Request('http://localhost/api/api_keys/keys?id=11111111-1111-4111-8111-111111111111', { method: 'DELETE' }),
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Not found' })
    expect(mockFindOneWithDecryption).toHaveBeenCalledWith(
      mockEm,
      expect.any(Function),
      {
        id: '11111111-1111-4111-8111-111111111111',
        tenantId: '123e4567-e89b-12d3-a456-426614174000',
        organizationId: { $in: [] },
        deletedAt: null,
      },
      undefined,
      { tenantId: '123e4567-e89b-12d3-a456-426614174000', organizationId: null },
    )
    expect(mockDataEngine.deleteOrmEntity).not.toHaveBeenCalled()
  })

  it('deletes an API key in an allowed organization', async () => {
    const record = {
      id: '22222222-2222-4222-8222-222222222222',
      tenantId: '123e4567-e89b-12d3-a456-426614174000',
      organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      deletedAt: null,
    }
    mockEm.findOne.mockResolvedValueOnce(record)
    mockFindOneWithDecryption.mockResolvedValueOnce(record)
    mockDataEngine.deleteOrmEntity.mockResolvedValueOnce(record)

    const response = await deleteHandler(
      new Request('http://localhost/api/api_keys/keys?id=22222222-2222-4222-8222-222222222222', { method: 'DELETE' }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
    expect(mockDataEngine.deleteOrmEntity).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: '22222222-2222-4222-8222-222222222222',
        tenantId: '123e4567-e89b-12d3-a456-426614174000',
        deletedAt: null,
      },
    }))
  })

  it('returns the same not-found response for a foreign organization without mutation', async () => {
    const record = {
      id: '33333333-3333-4333-8333-333333333333',
      tenantId: '123e4567-e89b-12d3-a456-426614174000',
      organizationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      deletedAt: null,
    }
    mockEm.findOne.mockResolvedValueOnce(record)
    mockFindOneWithDecryption.mockResolvedValueOnce(record)

    const response = await deleteHandler(
      new Request('http://localhost/api/api_keys/keys?id=33333333-3333-4333-8333-333333333333', { method: 'DELETE' }),
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Not found' })
    expect(mockDataEngine.deleteOrmEntity).not.toHaveBeenCalled()
  })

  it('allows a superadmin to delete across organizations', async () => {
    const record = {
      id: '44444444-4444-4444-8444-444444444444',
      tenantId: '123e4567-e89b-12d3-a456-426614174000',
      organizationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      deletedAt: null,
    }
    mockResolveScope.mockResolvedValueOnce({ selectedId: null, filterIds: [], allowedIds: [] })
    mockRbac.loadAcl.mockResolvedValueOnce({ isSuperAdmin: true })
    mockEm.findOne.mockResolvedValueOnce(record)
    mockFindOneWithDecryption.mockResolvedValueOnce(record)
    mockDataEngine.deleteOrmEntity.mockResolvedValueOnce(record)

    const response = await deleteHandler(
      new Request('http://localhost/api/api_keys/keys?id=44444444-4444-4444-8444-444444444444', { method: 'DELETE' }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
    expect(mockDataEngine.deleteOrmEntity).toHaveBeenCalledTimes(1)
  })

  it('preserves unrestricted legacy organization access for a non-superadmin', async () => {
    const record = {
      id: '77777777-7777-4777-8777-777777777777',
      tenantId: '123e4567-e89b-12d3-a456-426614174000',
      organizationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      deletedAt: null,
    }
    mockResolveScope.mockResolvedValueOnce({ selectedId: null, filterIds: null, allowedIds: null })
    mockEm.findOne.mockResolvedValueOnce(record)
    mockFindOneWithDecryption.mockResolvedValueOnce(record)
    mockDataEngine.deleteOrmEntity.mockResolvedValueOnce(record)

    const response = await deleteHandler(
      new Request('http://localhost/api/api_keys/keys?id=77777777-7777-4777-8777-777777777777', { method: 'DELETE' }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
    expect(mockDataEngine.deleteOrmEntity).toHaveBeenCalledTimes(1)
  })

  it('preserves a superadmin selected-tenant override for lookup and deletion', async () => {
    const selectedTenantId = '223e4567-e89b-12d3-a456-426614174000'
    const overriddenAuth = {
      sub: 'user-1',
      tenantId: selectedTenantId,
      actorTenantId: '123e4567-e89b-12d3-a456-426614174000',
      orgId: null,
      isSuperAdmin: true,
    }
    const record = {
      id: '88888888-8888-4888-8888-888888888888',
      tenantId: selectedTenantId,
      organizationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      deletedAt: null,
    }
    mockGetAuthFromCookies.mockResolvedValueOnce(overriddenAuth)
    mockGetAuthFromRequest.mockResolvedValueOnce(overriddenAuth)
    mockResolveScope.mockResolvedValueOnce({
      selectedId: record.organizationId,
      filterIds: [record.organizationId],
      allowedIds: null,
      tenantId: selectedTenantId,
    })
    mockRbac.loadAcl.mockResolvedValueOnce({ isSuperAdmin: true })
    mockEm.findOne.mockResolvedValueOnce(record)
    mockFindOneWithDecryption.mockResolvedValueOnce(record)
    mockDataEngine.deleteOrmEntity.mockResolvedValueOnce(record)

    const response = await deleteHandler(
      new Request('http://localhost/api/api_keys/keys?id=88888888-8888-4888-8888-888888888888', { method: 'DELETE' }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
    expect(mockFindOneWithDecryption).toHaveBeenCalledWith(
      mockEm,
      expect.any(Function),
      {
        id: record.id,
        tenantId: selectedTenantId,
        deletedAt: null,
      },
      undefined,
      { tenantId: selectedTenantId, organizationId: null },
    )
    expect(mockDataEngine.deleteOrmEntity).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: record.id,
        tenantId: selectedTenantId,
        deletedAt: null,
      },
    }))
  })

  it('does not enumerate or mutate an API key from another tenant', async () => {
    const record = {
      id: '55555555-5555-4555-8555-555555555555',
      tenantId: '223e4567-e89b-12d3-a456-426614174000',
      organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      deletedAt: null,
    }
    mockEm.findOne.mockResolvedValueOnce(record)
    mockFindOneWithDecryption.mockResolvedValueOnce(record)

    const response = await deleteHandler(
      new Request('http://localhost/api/api_keys/keys?id=55555555-5555-4555-8555-555555555555', { method: 'DELETE' }),
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Not found' })
    expect(mockDataEngine.deleteOrmEntity).not.toHaveBeenCalled()
  })

  it('returns not found for an unknown API key without mutation', async () => {
    const response = await deleteHandler(
      new Request('http://localhost/api/api_keys/keys?id=66666666-6666-4666-8666-666666666666', { method: 'DELETE' }),
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Not found' })
    expect(mockDataEngine.deleteOrmEntity).not.toHaveBeenCalled()
  })
})
