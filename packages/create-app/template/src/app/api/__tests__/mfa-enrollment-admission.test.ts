import { NextRequest } from 'next/server'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findApiRouteManifestMatch } from '@open-mercato/shared/modules/registry'
import { authorizeFeatures } from '@open-mercato/shared/security/featurePolicy'
import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceTenantSelection } from '@open-mercato/core/modules/auth/lib/tenantAccess'
import { registerApiInterceptors } from '@open-mercato/shared/lib/crud/interceptor-registry'
import { runApiInterceptorsBefore } from '@open-mercato/shared/lib/crud/interceptor-runner'
import type { ApiInterceptor, ApiInterceptorMethod, InterceptorContext } from '@open-mercato/shared/lib/crud/api-interceptor'
import { interceptors } from '../../../../../../packages/enterprise/src/modules/security/api/interceptors'
import * as dispatcher from '../[...slug]/route'

let mockAuth: AuthContext
const mockCompliance = jest.fn()
const mockHandler = jest.fn()
const mockResolve = jest.fn()
let mockGrants: string[]

jest.mock('@/bootstrap-api', () => ({ bootstrap: jest.fn() }))
jest.mock('@/.mercato/generated/api-route-shards.generated', () => ({ apiRouteFacades: [] }), { virtual: true })
jest.mock('@open-mercato/shared/modules/registry', () => ({
  findApiRouteManifestMatch: jest.fn(), getApiRouteManifests: () => [], registerApiRouteManifests: jest.fn(),
}))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  resolveAuthFromRequestDetailed: async () => ({ auth: mockAuth, status: mockAuth ? 'authenticated' : 'missing' }),
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('@open-mercato/core/bootstrap', () => ({ getCachedRateLimiterService: () => null }))
jest.mock('@open-mercato/core/modules/auth/services/rbacService', () => ({ RbacService: class {} }))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveFeatureCheckContext: async () => ({ organizationId: 'org-1', scope: { tenantId: 'tenant-1' } }),
}))
jest.mock('@open-mercato/core/modules/auth/lib/tenantAccess', () => ({
  normalizeTenantId: (value: unknown) => value,
  enforceTenantSelection: jest.fn(), resolveIsSuperAdmin: async () => false,
}))
jest.mock('@open-mercato/cache', () => ({ runWithCacheTenant: (_tenant: unknown, run: () => unknown) => run() }))
jest.mock('@open-mercato/shared/lib/modules/resource-usage', () => ({
  withModuleResourceUsage: (_options: unknown, run: () => unknown) => run(),
}))
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({ getTelemetryRuntime: () => null }))
jest.mock('@open-mercato/shared/modules/events', () => ({ getGlobalEventBus: () => ({ emit: async () => {} }) }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}))
jest.mock('../../../../../../packages/enterprise/src/modules/security/events', () => ({ emitSecurityEvent: jest.fn() }))

const methods: ApiInterceptorMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
const enrollment = interceptors.find((entry) => entry.id === 'security.mfa.enrollment.api')!

async function dispatch(
  method: ApiInterceptorMethod = 'GET',
  path = 'sales/dashboard/widgets/new-orders',
  kind: 'route-file' | 'legacy' = 'route-file',
  options: { features?: string[]; headers?: Record<string, string>; query?: string } = {},
) {
  jest.mocked(findApiRouteManifestMatch).mockReturnValue({
    route: {
      moduleId: path.split('/')[0], kind, path: `/${path}`, methods: [method],
      load: async () => ({ [method]: mockHandler, metadata: { [method]: { requireAuth: true, requireFeatures: options.features ?? ['sales.orders.view'] } } }),
    },
    params: {},
  })
  const request = new NextRequest(`http://localhost/api/${path}${options.query ?? ''}`, {
    method,
    headers: { cookie: 'auth_token=canonical-session', ...(method !== 'GET' ? { 'content-type': 'application/json' } : {}), ...options.headers },
    ...(method !== 'GET' ? { body: '{}' } : {}),
  })
  return dispatcher[method](request, { params: Promise.resolve({ slug: path.split('/') }) })
}

describe('MFA enrollment through the real API dispatcher and interceptor runner', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
    delete process.env.OM_SECURITY_MFA_EMERGENCY_BYPASS
    registerModules([{ id: 'sales' }, { id: 'security' }, { id: 'auth' }])
    mockAuth = { sub: 'staff-1', tenantId: 'tenant-1', orgId: 'org-1' }
    mockGrants = ['sales.*']
    mockCompliance.mockResolvedValue({ enforced: true, compliant: false, deadline: new Date(0) })
    mockHandler.mockImplementation(async () => Response.json({ reached: true }))
    mockResolve.mockImplementation((name: string) => {
      if (name === 'em') return {}
      if (name === 'mfaEnforcementService') return { checkUserCompliance: mockCompliance }
      if (name === 'rbacService') return {
        userHasAllFeatures: async (_userId: string, required: string[]) => authorizeFeatures(required, { grantedFeatures: mockGrants, unrestricted: mockAuth?.isSuperAdmin }),
        loadAcl: async () => ({ features: mockGrants, isSuperAdmin: mockAuth?.isSuperAdmin }),
      }
      throw new Error(`[internal] Unexpected dependency ${name}`)
    })
    jest.mocked(createRequestContainer).mockResolvedValue({ resolve: mockResolve } as unknown as Awaited<ReturnType<typeof createRequestContainer>>)
    registerApiInterceptors([{ moduleId: 'security', interceptors }])
  })
  afterEach(() => {
    registerApiInterceptors([])
    registerModules([])
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  test.each(methods)('denies overdue %s before the business handler and preserves cookies', async (method) => {
    const response = await dispatch(method, 'sales/quotes/convert')
    expect(response.status).toBe(403)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(mockHandler).not.toHaveBeenCalled()
    expect(mockCompliance).toHaveBeenCalledWith('staff-1')
  })

  test.each(['sales.orders.view', '*', 'sales.*'])('ordinary/wildcard ACL %s never bypasses enrollment', async (grant) => {
    mockGrants = [grant]
    expect((await dispatch()).status).toBe(403)
    expect(mockHandler).not.toHaveBeenCalled()
  })

  test('shares one lazy request container between required-feature authorization and admission', async () => {
    expect((await dispatch()).status).toBe(403)
    expect(createRequestContainer).toHaveBeenCalledTimes(1)
    expect(mockResolve).toHaveBeenCalledWith('rbacService')
    expect(mockResolve).toHaveBeenCalledWith('mfaEnforcementService')
  })

  test('preserves canonical superadmin wildcard policy for feature-gated request hooks', async () => {
    mockAuth = { ...mockAuth!, isSuperAdmin: true }
    mockGrants = []
    const before = jest.fn(async () => ({ ok: false, statusCode: 403 }))
    registerApiInterceptors([{ moduleId: 'example', interceptors: [{
      id: 'test.feature-admission', targetRoute: '*', scope: 'request', methods: ['GET'], features: ['security.admin.manage'], before,
    }] }])
    expect((await dispatch()).status).toBe(403)
    expect(before).toHaveBeenCalledTimes(1)
  })

  test('preserves tenant-scope denial before admission and business data access', async () => {
    jest.mocked(enforceTenantSelection).mockRejectedValueOnce(new CrudHttpError(403, { error: 'test scope denied' }))
    const response = await dispatch('GET', 'sales/orders', 'route-file', { query: '?tenantId=other-tenant' })
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'test scope denied' })
    expect(mockCompliance).not.toHaveBeenCalled()
    expect(mockHandler).not.toHaveBeenCalled()
  })

  test.each(['route-file', 'legacy'] as const)('covers custom %s business handlers', async (kind) => {
    expect((await dispatch('GET', 'sales/dashboard/widgets/new-orders', kind)).status).toBe(403)
    expect(mockHandler).not.toHaveBeenCalled()
  })

  test.each([
    { enforced: true, compliant: true },
    { enforced: false, compliant: false },
    { enforced: true, compliant: false, deadline: new Date('2999-01-01T00:00:00Z') },
  ])('preserves successful handler response for %j', async (compliance) => {
    mockCompliance.mockResolvedValue(compliance)
    const response = await dispatch()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ reached: true })
    expect(mockHandler).toHaveBeenCalledTimes(1)
  })

  test.each(['auth/profile', 'auth/logout', 'security/profile', 'security/profile/password', 'security/mfa/provider/totp', 'security/mfa/verify'])
    ('keeps recovery route %s reachable', async (path) => {
      expect((await dispatch('POST', path)).status).toBe(200)
      expect(mockCompliance).not.toHaveBeenCalled()
      expect(mockHandler).toHaveBeenCalledTimes(1)
    })

  test('keeps profile feature authorization despite recovery exemption', async () => {
    mockGrants = []
    expect((await dispatch('GET', 'auth/profile')).status).toBe(403)
    expect(mockHandler).not.toHaveBeenCalled()
  })

  test('fails closed on compliance service errors without invalidating the session', async () => {
    mockCompliance.mockRejectedValue(new Error('test service unavailable'))
    const response = await dispatch()
    expect(response.status).toBe(403)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(mockHandler).not.toHaveBeenCalled()
  })

  test.each([null, {}])('fails closed on malformed enforcement service %p', async (service) => {
    const resolve = mockResolve.getMockImplementation()!
    mockResolve.mockImplementation((name: string) => name === 'mfaEnforcementService' ? service : resolve(name))
    expect((await dispatch()).status).toBe(403)
    expect(mockHandler).not.toHaveBeenCalled()
  })

  test('does not trust caller identity, feature or API-key headers to exempt a session', async () => {
    const response = await dispatch('GET', 'sales/orders', 'route-file', { headers: {
      'x-user-id': 'other-user', 'x-tenant-id': 'other-tenant', 'x-features': '*', 'x-api-key': 'untrusted-key',
    } })
    expect(response.status).toBe(403)
    expect(mockCompliance).toHaveBeenCalledWith('staff-1')
    expect(mockHandler).not.toHaveBeenCalled()
  })

  test('denies the current deadline before invoking a handler', async () => {
    mockCompliance.mockResolvedValue({ enforced: true, compliant: false, deadline: new Date() })
    expect((await dispatch()).status).toBe(403)
    expect(mockHandler).not.toHaveBeenCalled()
  })

  test('leaves the original request body available to admitted custom handlers', async () => {
    mockCompliance.mockResolvedValue({ enforced: true, compliant: true })
    mockHandler.mockImplementation(async (request: NextRequest) => {
      expect(request.bodyUsed).toBe(false)
      return Response.json(await request.json())
    })
    const response = await dispatch('POST', 'sales/quotes/convert')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({})
  })

  test('leaves API-key enrollment posture unchanged', async () => {
    mockAuth = { ...mockAuth!, sub: 'api_key:key-1', isApiKey: true, userId: 'staff-1' }
    expect((await dispatch()).status).toBe(200)
    expect(mockCompliance).not.toHaveBeenCalled()
  })

  test('keeps existing behavior without enterprise request hooks and avoids additional DI resolution', async () => {
    registerApiInterceptors([{ moduleId: 'security', interceptors: interceptors.filter((entry) => entry.scope !== 'request') }])
    expect((await dispatch('GET', 'sales/orders', 'route-file', { features: [] })).status).toBe(200)
    expect(createRequestContainer).not.toHaveBeenCalled()
    expect(mockResolve).not.toHaveBeenCalledWith('em')
    expect(mockCompliance).not.toHaveBeenCalled()
  })

  test('does not run enrollment twice when a route calls its existing CRUD before hooks', async () => {
    mockCompliance.mockResolvedValue({ enforced: true, compliant: true })
    const routeHook = jest.fn(async () => ({ ok: true }))
    const routeInterceptor: ApiInterceptor = { id: 'test.route', targetRoute: '*', methods: ['GET'], before: routeHook }
    registerApiInterceptors([{ moduleId: 'security', interceptors: [enrollment, routeInterceptor] }])
    mockHandler.mockImplementation(async () => {
      await runApiInterceptorsBefore({
        routePath: 'sales/orders', method: 'GET', request: { method: 'GET', url: 'http://localhost/api/sales/orders', headers: {} },
        context: { userId: 'staff-1', tenantId: 'tenant-1', organizationId: 'org-1', em: {}, container: { resolve: mockResolve } } as unknown as InterceptorContext,
      })
      return Response.json({ reached: true })
    })
    expect((await dispatch()).status).toBe(200)
    expect(mockCompliance).toHaveBeenCalledTimes(1)
    expect(routeHook).toHaveBeenCalledTimes(1)
  })

  test('fails closed before the handler when a request hook times out', async () => {
    registerApiInterceptors([{ moduleId: 'example', interceptors: [{
      id: 'test.timeout', targetRoute: '*', scope: 'request', methods: ['GET'], timeoutMs: 10,
      before: () => new Promise(() => {}),
    }] }])
    const pending = dispatch()
    await jest.advanceTimersByTimeAsync(11)
    expect((await pending).status).toBe(504)
    expect(mockHandler).not.toHaveBeenCalled()
  })
})
