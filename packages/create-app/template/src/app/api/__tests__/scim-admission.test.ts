import { createCacheService } from '@open-mercato/cache/service'
import { NextRequest } from 'next/server'
import { findApiRouteManifestMatch } from '@open-mercato/shared/modules/registry'
import { getCachedRateLimiterService } from '@open-mercato/core/bootstrap'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resetSharedApiKeyAuthCacheForTests } from '@open-mercato/shared/lib/auth/apiKeyAuthCache'
import { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'
import { ScimTokenService } from '@open-mercato/enterprise/modules/sso/services/scimTokenService'
import { ApiKey } from '@open-mercato/core/modules/api_keys/data/entities'
import type { EntityManager } from '@mikro-orm/postgresql'
import { scimTokenLookupHash } from '@open-mercato/enterprise/modules/sso/lib/scim-admission-cache'
import { ScimToken } from '@open-mercato/enterprise/modules/sso/data/entities'
import * as usersRoute from '@open-mercato/enterprise/modules/sso/api/scim/v2/Users/route'
import * as userRoute from '@open-mercato/enterprise/modules/sso/api/scim/v2/Users/[id]/route'
import * as capabilitiesRoute from '@open-mercato/enterprise/modules/sso/api/scim/v2/ServiceProviderConfig/route'
import * as dispatcher from '../[...slug]/route'

const mockCompare = jest.fn().mockResolvedValue(false)
const mockHash = jest.fn().mockResolvedValue('hashed-token')

jest.mock('bcryptjs', () => ({
  compare: (...args: unknown[]) => mockCompare(...args),
  hash: (...args: unknown[]) => mockHash(...args),
}))
jest.mock('@/bootstrap-api', () => ({ bootstrap: jest.fn() }))
jest.mock('@/.mercato/generated/api-route-shards.generated', () => ({ apiRouteFacades: [] }), { virtual: true })
jest.mock('@open-mercato/shared/modules/registry', () => ({
  findApiRouteManifestMatch: jest.fn(),
  getApiRouteManifests: () => [],
  registerApiRouteManifests: jest.fn(),
}))
jest.mock('@open-mercato/core/bootstrap', () => ({ getCachedRateLimiterService: jest.fn() }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    t: (_key: string, fallback: string) => fallback,
    translate: (_key: string, fallback: string) => fallback,
  }),
}))
jest.mock('@open-mercato/shared/lib/auth/jwt', () => ({ verifyJwt: () => null }))
jest.mock('@open-mercato/core/modules/api_keys/data/entities', () => ({ ApiKey: class {} }))
jest.mock('@open-mercato/core/modules/auth/data/entities', () => ({ Role: class {}, RoleAcl: class {}, User: class {} }))
jest.mock('@open-mercato/core/modules/directory/data/entities', () => ({ Organization: class {}, Tenant: class {} }))
jest.mock('@open-mercato/core/modules/auth/lib/sessionIntegrity', () => ({}))
jest.mock('@open-mercato/core/modules/auth/lib/authorizationStateLocks', () => ({}))
jest.mock('@open-mercato/shared/lib/encryption/kms', () => ({}))
jest.mock('@open-mercato/shared/lib/encryption/aes', () => ({}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (manager: { findOne: (...args: unknown[]) => Promise<unknown> }, ...args: unknown[]) => manager.findOne(...args),
}))
jest.mock('@open-mercato/shared/lib/commands/flush', () => ({}))
jest.mock('@open-mercato/core/modules/auth/services/rbacService', () => ({ RbacService: class {} }))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({}))
jest.mock('@open-mercato/core/modules/auth/lib/tenantAccess', () => ({}))
jest.mock('@open-mercato/cache', () => ({
  runWithCacheTenant: (_tenant: string | null, run: () => Promise<Response>) => run(),
}))
jest.mock('@open-mercato/shared/lib/modules/resource-usage', () => ({
  withModuleResourceUsage: (_options: unknown, run: () => Promise<Response>) => run(),
}))
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({ getTelemetryRuntime: () => null }))
jest.mock('@open-mercato/shared/modules/events', () => ({
  getGlobalEventBus: () => ({ emit: async () => undefined }),
}))
jest.mock('@open-mercato/enterprise/modules/sso/data/entities', () => ({ ScimToken: class {}, SsoConfig: class {} }))
jest.mock('@open-mercato/enterprise/modules/sso/services/scimService', () => ({ ScimService: class {} }))
jest.mock('@open-mercato/enterprise/modules/sso/api/error-handler', () => ({
  handleScimApiError: (error: unknown) => { throw error },
}))

const operations = [
  { name: 'list', method: 'GET', path: 'Users', route: usersRoute },
  { name: 'create', method: 'POST', path: 'Users', route: usersRoute },
  { name: 'detail', method: 'GET', path: 'Users/user-1', route: userRoute },
  { name: 'patch', method: 'PATCH', path: 'Users/user-1', route: userRoute },
  { name: 'delete', method: 'DELETE', path: 'Users/user-1', route: userRoute },
  { name: 'discovery', method: 'GET', path: 'ServiceProviderConfig', route: capabilitiesRoute },
] as const

describe('SCIM admission through the API dispatcher', () => {
  const configKeys = ['RATE_LIMIT_SCIM_POINTS', 'RATE_LIMIT_SCIM_DURATION', 'RATE_LIMIT_SCIM_BLOCK_DURATION']
  const originalConfig = Object.fromEntries(configKeys.map((key) => [key, process.env[key]]))
  const find = jest.fn()
  const findOne = jest.fn()
  const listUsers = jest.fn()
  let limiter: RateLimiterService
  let admissionCache: ReturnType<typeof createCacheService>

  beforeEach(() => {
    for (const key of configKeys) delete process.env[key]
    jest.clearAllMocks()
    jest.useFakeTimers({ now: new Date('2026-10-28T12:00:00Z') })
    resetSharedApiKeyAuthCacheForTests()
    limiter = new RateLimiterService({ enabled: true, strategy: 'memory', keyPrefix: 'dispatcher-scim', trustProxyDepth: 0 })
    jest.mocked(getCachedRateLimiterService).mockReturnValue(limiter)
    find.mockImplementation(async (entity: unknown) => entity === ApiKey ? [{ keyHash: 'known-hash' }] : [])
    findOne.mockResolvedValue(null)
    const em = { find, findOne, nativeUpdate: jest.fn().mockResolvedValue(1) } as unknown as EntityManager
    const cache = createCacheService({ strategy: 'memory' })
    admissionCache = cache
    const tokenService = new ScimTokenService(em, cache)
    jest.mocked(createRequestContainer).mockResolvedValue({
      resolve: (name: string) => {
        if (name === 'cache') return cache
        if (name === 'em') return em
        if (name === 'scimTokenService') return tokenService
        if (name === 'scimService') return { listUsers }
        throw new Error(`[internal] Unexpected dependency ${name}`)
      },
    } as Awaited<ReturnType<typeof createRequestContainer>>)
  })

  afterEach(async () => {
    await limiter.destroy()
    jest.useRealTimers()
    for (const key of configKeys) {
      const value = originalConfig[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  async function dispatch(operation: typeof operations[number], suffix: number, route: Record<string, unknown> = operation.route, kind: 'route-file' | 'legacy' = 'route-file', bearerToken = `invalid-${suffix}`) {
    jest.mocked(findApiRouteManifestMatch).mockReturnValue({
      route: { moduleId: 'sso', kind, path: `/sso/scim/v2/${operation.path}`, methods: [operation.method], load: async () => route },
      params: { id: 'user-1' },
    })
    const request = new NextRequest(`http://localhost/api/sso/scim/v2/${operation.path}`, {
      method: operation.method,
      headers: { authorization: `Bearer ${bearerToken}`, 'x-api-key': `omk_12345678.${suffix}` },
    })
    return dispatcher[operation.method](request, { params: Promise.resolve({ slug: ['sso', 'scim', 'v2', ...operation.path.split('/')] }) })
  }

  it.each(operations)('rejects $name before generic credential lookup or either bcrypt path', async (operation) => {
    for (let index = 0; index < 10; index++) {
      const fillOperation = operation.name === 'discovery' ? operation : operations[0]
      expect((await dispatch(fillOperation, index)).status).toBe(operation.name === 'discovery' ? 200 : 401)
    }
    expect(mockCompare).toHaveBeenCalledTimes(10)
    expect(mockHash).toHaveBeenCalledTimes(operation.name === 'discovery' ? 0 : 10)
    find.mockClear()
    mockCompare.mockClear()
    mockHash.mockClear()
    jest.mocked(createRequestContainer).mockClear()

    const response = await dispatch(operation, 10)

    expect(response.status).toBe(429)
    expect(response.headers.get('content-type')).toBe('application/scim+json')
    expect(response.headers.get('retry-after')).toBe('1')
    expect(find).not.toHaveBeenCalled()
    expect(mockCompare).not.toHaveBeenCalled()
    expect(mockHash).not.toHaveBeenCalled()
    expect(createRequestContainer).not.toHaveBeenCalled()
  })

  it('isolates a verified SCIM bearer from active-prefix forgeries before generic credential work', async () => {
    const rawToken = `omscim_${'a'.repeat(64)}`
    const wrongSuffix = `${rawToken.slice(0, 12)}${'c'.repeat(59)}`
    findOne.mockImplementation(async (entity: unknown) => entity === ScimToken ? null : { id: 'config-1', organizationId: 'org-1', tenantId: 'tenant-1', isActive: true, jitEnabled: false })
    find.mockImplementation(async (entity: unknown) => entity === ApiKey
      ? [{ keyHash: 'known-hash' }]
      : [{ id: 'active-token', tokenHash: 'scim-hash', ssoConfigId: 'config-1', organizationId: 'org-1', tenantId: 'tenant-1' }])
    mockCompare.mockImplementation(async (raw: string, tokenHash: string) => raw === rawToken && tokenHash === 'scim-hash')
    listUsers.mockResolvedValue({ Resources: [], totalResults: 0 })
    expect((await dispatch(operations[0], 0, usersRoute, 'route-file', rawToken)).status).toBe(200)
    jest.advanceTimersByTime(1001)
    for (let index = 0; index < 10; index++) expect((await dispatch(operations[0], index + 1, usersRoute, 'route-file', wrongSuffix)).status).toBe(401)
    find.mockClear()
    mockCompare.mockClear()
    expect((await dispatch(operations[0], 11, usersRoute, 'route-file', wrongSuffix)).status).toBe(429)
    expect(find).not.toHaveBeenCalled()
    expect(mockCompare).not.toHaveBeenCalled()
    const consume = jest.spyOn(limiter, 'consume')
    expect((await dispatch(operations[0], 12, usersRoute, 'route-file', rawToken)).status).toBe(200)
    expect(consume).toHaveBeenCalledTimes(1)
    expect(listUsers).toHaveBeenLastCalledWith(null, 1, 100, expect.objectContaining({ organizationId: 'org-1', tenantId: 'tenant-1' }), 'http://localhost')
    expect(findOne.mock.calls.filter(([entity]) => entity === ScimToken)).toHaveLength(12)
    expect(mockCompare).toHaveBeenCalledWith(rawToken, 'scim-hash')
  })

  it('admits a never-seen enrolled bearer through the dispatcher after fallback exhaustion and cache loss', async () => {
    for (let index = 0; index < 10; index++) expect((await dispatch(operations[0], index)).status).toBe(401)
    expect((await dispatch(operations[0], 10)).status).toBe(429)
    const rawToken = `omscim_${'e'.repeat(64)}`
    const tokenLookupHash = scimTokenLookupHash(rawToken)
    findOne.mockImplementation(async (entity: unknown, where: Record<string, unknown>) => entity === ScimToken
      ? where.tokenLookupHash === tokenLookupHash ? { id: 'cold-token', tenantId: 'tenant-1', organizationId: 'org-1' } : null
      : { id: 'config-1', organizationId: 'org-1', isActive: true, jitEnabled: false })
    find.mockImplementation(async (entity: unknown) => entity === ApiKey ? [{ keyHash: 'known-hash' }]
      : [{ id: 'cold-token', tokenLookupHash, tokenHash: 'scim-hash', ssoConfigId: 'config-1', organizationId: 'org-1', tenantId: 'tenant-1' }])
    mockCompare.mockImplementation(async (raw: string, tokenHash: string) => raw === rawToken && tokenHash === 'scim-hash')
    listUsers.mockResolvedValue({ Resources: [], totalResults: 0 })
    const consume = jest.spyOn(limiter, 'consume')
    expect((await dispatch(operations[0], 11, usersRoute, 'route-file', rawToken)).status).toBe(200)
    expect(consume).toHaveBeenCalledTimes(1)
    await admissionCache.clear()
    expect((await dispatch(operations[0], 12, usersRoute, 'route-file', rawToken)).status).toBe(200)
    expect(consume).toHaveBeenCalledTimes(2)
    find.mockClear()
    mockCompare.mockClear()
    expect((await dispatch(operations[0], 13, usersRoute, 'route-file', `${rawToken.slice(0, 12)}${'f'.repeat(59)}`)).status).toBe(429)
    expect(find).not.toHaveBeenCalled()
    expect(mockCompare).not.toHaveBeenCalled()
    expect(listUsers).toHaveBeenLastCalledWith(null, 1, 100, expect.objectContaining({ organizationId: 'org-1', tenantId: 'tenant-1' }), 'http://localhost')
  })

  it('charges once per request and bounds rotating generic API keys across a burst', async () => {
    const statuses: number[] = []
    for (let index = 0; index < 30; index++) statuses.push((await dispatch(operations[0], index)).status)

    expect(statuses.filter((status) => status === 401)).toHaveLength(10)
    expect(statuses.filter((status) => status === 429)).toHaveLength(20)
    expect(find.mock.calls.filter(([entity]) => entity === ApiKey)).toHaveLength(10)
    expect(mockCompare).toHaveBeenCalledTimes(10)
    expect(mockHash).toHaveBeenCalledTimes(10)
  })

  it('rejects an unavailable limiter before generic credential work', async () => {
    jest.mocked(getCachedRateLimiterService).mockReturnValue(null)

    expect((await dispatch(operations[0], 1)).status).toBe(503)
    expect(find).not.toHaveBeenCalled()
    expect(mockCompare).not.toHaveBeenCalled()
    expect(mockHash).not.toHaveBeenCalled()
  })

  it('preserves public discovery and authentication for routes without the hook', async () => {
    expect((await dispatch(operations[5], 1)).status).toBe(200)
    const handler = jest.fn(async () => Response.json({ ok: true }))

    expect((await dispatch(operations[0], 2, { GET: handler, metadata: { requireAuth: false } })).status).toBe(200)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(mockCompare).toHaveBeenCalledTimes(2)
  })

  it('still enforces required authentication after the hook admits a request', async () => {
    const handler = jest.fn(async () => Response.json({ ok: true }))
    const beforeAuth = jest.fn(async () => null)

    expect((await dispatch(operations[0], 1, { beforeAuth, GET: handler })).status).toBe(401)
    expect(beforeAuth).toHaveBeenCalledTimes(1)
    expect(beforeAuth).toHaveBeenCalledWith(expect.any(Request), { method: 'GET', params: { id: 'user-1' } })
    expect(handler).not.toHaveBeenCalled()
    expect(mockCompare).toHaveBeenCalledTimes(1)
  })

  it('does not resolve credentials or run the handler when admission throws', async () => {
    const handler = jest.fn(async () => Response.json({ ok: true }))
    const beforeAuth = async () => { throw new Error('[internal] Admission unavailable') }

    await expect(dispatch(operations[0], 1, { beforeAuth, GET: handler })).rejects.toThrow('[internal] Admission unavailable')
    expect(find).not.toHaveBeenCalled()
    expect(mockCompare).not.toHaveBeenCalled()
    expect(handler).not.toHaveBeenCalled()
  })

  it('preserves an early legacy-route response without authenticating or invoking its handler', async () => {
    const handler = jest.fn(async () => Response.json({ ok: true }))
    const beforeAuth = async () => new Response('denied', { status: 403, headers: { 'x-admission': 'closed' } })

    const response = await dispatch(operations[0], 1, { beforeAuth, default: handler }, 'legacy')

    expect(response.status).toBe(403)
    expect(response.headers.get('x-admission')).toBe('closed')
    expect(await response.text()).toBe('denied')
    expect(find).not.toHaveBeenCalled()
    expect(handler).not.toHaveBeenCalled()
  })
})
