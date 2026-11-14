import { signJwt } from '@open-mercato/shared/lib/auth/jwt'
import type { InterceptorContext } from '@open-mercato/shared/lib/crud/api-interceptor'
import { interceptors } from '../interceptors'

type SsoRequiredMock = jest.Mock<Promise<boolean>, [string | null, string]>

function buildContext(
  isSsoRequired: SsoRequiredMock,
  isSuperAdmin = false,
): InterceptorContext {
  return {
    userId: '',
    organizationId: '',
    tenantId: '',
    em: {} as InterceptorContext['em'],
    container: {
      resolve(name: string) {
        if (name === 'ssoConfigService') {
          return { isSsoRequiredForOrganization: isSsoRequired }
        }
        if (name === 'rbacService') {
          return { loadAcl: jest.fn(async () => ({ isSuperAdmin })) }
        }
        throw new Error(`Unknown service: ${name}`)
      },
    } as InterceptorContext['container'],
  }
}

describe('SSO auth/login interceptor', () => {
  const interceptor = interceptors.find((item) => item.id === 'sso.auth.login.required')

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret'
    jest.clearAllMocks()
  })

  test('blocks password login when active SSO is required', async () => {
    if (!interceptor?.after) throw new Error('Expected SSO auth/login interceptor')

    const isSsoRequired = jest.fn(async () => true) as SsoRequiredMock
    const token = signJwt({
      sub: 'user-1',
      sid: 'session-1',
      tenantId: 'tenant-1',
      orgId: 'organization-1',
      roles: ['admin'],
    })

    const result = await interceptor.after(
      { method: 'POST', url: 'http://localhost/api/auth/login', headers: {} },
      { statusCode: 200, body: { ok: true, token }, headers: {} },
      buildContext(isSsoRequired),
    )

    expect(isSsoRequired).toHaveBeenCalledWith('tenant-1', 'organization-1')
    expect(result).toEqual({
      replace: {
        ok: false,
        code: 'SSO_REQUIRED',
        error: 'Password login is disabled for this organization. Continue with SSO.',
      },
    })
  })

  test('keeps password login when SSO is not required', async () => {
    if (!interceptor?.after) throw new Error('Expected SSO auth/login interceptor')

    const isSsoRequired = jest.fn(async () => false) as SsoRequiredMock
    const token = signJwt({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'organization-1',
      roles: [],
    })

    await expect(interceptor.after(
      { method: 'POST', url: 'http://localhost/api/auth/login', headers: {} },
      { statusCode: 200, body: { ok: true, token }, headers: {} },
      buildContext(isSsoRequired),
    )).resolves.toEqual({})
  })

  test('keeps the password break-glass path for superadmins', async () => {
    if (!interceptor?.after) throw new Error('Expected SSO auth/login interceptor')

    const isSsoRequired = jest.fn(async () => true) as SsoRequiredMock
    const token = signJwt({
      sub: 'superadmin-1',
      tenantId: 'tenant-1',
      orgId: 'organization-1',
      roles: ['superadmin'],
    })

    await expect(interceptor.after(
      { method: 'POST', url: 'http://localhost/api/auth/login', headers: {} },
      { statusCode: 200, body: { ok: true, token }, headers: {} },
      buildContext(isSsoRequired, true),
    )).resolves.toEqual({})
    expect(isSsoRequired).not.toHaveBeenCalled()
  })

  test('fails closed when the successful login token lacks organization context', async () => {
    if (!interceptor?.after) throw new Error('Expected SSO auth/login interceptor')

    const isSsoRequired = jest.fn(async () => false) as SsoRequiredMock
    const token = signJwt({ sub: 'user-1', tenantId: 'tenant-1', roles: [] })

    await expect(interceptor.after(
      { method: 'POST', url: 'http://localhost/api/auth/login', headers: {} },
      { statusCode: 200, body: { ok: true, token }, headers: {} },
      buildContext(isSsoRequired),
    )).rejects.toThrow('organization context')
  })
})
