/** @jest-environment node */

import { features } from '../../acl'

const secretFixture = { secret: 'omk_test.secret', prefix: 'omk_testpref' }
const mockGetAuthFromCookies = jest.fn()
const mockResolveScope = jest.fn()
const mockEm = {
  findOne: jest.fn(),
} as any
const mockDataEngine = {
  createOrmEntity: jest.fn(),
  emitOrmEntityEvent: jest.fn(),
} as any
const mockRbac = {
  invalidateUserCache: jest.fn(),
}
const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    if (token === 'dataEngine') return mockDataEngine
    if (token === 'rbacService') return mockRbac
    return undefined
  }),
}
const mockHashApiKey = jest.fn((secret: string) => `hashed:${secret}`)

jest.mock('@/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@/lib/auth/server', () => ({
  getAuthFromCookies: jest.fn(() => mockGetAuthFromCookies()),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn((args) => mockResolveScope(args)),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback: string) => fallback,
  })),
}))

jest.mock('../../services/apiKeyService', () => {
  const actual = jest.requireActual('../../services/apiKeyService')
  return {
    ...actual,
    generateApiKeySecret: jest.fn(() => secretFixture),
    hashApiKey: jest.fn((secret: string) => mockHashApiKey(secret)),
  }
})

const routeModule = require('../keys/route') as typeof import('../keys/route')
const { metadata, POST } = routeModule

describe('API Keys route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthFromCookies.mockResolvedValue({
      sub: 'user-1',
      tenantId: '123e4567-e89b-12d3-a456-426614174000',
      orgId: null,
    })
    mockResolveScope.mockResolvedValue({
      selectedId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      filterIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
      allowedIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
    })
    mockEm.findOne.mockImplementation(async (_entity, criteria) => {
      if ('name' in criteria && criteria.name === 'manager') {
        return {
          id: 'role-123',
          name: 'Manager',
          tenantId: '123e4567-e89b-12d3-a456-426614174000',
        }
      }
      return null
    })
    mockDataEngine.createOrmEntity.mockImplementation(async ({ data }) => ({
      id: 'key-1',
      ...data,
    }))
    mockDataEngine.emitOrmEntityEvent.mockResolvedValue(undefined)
    mockRbac.invalidateUserCache.mockResolvedValue(undefined)
    mockHashApiKey.mockClear()
  })

  it('exports the expected ACL features', () => {
    const featureIds = features.map((entry: any) => (typeof entry === 'string' ? entry : entry.id))
    expect(featureIds).toEqual(expect.arrayContaining(['api_keys.view', 'api_keys.create', 'api_keys.delete']))
  })

  it('declares authorization metadata for GET/POST/DELETE', () => {
    expect(metadata.GET?.requireAuth).toBe(true)
    expect(metadata.GET?.requireFeatures).toEqual(['api_keys.view'])
    expect(metadata.POST?.requireAuth).toBe(true)
    expect(metadata.POST?.requireFeatures).toEqual(['api_keys.create'])
    expect(metadata.DELETE?.requireAuth).toBe(true)
    expect(metadata.DELETE?.requireFeatures).toEqual(['api_keys.delete'])
  })

  it('creates API keys with organization scope, hashed secret, and role mapping', async () => {
    const body = {
      name: 'Integration key',
      description: 'Machine access',
      roles: ['manager'],
    }
    const res = await POST(
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

  it('rejects creation when organization is outside the allowed scope', async () => {
    mockResolveScope.mockResolvedValueOnce({
      selectedId: null,
      filterIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
      allowedIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
    })
    const res = await POST(
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
})
