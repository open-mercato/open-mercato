import { createCacheService } from '@open-mercato/cache'
import type { CacheStrategy } from '@open-mercato/cache'
import { getCachedRateLimiterService } from '@open-mercato/core/bootstrap'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'
import { ScimTokenService } from '../../../services/scimTokenService'
import type { EntityManager } from '@mikro-orm/postgresql'
import { ScimToken } from '../../../data/entities'
import { scimTokenLookupHash } from '../../../lib/scim-admission-cache'
import { checkScimRateLimit } from '../rate-limit'
import { GET as listUsers, POST as createUser } from '../v2/Users/route'
import { GET as getUser, PATCH as patchUser, DELETE as deleteUser } from '../v2/Users/[id]/route'
import { GET as getCapabilities } from '../v2/ServiceProviderConfig/route'

const mockHash = jest.fn().mockResolvedValue('hashed-token')
const mockCompare = jest.fn().mockResolvedValue(false)
const mockReportError = jest.fn()

jest.mock('bcryptjs', () => ({
  hash: (...args: unknown[]) => mockHash(...args),
  compare: (...args: unknown[]) => mockCompare(...args),
}))
jest.mock('@open-mercato/core/bootstrap', () => ({ getCachedRateLimiterService: jest.fn() }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (manager: { findOne: (...args: unknown[]) => Promise<unknown> }, ...args: unknown[]) => manager.findOne(...args),
}))
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: mockReportError }),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))
jest.mock('../../../data/entities', () => ({ ScimToken: class {}, SsoConfig: class {} }))
jest.mock('../../../services/scimService', () => ({ ScimService: class {} }))
jest.mock('../../error-handler', () => ({
  handleScimApiError: (error: unknown) => { throw error },
}))

const routeContext = { params: Promise.resolve({ id: 'scim-user-1' }) }
const operations = [
  { name: 'list users', method: 'GET', path: 'Users', run: (req: Request) => listUsers(req) },
  { name: 'create user', method: 'POST', path: 'Users', run: (req: Request) => createUser(req) },
  { name: 'get user', method: 'GET', path: 'Users/scim-user-1', run: (req: Request) => getUser(req, routeContext) },
  { name: 'patch user', method: 'PATCH', path: 'Users/scim-user-1', run: (req: Request) => patchUser(req, routeContext) },
  { name: 'delete user', method: 'DELETE', path: 'Users/scim-user-1', run: (req: Request) => deleteUser(req, routeContext) },
  { name: 'capabilities', method: 'GET', path: 'ServiceProviderConfig', run: (req: Request) => getCapabilities(req) },
]

function request(method = 'GET', path = 'Users', headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost/api/sso/scim/v2/${path}`, {
    method,
    headers: { authorization: 'Bearer random-invalid-token', ...headers },
  })
}

describe('SCIM pre-verification rate limit', () => {
  const configKeys = ['RATE_LIMIT_SCIM_POINTS', 'RATE_LIMIT_SCIM_DURATION', 'RATE_LIMIT_SCIM_BLOCK_DURATION', 'RATE_LIMIT_ENABLED', 'OM_INTEGRATION_TEST']
  const originalConfig = Object.fromEntries(configKeys.map((key) => [key, process.env[key]]))
  let limiter: RateLimiterService
  let cache: CacheStrategy
  const find = jest.fn()
  const findOne = jest.fn()
  const provisioningService = {
    createUser: jest.fn(),
    listUsers: jest.fn(),
    getUser: jest.fn(),
    patchUser: jest.fn(),
    deleteUser: jest.fn(),
  }

  beforeEach(() => {
    for (const key of configKeys) delete process.env[key]
    jest.clearAllMocks()
    mockReportError.mockReset()
    jest.useFakeTimers({ now: new Date('2026-10-27T12:00:00Z') })
    limiter = new RateLimiterService({ enabled: true, strategy: 'memory', keyPrefix: 'test-scim', trustProxyDepth: 0 })
    jest.mocked(getCachedRateLimiterService).mockReturnValue(limiter)
    const em = { find, findOne, nativeUpdate: jest.fn().mockResolvedValue(1) } as unknown as EntityManager
    cache = createCacheService({ strategy: 'memory' })
    const tokenService = new ScimTokenService(em, cache)
    jest.mocked(createRequestContainer).mockResolvedValue({
      resolve: (name: string) => {
        if (name === 'cache') return cache
        if (name === 'scimTokenService') return tokenService
        if (name === 'scimService') return provisioningService
        if (name === 'em') return em
        throw new Error(`[internal] Unexpected service ${name}`)
      },
    } as Awaited<ReturnType<typeof createRequestContainer>>)
    find.mockResolvedValue([])
    findOne.mockImplementation(async (entity: unknown) => entity === ScimToken ? null : { id: 'config-1', organizationId: 'org-1', tenantId: 'tenant-1', isActive: true, jitEnabled: false })
    mockCompare.mockResolvedValue(false)
  })

  afterEach(async () => {
    await limiter.destroy()
    jest.useRealTimers()
    for (const key of configKeys) {
      const originalValue = originalConfig[key]
      if (originalValue === undefined) delete process.env[key]
      else process.env[key] = originalValue
    }
  })

  it.each(operations.filter((operation) => operation.name !== 'capabilities'))('blocks $name before further bcrypt or provisioning work', async ({ method, path, run }) => {
    for (let index = 0; index < 10; index++) {
      const response = await listUsers(request('GET', 'Users', { authorization: `Bearer invalid-${index}` }))
      expect(response.status).toBe(401)
    }

    const response = await run(request(method, path))

    expect(response.status).toBe(429)
    expect(response.headers.get('content-type')).toBe('application/scim+json')
    expect(response.headers.get('retry-after')).toBe('1')
    expect(response.headers.get('x-ratelimit-limit')).toBe('10')
    expect(await response.json()).toEqual(expect.objectContaining({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], status: '429',
    }))
    expect(mockHash).toHaveBeenCalledTimes(10)
    expect(mockHash).toHaveBeenLastCalledWith('invalid-9', 10)
    expect(mockCompare).not.toHaveBeenCalled()
    expect(find).toHaveBeenCalledTimes(10)
    expect(provisioningService.createUser).not.toHaveBeenCalled()
    expect(provisioningService.listUsers).not.toHaveBeenCalled()
    expect(provisioningService.getUser).not.toHaveBeenCalled()
    expect(provisioningService.patchUser).not.toHaveBeenCalled()
    expect(provisioningService.deleteUser).not.toHaveBeenCalled()
  })

  it('isolates discovery and ignores spoofed forwarding headers without proxy trust', async () => {
    for (let index = 0; index < 10; index++) {
      const response = await getCapabilities(request('GET', 'ServiceProviderConfig', { 'x-forwarded-for': `192.0.2.${index}` }))
      expect(response.status).toBe(200)
    }

    const response = await getCapabilities(request('GET', 'ServiceProviderConfig', { 'x-real-ip': '198.51.100.1' }))

    expect(response.status).toBe(429)
    expect(mockHash).not.toHaveBeenCalled()
    expect(createRequestContainer).not.toHaveBeenCalled()
    expect((await listUsers(request())).status).toBe(401)
  })

  it('admits an active token after anonymous discovery exhausts its separate default bucket', async () => {
    const rawToken = `omscim_${'a'.repeat(64)}`
    findOne.mockImplementation(async (entity: unknown) => entity === ScimToken
      ? { id: 'token-1', tenantId: 'tenant-1', organizationId: 'org-1' }
      : { id: 'config-1', organizationId: 'org-1', tenantId: 'tenant-1', isActive: true, jitEnabled: false })
    find.mockResolvedValue([{ id: 'token-1', tokenHash: 'stored-hash', ssoConfigId: 'config-1', organizationId: 'org-1', tenantId: 'tenant-1' }])
    mockCompare.mockResolvedValue(true)
    provisioningService.listUsers.mockResolvedValue({ Resources: [], totalResults: 0 })
    for (let index = 0; index < 10; index++) {
      expect((await getCapabilities(request('GET', 'ServiceProviderConfig', { authorization: '' }))).status).toBe(200)
    }
    expect((await getCapabilities(request('GET', 'ServiceProviderConfig', { authorization: '' }))).status).toBe(429)

    const response = await listUsers(request('GET', 'Users', { authorization: `Bearer ${rawToken}` }))

    expect(response.status).toBe(200)
    expect(provisioningService.listUsers).toHaveBeenCalledWith(null, 1, 100, expect.objectContaining({ tenantId: 'tenant-1', organizationId: 'org-1' }), 'http://localhost')
    expect(mockCompare).toHaveBeenCalledWith(rawToken, 'stored-hash')
  })

  it.each([0, 1])('keeps active-prefix forgeries in the unverified budget and isolates verified tokens at proxy depth %i', async (trustProxyDepth) => {
    limiter = new RateLimiterService({ enabled: true, strategy: 'memory', keyPrefix: 'test-scim', trustProxyDepth })
    jest.mocked(getCachedRateLimiterService).mockReturnValue(limiter)
    const rawToken = `omscim_${'a'.repeat(64)}`
    const otherToken = `omscim_${'b'.repeat(64)}`
    const wrongSuffix = `${rawToken.slice(0, 12)}${'c'.repeat(59)}`
    const headers = { 'x-forwarded-for': '198.51.100.1' }
    find.mockImplementation(async (_entity: unknown, where: Record<string, unknown>) => {
      const scopeNumber = where.tokenPrefix === otherToken.slice(0, 12) ? 2 : 1
      return [{ id: `token-${scopeNumber}`, tokenHash: 'stored-hash', ssoConfigId: `config-${scopeNumber}`, organizationId: `org-${scopeNumber}`, tenantId: `tenant-${scopeNumber}` }]
    })
    findOne.mockImplementation(async (entity: unknown, where: Record<string, unknown>) => entity === ScimToken ? null : ({ id: where.id, organizationId: where.organizationId, isActive: true, jitEnabled: false }))
    mockCompare.mockImplementation(async (raw: string) => raw === rawToken || raw === otherToken)
    provisioningService.listUsers.mockResolvedValue({ Resources: [], totalResults: 0 })
    const call = (token: string) => listUsers(request('GET', 'Users', { ...headers, authorization: `Bearer ${token}` }))
    expect((await call(rawToken)).status).toBe(200)
    expect((await call(otherToken)).status).toBe(200)
    jest.advanceTimersByTime(1001)
    const consume = jest.spyOn(limiter, 'consume')
    for (let index = 0; index < 10; index++) expect((await call(`unknown-${index}`)).status).toBe(401)
    const comparesBeforeRejection = mockCompare.mock.calls.length
    expect((await call(wrongSuffix)).status).toBe(429)
    expect((await call(`omscim_${'d'.repeat(64)}`)).status).toBe(429)
    expect(mockCompare).toHaveBeenCalledTimes(comparesBeforeRejection)
    for (let index = 0; index < 10; index++) expect((await call(rawToken)).status).toBe(200)
    expect((await call(rawToken)).status).toBe(429)
    expect((await call(otherToken)).status).toBe(200)
    expect(provisioningService.listUsers).toHaveBeenLastCalledWith(null, 1, 100, expect.objectContaining({ tenantId: 'tenant-2', organizationId: 'org-2' }), 'http://localhost')
    const keys = [...new Set(consume.mock.calls.map(([key]) => key))]
    expect(keys).toEqual(expect.arrayContaining([trustProxyDepth ? '198.51.100.1' : 'global', 'token:tenant-1:org-1:token-1', 'token:tenant-2:org-2:token-2']))
    expect(keys).toHaveLength(3)
    expect(keys.every((key) => !key.includes('omscim_'))).toBe(true)
  })

  it('keeps unverified credentials in a bounded fallback without probing stored prefixes', async () => {
    const consume = jest.spyOn(limiter, 'consume')
    for (let index = 0; index < 12; index++) {
      const rawToken = `omscim_${index.toString(16).padStart(6, '0').padEnd(64, 'c')}`
      expect((await listUsers(request('GET', 'Users', { authorization: `Bearer ${rawToken}` }))).status).toBe(index < 10 ? 401 : 429)
    }
    expect(findOne).toHaveBeenCalledTimes(12)
    expect(findOne).toHaveBeenCalledWith(ScimToken, { tokenLookupHash: expect.stringMatching(/^[a-f0-9]{64}$/), isActive: true }, { fields: ['id', 'tenantId', 'organizationId'] })
    expect(new Set(consume.mock.calls.map(([key]) => key))).toEqual(new Set(['global']))
    expect(mockHash).toHaveBeenCalledTimes(10)
    expect(mockCompare).not.toHaveBeenCalled()
  })

  it.each([0, 1])('admits a cold enrolled token after unknown exhaustion and after cache loss at proxy depth %i', async (trustProxyDepth) => {
    limiter = new RateLimiterService({ enabled: true, strategy: 'memory', keyPrefix: 'test-scim', trustProxyDepth })
    jest.mocked(getCachedRateLimiterService).mockReturnValue(limiter)
    const rawToken = `omscim_${'e'.repeat(64)}`
    const tokenLookupHash = scimTokenLookupHash(rawToken)
    const headers = { 'x-forwarded-for': '198.51.100.1' }
    const call = (token: string) => listUsers(request('GET', 'Users', { ...headers, authorization: `Bearer ${token}` }))
    for (let index = 0; index < 10; index++) expect((await call(`unknown-${index}`)).status).toBe(401)
    expect((await call('unknown'))?.status).toBe(429)
    findOne.mockImplementation(async (entity: unknown, where: Record<string, unknown>) => entity === ScimToken
      ? where.tokenLookupHash === tokenLookupHash ? { id: 'cold-token', tenantId: 'tenant-1', organizationId: 'org-1' } : null
      : { id: 'config-1', organizationId: 'org-1', isActive: true, jitEnabled: false })
    find.mockResolvedValue([{ id: 'cold-token', tokenLookupHash, tokenHash: 'stored-hash', ssoConfigId: 'config-1', organizationId: 'org-1', tenantId: 'tenant-1' }])
    mockCompare.mockImplementation(async (raw: string) => raw === rawToken)
    provisioningService.listUsers.mockResolvedValue({ Resources: [], totalResults: 0 })
    expect((await call(rawToken)).status).toBe(200)
    await cache.clear()
    expect((await call(rawToken)).status).toBe(200)
    const compares = mockCompare.mock.calls.length
    expect((await call(`${rawToken.slice(0, 12)}${'f'.repeat(59)}`)).status).toBe(429)
    expect(mockCompare).toHaveBeenCalledTimes(compares)
    expect(findOne).toHaveBeenCalledWith(ScimToken, { tokenLookupHash, isActive: true }, { fields: ['id', 'tenantId', 'organizationId'] })
  })

  it('keeps a revoked enrolled fingerprint on the unverified budget', async () => {
    const rawToken = `omscim_${'e'.repeat(64)}`
    const stored = { id: 'revoked-token', tokenLookupHash: scimTokenLookupHash(rawToken), isActive: false, tenantId: 'tenant-1', organizationId: 'org-1' }
    findOne.mockImplementation(async (_entity: unknown, where: Record<string, unknown>) => where.tokenLookupHash === stored.tokenLookupHash && where.isActive === stored.isActive ? stored : null)
    for (let index = 0; index < 10; index++) expect((await listUsers(request())).status).toBe(401)
    const compares = mockCompare.mock.calls.length
    expect((await listUsers(request('GET', 'Users', { authorization: `Bearer ${rawToken}` }))).status).toBe(429)
    expect(mockCompare).toHaveBeenCalledTimes(compares)
  })

  it('fails closed on a fingerprint lookup error before credential work', async () => {
    const lookupError = new Error(`query failed for token_lookup_hash=${scimTokenLookupHash(`omscim_${'a'.repeat(64)}`)}`)
    findOne.mockRejectedValue(lookupError)
    const response = await listUsers(request('GET', 'Users', { authorization: `Bearer omscim_${'a'.repeat(64)}` }))
    expect(response.status).toBe(503)
    expect(response.headers.get('content-type')).toBe('application/scim+json')
    expect(mockReportError).toHaveBeenCalledWith(expect.objectContaining({ message: '[internal] SCIM fingerprint lookup unavailable' }), { module: 'sso', code: 'sso.scim_admission_unavailable' })
    expect(mockReportError.mock.calls.map(([error]) => String(error)).join(' ')).not.toContain(scimTokenLookupHash(`omscim_${'a'.repeat(64)}`))
    expect(find).not.toHaveBeenCalled()
    expect(mockHash).not.toHaveBeenCalled()
    expect(mockCompare).not.toHaveBeenCalled()
  })

  it('fails closed and reports admission cache failures before credential work', async () => {
    const lookupError = new Error('[internal] Admission cache unavailable')
    jest.spyOn(cache, 'get').mockRejectedValue(lookupError)
    const response = await listUsers(request('GET', 'Users', { authorization: `Bearer omscim_${'a'.repeat(64)}` }))
    expect(response.status).toBe(503)
    expect(response.headers.get('content-type')).toBe('application/scim+json')
    expect(await response.json()).toEqual(expect.objectContaining({ status: '503' }))
    expect(mockReportError).toHaveBeenCalledWith(lookupError, { module: 'sso', code: 'sso.scim_admission_unavailable' })
    expect(mockHash).not.toHaveBeenCalled()
    expect(mockCompare).not.toHaveBeenCalled()
  })

  it('retains the SCIM 503 response when telemetry reporting throws', async () => {
    jest.spyOn(cache, 'get').mockRejectedValue(new Error('[internal] Admission cache unavailable'))
    mockReportError.mockImplementation(() => { throw new Error('[internal] Telemetry sink unavailable') })

    const response = await listUsers(request('GET', 'Users', { authorization: `Bearer omscim_${'a'.repeat(64)}` }))

    expect(response.status).toBe(503)
    expect(response.headers.get('content-type')).toBe('application/scim+json')
    expect(await response.json()).toEqual(expect.objectContaining({ status: '503' }))
    expect(mockReportError).toHaveBeenCalledTimes(1)
    expect(mockHash).not.toHaveBeenCalled()
    expect(mockCompare).not.toHaveBeenCalled()
  })

  it.each([
    { flag: 'RATE_LIMIT_ENABLED', value: 'false' },
    { flag: 'OM_INTEGRATION_TEST', value: 'true' },
  ])('preserves $flag bypass without a limiter or active-prefix lookup', async ({ flag, value }) => {
    process.env[flag] = value
    jest.mocked(getCachedRateLimiterService).mockReturnValue(null)
    findOne.mockRejectedValue(new Error('[internal] Lookup must not run'))

    expect(await checkScimRateLimit(request('GET', 'Users', { authorization: `Bearer omscim_${'a'.repeat(64)}` }))).toBeNull()
    expect(createRequestContainer).not.toHaveBeenCalled()
    expect(findOne).not.toHaveBeenCalled()
    expect(mockReportError).not.toHaveBeenCalled()
  })

  it('uses the trusted hop while isolating independent clients', async () => {
    limiter = new RateLimiterService({ enabled: true, strategy: 'memory', keyPrefix: 'test-scim', trustProxyDepth: 1 })
    jest.mocked(getCachedRateLimiterService).mockReturnValue(limiter)
    for (let index = 0; index < 10; index++) {
      expect((await listUsers(request('GET', 'Users', { 'x-forwarded-for': `192.0.2.${index}, 198.51.100.1` }))).status).toBe(401)
    }

    expect((await listUsers(request('GET', 'Users', { 'x-forwarded-for': '192.0.2.99, 198.51.100.1' }))).status).toBe(429)
    expect((await listUsers(request('GET', 'Users', { 'x-forwarded-for': '198.51.100.2' }))).status).toBe(401)
    expect(mockHash).toHaveBeenCalledTimes(11)
  })

  it('uses exact fingerprint lookup for cold trusted-IP requests', async () => {
    limiter = new RateLimiterService({ enabled: true, strategy: 'memory', keyPrefix: 'test-scim', trustProxyDepth: 1 })
    jest.mocked(getCachedRateLimiterService).mockReturnValue(limiter)
    findOne.mockResolvedValue(null)

    expect(await checkScimRateLimit(request('GET', 'Users', {
      authorization: `Bearer omscim_${'a'.repeat(64)}`, 'x-forwarded-for': '198.51.100.1',
    }))).toBeNull()
    expect(findOne).toHaveBeenCalledWith(ScimToken, { tokenLookupHash: scimTokenLookupHash(`omscim_${'a'.repeat(64)}`), isActive: true }, { fields: ['id', 'tenantId', 'organizationId'] })
  })

  it('allows requests again when the window expires', async () => {
    for (let index = 0; index < 10; index++) await listUsers(request())
    expect((await listUsers(request())).status).toBe(429)

    jest.advanceTimersByTime(1001)

    expect((await listUsers(request())).status).toBe(401)
    expect(mockHash).toHaveBeenCalledTimes(11)
  })

  it('bounds concurrent invalid-token bursts before hashing', async () => {
    const responses = await Promise.all(Array.from({ length: 30 }, (_, index) =>
      listUsers(request('GET', 'Users', { authorization: `Bearer concurrent-${index}` })),
    ))

    expect(responses.filter((response) => response.status === 401)).toHaveLength(10)
    expect(responses.filter((response) => response.status === 429)).toHaveLength(20)
    expect(mockHash).toHaveBeenCalledTimes(10)
  })

  it('honors the configured quota, window and block duration', async () => {
    process.env.RATE_LIMIT_SCIM_POINTS = '2'
    process.env.RATE_LIMIT_SCIM_DURATION = '5'
    process.env.RATE_LIMIT_SCIM_BLOCK_DURATION = '7'
    await listUsers(request())
    await listUsers(request())

    const response = await listUsers(request())

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('7')
    expect(response.headers.get('x-ratelimit-limit')).toBe('2')
    expect(mockHash).toHaveBeenCalledTimes(2)
  })

  it('preserves bcrypt comparison for admitted tokens with a matching prefix', async () => {
    find.mockResolvedValue([{ tokenHash: 'stored-hash' }])

    expect((await listUsers(request())).status).toBe(401)
    expect(mockCompare).toHaveBeenCalledWith('random-invalid-token', 'stored-hash')
    expect(mockHash).not.toHaveBeenCalled()
  })

  it('preserves missing-bearer errors without hashing below the limit', async () => {
    expect((await listUsers(request('GET', 'Users', { authorization: '' }))).status).toBe(401)
    expect(mockHash).not.toHaveBeenCalled()
    expect(createRequestContainer).not.toHaveBeenCalled()
  })

  it('preserves valid user provisioning and organization scope below the limit', async () => {
    find.mockResolvedValue([{ id: 'token-1', tokenHash: 'stored-hash', ssoConfigId: 'config-1', organizationId: 'org-1', tenantId: 'tenant-1' }])
    mockCompare.mockResolvedValue(true)
    const resource = { id: 'scim-user-1', userName: 'scim-rate-limit@example.com', meta: { location: 'http://localhost/api/sso/scim/v2/Users/scim-user-1' } }
    provisioningService.createUser.mockResolvedValue({ resource, status: 201 })
    const req = new Request('http://localhost/api/sso/scim/v2/Users', {
      method: 'POST', headers: { authorization: 'Bearer valid-token', 'content-type': 'application/scim+json' },
      body: JSON.stringify({ schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], userName: resource.userName }),
    })

    const response = await createUser(req)

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual(resource)
    expect(provisioningService.createUser).toHaveBeenCalledWith(expect.objectContaining({ userName: resource.userName }), expect.objectContaining({ organizationId: 'org-1', tenantId: 'tenant-1', ssoConfigId: 'config-1' }), 'http://localhost')
    expect(findOne).toHaveBeenCalledWith(expect.any(Function), { id: 'config-1', organizationId: 'org-1', deletedAt: null })
    expect(mockCompare).toHaveBeenCalledWith('valid-token', 'stored-hash')
    expect(mockHash).not.toHaveBeenCalled()
  })

  it('does not verify tokens when the limiter is unavailable', async () => {
    jest.mocked(getCachedRateLimiterService).mockReturnValue(null)

    const response = await listUsers(request())

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual(expect.objectContaining({ status: '503' }))
    expect(mockHash).not.toHaveBeenCalled()
    expect(createRequestContainer).not.toHaveBeenCalled()
  })

  it('fails closed before bcrypt when the backing limiter cannot produce a decision', async () => {
    jest.spyOn(limiter, 'consume').mockResolvedValue({
      allowed: true, remainingPoints: 10, msBeforeNext: 0, consumedPoints: 0, degraded: true,
    })

    const response = await listUsers(request())

    expect(response.status).toBe(503)
    expect(mockHash).not.toHaveBeenCalled()
    expect(createRequestContainer).not.toHaveBeenCalled()
  })

  it('honors the shared limiter disable switch', async () => {
    limiter = new RateLimiterService({ enabled: false, strategy: 'memory', keyPrefix: 'test-scim', trustProxyDepth: 0 })
    jest.mocked(getCachedRateLimiterService).mockReturnValue(limiter)

    for (let index = 0; index < 12; index++) expect((await listUsers(request())).status).toBe(401)

    expect(mockHash).toHaveBeenCalledTimes(12)
  })
})
