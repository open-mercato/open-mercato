import { getCachedRateLimiterService } from '@open-mercato/core/bootstrap'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'
import { ScimTokenService } from '../../../services/scimTokenService'
import type { EntityManager } from '@mikro-orm/postgresql'
import { GET as listUsers, POST as createUser } from '../v2/Users/route'
import { GET as getUser, PATCH as patchUser, DELETE as deleteUser } from '../v2/Users/[id]/route'
import { GET as getCapabilities } from '../v2/ServiceProviderConfig/route'

const mockHash = jest.fn().mockResolvedValue('hashed-token')
const mockCompare = jest.fn().mockResolvedValue(false)

jest.mock('bcryptjs', () => ({
  hash: (...args: unknown[]) => mockHash(...args),
  compare: (...args: unknown[]) => mockCompare(...args),
}))
jest.mock('@open-mercato/core/bootstrap', () => ({ getCachedRateLimiterService: jest.fn() }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
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
  const configKeys = ['RATE_LIMIT_SCIM_POINTS', 'RATE_LIMIT_SCIM_DURATION', 'RATE_LIMIT_SCIM_BLOCK_DURATION']
  const originalConfig = Object.fromEntries(configKeys.map((key) => [key, process.env[key]]))
  let limiter: RateLimiterService
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
    jest.useFakeTimers({ now: new Date('2026-10-27T12:00:00Z') })
    limiter = new RateLimiterService({ enabled: true, strategy: 'memory', keyPrefix: 'test-scim', trustProxyDepth: 0 })
    jest.mocked(getCachedRateLimiterService).mockReturnValue(limiter)
    const em = { find, findOne } as unknown as EntityManager
    const tokenService = new ScimTokenService(em)
    jest.mocked(createRequestContainer).mockResolvedValue({
      resolve: (name: string) => {
        if (name === 'scimTokenService') return tokenService
        if (name === 'scimService') return provisioningService
        if (name === 'em') return em
        throw new Error(`[internal] Unexpected service ${name}`)
      },
    } as Awaited<ReturnType<typeof createRequestContainer>>)
    find.mockResolvedValue([])
    findOne.mockResolvedValue({ id: 'config-1', organizationId: 'org-1', tenantId: 'tenant-1', isActive: true, jitEnabled: false })
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

  it.each(operations)('blocks $name before further bcrypt or provisioning work', async ({ method, path, run }) => {
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

  it('shares the discovery budget and ignores spoofed forwarding headers without proxy trust', async () => {
    for (let index = 0; index < 10; index++) {
      const response = await getCapabilities(request('GET', 'ServiceProviderConfig', { 'x-forwarded-for': `192.0.2.${index}` }))
      expect(response.status).toBe(200)
    }

    const response = await listUsers(request('GET', 'Users', { 'x-real-ip': '198.51.100.1' }))

    expect(response.status).toBe(429)
    expect(mockHash).not.toHaveBeenCalled()
    expect(createRequestContainer).not.toHaveBeenCalled()
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
    find.mockResolvedValue([{ tokenHash: 'stored-hash', ssoConfigId: 'config-1', organizationId: 'org-1', tenantId: 'tenant-1' }])
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
