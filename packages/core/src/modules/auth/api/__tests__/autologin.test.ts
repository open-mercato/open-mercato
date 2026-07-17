/** @jest-environment node */
import { randomUUID } from 'crypto'
import { GET } from '@open-mercato/core/modules/auth/api/autologin'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'

const tenantId = randomUUID()
const orgId = randomUUID()

const authServiceMock = {
  findUsersByEmail: jest.fn(async (email: string) => ([{ id: 1, email, passwordHash: 'hash', tenantId, organizationId: orgId }])),
  findUserByEmailAndTenant: jest.fn(async (email: string) => ({ id: 1, email, passwordHash: 'hash', tenantId, organizationId: orgId })),
  verifyPassword: jest.fn(async () => true),
  getUserRoles: jest.fn(async () => ['admin']),
  updateLastLoginAt: jest.fn(async () => undefined),
  createSession: jest.fn(async () => ({ session: { id: 'session-1' }, token: 'session-token' })),
}

const containerMock = {
  resolve: jest.fn((name: string) => {
    if (name === 'authService') return authServiceMock
    return null
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => containerMock,
}))

jest.mock('@open-mercato/shared/lib/auth/jwt', () => ({ signJwt: () => 'jwt-token' }))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => null),
}))

jest.mock('@open-mercato/core/modules/auth/events', () => ({
  emitAuthEvent: jest.fn(async () => undefined),
}))

const getAuthFromRequestMock = getAuthFromRequest as jest.MockedFunction<typeof getAuthFromRequest>

function autologinRequest(path = '/api/auth/autologin') {
  return new Request(`http://localhost${path}`, { method: 'GET' })
}

const ORIGINAL_ENV = { ...process.env }

function setAutoLoginEnv(env: Record<string, string | undefined>) {
  delete process.env.OM_AUTOLOGIN_EMAIL
  delete process.env.OM_AUTOLOGIN_PASSWORD
  delete process.env.OM_AUTOLOGIN_TENANT
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue
    process.env[key] = value
  }
}

describe('GET /api/auth/autologin', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getAuthFromRequestMock.mockResolvedValue(null)
    setAutoLoginEnv({})
  })

  afterAll(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  test('is a no-op that redirects to /login when the env credentials are unset', async () => {
    const res = await GET(autologinRequest())
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/login')
    // Never touches auth machinery when disabled.
    expect(containerMock.resolve).not.toHaveBeenCalled()
    expect(authServiceMock.createSession).not.toHaveBeenCalled()
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  test('signs the visitor in and sets the auth cookie when credentials resolve to one user', async () => {
    setAutoLoginEnv({ OM_AUTOLOGIN_EMAIL: 'superadmin@acme.com', OM_AUTOLOGIN_PASSWORD: 'secret' })

    const res = await GET(autologinRequest())

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/backend')
    expect(res.headers.get('set-cookie') ?? '').toContain('auth_token=jwt-token')
    expect(authServiceMock.findUsersByEmail).toHaveBeenCalledWith('superadmin@acme.com')
    expect(authServiceMock.findUserByEmailAndTenant).not.toHaveBeenCalled()
    expect(authServiceMock.createSession).toHaveBeenCalledTimes(1)
  })

  test('scopes the lookup by tenant when OM_AUTOLOGIN_TENANT is set', async () => {
    setAutoLoginEnv({
      OM_AUTOLOGIN_EMAIL: 'superadmin@acme.com',
      OM_AUTOLOGIN_PASSWORD: 'secret',
      OM_AUTOLOGIN_TENANT: tenantId,
    })

    const res = await GET(autologinRequest())

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/backend')
    expect(authServiceMock.findUserByEmailAndTenant).toHaveBeenCalledWith('superadmin@acme.com', tenantId)
    expect(authServiceMock.findUsersByEmail).not.toHaveBeenCalled()
  })

  test('redirects to /backend without re-issuing a session when already authenticated', async () => {
    setAutoLoginEnv({ OM_AUTOLOGIN_EMAIL: 'superadmin@acme.com', OM_AUTOLOGIN_PASSWORD: 'secret' })
    getAuthFromRequestMock.mockResolvedValueOnce({ sub: '1', tenantId, orgId } as never)

    const res = await GET(autologinRequest())

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/backend')
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(authServiceMock.createSession).not.toHaveBeenCalled()
  })

  test('falls back to /login without a cookie when the email resolves to no single user', async () => {
    setAutoLoginEnv({ OM_AUTOLOGIN_EMAIL: 'ghost@acme.com', OM_AUTOLOGIN_PASSWORD: 'secret' })
    authServiceMock.findUsersByEmail.mockResolvedValueOnce([])

    const res = await GET(autologinRequest())

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/login')
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(authServiceMock.createSession).not.toHaveBeenCalled()
  })

  test('falls back to /login when the password does not verify', async () => {
    setAutoLoginEnv({ OM_AUTOLOGIN_EMAIL: 'superadmin@acme.com', OM_AUTOLOGIN_PASSWORD: 'wrong' })
    authServiceMock.verifyPassword.mockResolvedValueOnce(false)

    const res = await GET(autologinRequest())

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/login')
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(authServiceMock.createSession).not.toHaveBeenCalled()
  })

  test('sanitizes an open-redirect bypass in the redirect param down to /backend', async () => {
    setAutoLoginEnv({ OM_AUTOLOGIN_EMAIL: 'superadmin@acme.com', OM_AUTOLOGIN_PASSWORD: 'secret' })

    const res = await GET(autologinRequest('/api/auth/autologin?redirect=/backend//evil.com'))

    expect(res.status).toBe(307)
    const location = res.headers.get('location') ?? ''
    expect(location).toContain('/backend')
    expect(location).not.toContain('evil.com')
  })
})
