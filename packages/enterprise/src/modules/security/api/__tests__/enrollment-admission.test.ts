const mockEmitSecurityEvent = jest.fn().mockResolvedValue(undefined)
jest.mock('../../events', () => ({ emitSecurityEvent: mockEmitSecurityEvent }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ t: (key: string) => key }),
}))

import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type { InterceptorContext } from '@open-mercato/shared/lib/crud/api-interceptor'
import { interceptors } from '../interceptors'

const interceptor = interceptors.find((entry) => entry.id === 'security.mfa.enrollment.api')!
const checkUserCompliance = jest.fn()
const auth: AuthContext = { sub: 'staff-1', tenantId: 'tenant-1', orgId: 'org-1' }
let resolveService: jest.Mock

function context(identity: AuthContext = auth): InterceptorContext {
  return {
    auth: identity, userId: identity?.sub ?? '', tenantId: identity?.tenantId ?? '', organizationId: identity?.orgId ?? '',
    em: {} as InterceptorContext['em'],
    container: { resolve: resolveService } as unknown as InterceptorContext['container'],
  }
}
function admit(path = 'sales/orders', identity: AuthContext = auth) {
  return interceptor.before!(
    { method: 'GET', url: `http://localhost/api/${path}`, headers: {} },
    { ...context(identity), routePattern: path },
  )
}

describe('MFA enrollment API admission policy', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.OM_SECURITY_MFA_EMERGENCY_BYPASS
    resolveService = jest.fn(() => ({ checkUserCompliance }))
    checkUserCompliance.mockResolvedValue({ enforced: true, compliant: false, deadline: new Date(0) })
  })

  test('is an ungated global request interceptor for every dispatcher method', () => {
    expect(interceptor).toMatchObject({ targetRoute: '*', scope: 'request', methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] })
    expect(interceptor.features).toBeUndefined()
  })

  test.each([undefined, new Date(0), new Date(Number.NaN)])('denies noncompliance at a due or invalid deadline %s', async (deadline) => {
    checkUserCompliance.mockResolvedValue({ enforced: true, compliant: false, deadline })
    expect(await admit()).toMatchObject({ ok: false, statusCode: 403 })
    expect(checkUserCompliance).toHaveBeenCalledWith('staff-1')
  })

  test.each([
    { enforced: false, compliant: false },
    { enforced: true, compliant: true },
    { enforced: true, compliant: false, deadline: new Date('2999-01-01T00:00:00Z') },
  ])('preserves compliance/grace behavior %j', async (compliance) => {
    checkUserCompliance.mockResolvedValue(compliance)
    expect(await admit()).toEqual({ ok: true })
  })

  test.each([
    'auth/login', 'auth/profile', 'auth/logout', 'auth/session/refresh', 'security/profile', 'security/profile/password',
    'security/mfa', 'security/mfa/providers', 'security/mfa/provider/totp', 'security/mfa/verify',
    'security/mfa/methods', 'security/mfa/methods/method-1', 'security/mfa/recovery-codes/regenerate',
  ])('retains recovery route %s without querying enforcement', async (path) => {
    expect(await admit(path)).toEqual({ ok: true })
    expect(await admit(`${path}/`)).toEqual({ ok: true })
    expect(resolveService).not.toHaveBeenCalled()
  })

  test.each(['security/mfa-export', 'security/profile-export', 'auth/profile-export', 'security/enforcement', 'security/users/mfa/compliance'])
    ('does not exempt business/admin route %s', async (path) => {
      expect(await admit(path)).toMatchObject({ ok: false, statusCode: 403 })
    })

  test.each([null, { ...auth, isApiKey: true }, { ...auth, mfa_pending: true }])('leaves noninteractive/missing/pending identity to existing auth policy %j', async (identity) => {
    expect(await admit('sales/orders', identity)).toEqual({ ok: true })
    expect(resolveService).not.toHaveBeenCalled()
  })

  test('fails closed for a tenant user when compliance throws', async () => {
    checkUserCompliance.mockRejectedValue(new Error('test unavailable'))
    expect(await admit()).toMatchObject({ ok: false, statusCode: 403 })
  })

  test.each([null, ''])('fails closed for an interactive API principal without a tenant (%p)', async (tenantId) => {
    checkUserCompliance.mockRejectedValue(new Error('test unavailable'))
    expect(await admit('sales/orders', { ...auth!, tenantId })).toMatchObject({ ok: false, statusCode: 403 })
  })

  test.each([null, {}, () => { throw new Error('test missing service') }])('fails closed for missing/malformed enforcement service %p', async (service) => {
    resolveService.mockImplementation(() => typeof service === 'function' ? service() : service)
    expect(await admit()).toMatchObject({ ok: false, statusCode: 403 })
  })

  test('preserves emergency bypass and its existing warning notification', async () => {
    process.env.OM_SECURITY_MFA_EMERGENCY_BYPASS = 'true'
    expect(await admit()).toEqual({ ok: true })
    expect(mockEmitSecurityEvent).toHaveBeenCalled()
    delete process.env.OM_SECURITY_MFA_EMERGENCY_BYPASS
  })
})
