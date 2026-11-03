/** @jest-environment node */
/**
 * Regression guard: an infrastructure failure inside the login route must
 * surface as a JSON 500 and a server-side log line, not as a bare 500 with an
 * empty body. The empty-body case gives the client nothing to render and the
 * operator nothing to grep, which is what made a demo outage (database
 * unreachable) indistinguishable from a bug in this route.
 */
import { registerApiInterceptors } from '@open-mercato/shared/lib/crud/interceptor-registry'

const createRequestContainerMock = jest.fn()
const loggerErrorMock = jest.fn()

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? '',
  }),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => createRequestContainerMock(...args),
}))

jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => ({
    error: (...args: unknown[]) => loggerErrorMock(...args),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    child: jest.fn(),
  }),
}))

jest.mock('@open-mercato/shared/lib/auth/jwt', () => ({ signJwt: () => 'jwt-token' }))

jest.mock('@open-mercato/core/modules/auth/lib/rateLimitCheck', () => ({
  checkAuthRateLimit: jest.fn(async () => ({ error: null, compoundKey: null })),
  resetAuthRateLimit: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/core/modules/auth/events', () => ({
  emitAuthEvent: jest.fn(async () => undefined),
}))

const { POST } = require('@open-mercato/core/modules/auth/api/login')

function loginRequest() {
  return new Request('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: 'someone@example.com', password: 'whatever' }).toString(),
  })
}

describe('POST /api/auth/login — unhandled infrastructure failure', () => {
  beforeEach(() => {
    registerApiInterceptors([])
    jest.clearAllMocks()
  })

  test('returns a JSON 500 body instead of an empty response when the container cannot be built', async () => {
    createRequestContainerMock.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:5432'))

    const response = await POST(loginRequest())

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body).toEqual({ ok: false, error: 'An error occurred. Please try again.' })
  })

  test('logs the underlying cause under a stable scope so it is greppable in deploy logs', async () => {
    const cause = new Error('connect ECONNREFUSED 10.0.0.5:5432')
    createRequestContainerMock.mockRejectedValue(cause)

    await POST(loginRequest())

    expect(loggerErrorMock).toHaveBeenCalledTimes(1)
    const [message, fields] = loggerErrorMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(message).toBe('Unhandled auth route error')
    expect(fields).toMatchObject({ scope: 'auth.login', err: cause })
  })

  test('never leaks the underlying failure to an unauthenticated caller', async () => {
    createRequestContainerMock.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:5432'))

    const response = await POST(loginRequest())
    const serialized = JSON.stringify(await response.json())

    expect(serialized).not.toMatch(/ECONNREFUSED/)
    expect(serialized).not.toMatch(/10\.0\.0\.5/)
    expect(serialized).not.toMatch(/5432/)
  })

  test('a throw after authentication is still contained rather than escaping as an empty 500', async () => {
    // Reaching the session/JWT tail means credentials were already accepted, so
    // a failure here (missing signing secret, unwritable session store) must not
    // hand the browser a bodiless response either.
    createRequestContainerMock.mockResolvedValue({
      resolve: (name: string) => {
        if (name === 'authService') {
          return {
            findUsersByEmail: async (email: string) => ([{ id: 1, email, passwordHash: 'hash', tenantId: 't1', organizationId: 'o1' }]),
            verifyPassword: async () => true,
            getUserRoles: async () => ['admin'],
            updateLastLoginAt: async () => undefined,
            createSession: async () => { throw new Error('JWT_SECRET is not set') },
          }
        }
        if (name === 'eventBus') return { emitEvent: async () => undefined }
        if (name === 'em') return {}
        return null
      },
    })

    const response = await POST(loginRequest())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'An error occurred. Please try again.' })
    expect(loggerErrorMock).toHaveBeenCalledTimes(1)
  })
})
