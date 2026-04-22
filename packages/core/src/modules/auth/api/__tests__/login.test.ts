/** @jest-environment node */
import { randomUUID } from 'crypto'
import { registerApiInterceptors } from '@open-mercato/shared/lib/crud/interceptor-registry'
import { POST } from '@open-mercato/core/modules/auth/api/login'

const tenantId = randomUUID()
const orgId = randomUUID()

const authServiceMock = {
  findUsersByEmail: jest.fn(async (email: string) => ([{ id: 1, email, passwordHash: 'hash', tenantId, organizationId: orgId }])),
  findUserByEmailAndTenant: jest.fn(async (email: string) => ({ id: 1, email, passwordHash: 'hash', tenantId, organizationId: orgId })),
  verifyPassword: jest.fn(async () => true),
  getUserRoles: jest.fn(async () => ['admin']),
  updateLastLoginAt: jest.fn(async () => undefined),
  createSession: jest.fn(async () => ({ token: 'session-token' })),
}

const containerMock = {
  resolve: jest.fn((name: string) => {
    if (name === 'authService') return authServiceMock
    if (name === 'eventBus') return { emitEvent: jest.fn(async () => undefined) }
    if (name === 'em') return {}
    return null
  }),
}

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? '',
  }),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => containerMock,
}))

jest.mock('@open-mercato/shared/lib/auth/jwt', () => ({ signJwt: () => 'jwt-token' }))

function makeFormData(data: Record<string, string>) {
  const formData = new FormData()
  for (const [key, value] of Object.entries(data)) formData.append(key, value)
  return formData
}

describe('POST /api/auth/login with custom route interceptors', () => {
  beforeEach(() => {
    registerApiInterceptors([])
    jest.clearAllMocks()
  })

  test('returns unchanged login response when no interceptor matches', async () => {
    const req = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      body: makeFormData({ email: 'user@example.com', password: 'secret', remember: '1' }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body).toEqual({
      ok: true,
      token: 'jwt-token',
      redirect: '/backend',
      refreshToken: 'session-token',
    })

    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('auth_token=jwt-token')
    expect(setCookie).toContain('session_token=session-token')
  })

  test('applies body merge from matched after interceptor', async () => {
    registerApiInterceptors([
      {
        moduleId: 'example',
        interceptors: [
          {
            id: 'example.auth.login.merge',
            targetRoute: 'auth/login',
            methods: ['POST'],
            async after() {
              return { merge: { mfa_required: true } }
            },
          },
        ],
      },
    ])

    const req = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      body: makeFormData({ email: 'user@example.com', password: 'secret' }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body).toEqual({
      ok: true,
      token: 'jwt-token',
      redirect: '/backend',
      mfa_required: true,
    })
  })

  test('applies body replace from matched after interceptor and keeps cookies valid', async () => {
    registerApiInterceptors([
      {
        moduleId: 'example',
        interceptors: [
          {
            id: 'example.auth.login.replace',
            targetRoute: 'auth/login',
            methods: ['POST'],
            async after() {
              return {
                replace: {
                  ok: true,
                  mfa_required: true,
                  challenge_id: 'challenge-1',
                  token: 'pending-token',
                },
              }
            },
          },
        ],
      },
    ])

    const req = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      body: makeFormData({ email: 'user@example.com', password: 'secret', remember: '1' }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body).toEqual({
      ok: true,
      mfa_required: true,
      challenge_id: 'challenge-1',
      token: 'pending-token',
    })

    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('auth_token=pending-token')
    expect(setCookie).not.toContain('session_token=')
  })
})
