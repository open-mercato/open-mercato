/**
 * @jest-environment node
 */
import { randomUUID } from 'crypto'
import { registerApiInterceptors } from '@open-mercato/shared/lib/crud/interceptor-registry'
import { POST } from '@open-mercato/core/modules/auth/api/login'

jest.mock('@open-mercato/core/modules/auth/lib/tenantEligibility', () => ({
  isStaffTenantActive: jest.fn(async () => true),
}))

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

const checkAuthRateLimitMock = jest.fn(async () => ({ error: null, compoundKey: null }))
jest.mock('@open-mercato/core/modules/auth/lib/rateLimitCheck', () => ({
  checkAuthRateLimit: (...args: unknown[]) => checkAuthRateLimitMock(...(args as [])),
  resetAuthRateLimit: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/core/modules/auth/events', () => ({
  emitAuthEvent: jest.fn(async () => undefined),
}))

const ORIGINAL_ENV = {
  APP_URL: process.env.APP_URL,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  APP_ALLOWED_ORIGINS: process.env.APP_ALLOWED_ORIGINS,
}

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

function buildLoginRequest(options: { url?: string; headers?: Record<string, string> } = {}) {
  const form = new URLSearchParams()
  form.set('email', 'attacker@example.com')
  form.set('password', 'attacker-secret')
  return new Request(options.url ?? 'http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      host: 'localhost:3000',
      ...(options.headers ?? {}),
    },
    body: form.toString(),
  })
}

function setCookieHeader(res: Response): string {
  return res.headers.get('set-cookie') ?? ''
}

async function expectRejectedWithoutSession(res: Response) {
  expect(res.status).toBe(403)
  const body = await res.json()
  expect(body.ok).toBe(false)
  expect(typeof body.error).toBe('string')
  expect(body.token).toBeUndefined()
  expect(setCookieHeader(res)).not.toContain('auth_token=')
  expect(setCookieHeader(res)).not.toContain('session_token=')
  expect(authServiceMock.findUsersByEmail).not.toHaveBeenCalled()
  expect(authServiceMock.verifyPassword).not.toHaveBeenCalled()
  expect(authServiceMock.createSession).not.toHaveBeenCalled()
}

async function expectSessionIssued(res: Response) {
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.ok).toBe(true)
  expect(setCookieHeader(res)).toContain('auth_token=')
  expect(authServiceMock.createSession).toHaveBeenCalledTimes(1)
}

describe('POST /api/auth/login — cross-site browser submissions (#7239)', () => {
  beforeEach(() => {
    registerApiInterceptors([])
    jest.clearAllMocks()
    restoreEnv()
    delete process.env.APP_URL
    delete process.env.NEXT_PUBLIC_APP_URL
    delete process.env.APP_ALLOWED_ORIGINS
  })

  afterAll(() => {
    restoreEnv()
  })

  describe('rejects', () => {
    test('a top-level cross-site form POST (Sec-Fetch-Site: cross-site + foreign Origin)', async () => {
      const res = await POST(buildLoginRequest({
        headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' },
      }))
      await expectRejectedWithoutSession(res)
    })

    test('a multipart cross-site form POST', async () => {
      const form = new FormData()
      form.append('email', 'attacker@example.com')
      form.append('password', 'attacker-secret')
      const res = await POST(new Request('http://localhost:3000/api/auth/login', {
        method: 'POST',
        headers: { host: 'localhost:3000', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
        body: form,
      }))
      await expectRejectedWithoutSession(res)
    })

    test('a foreign Origin from a browser that does not send Fetch Metadata', async () => {
      const res = await POST(buildLoginRequest({ headers: { origin: 'https://evil.example' } }))
      await expectRejectedWithoutSession(res)
    })

    test('an opaque Origin: null (sandboxed iframe / data: URL submission)', async () => {
      const res = await POST(buildLoginRequest({ headers: { origin: 'null' } }))
      await expectRejectedWithoutSession(res)
    })

    test('Sec-Fetch-Site: cross-site even when Origin was stripped', async () => {
      const res = await POST(buildLoginRequest({ headers: { 'sec-fetch-site': 'cross-site' } }))
      await expectRejectedWithoutSession(res)
    })

    test('Sec-Fetch-Site: same-site from a sibling origin that is not allowlisted', async () => {
      process.env.APP_URL = 'https://app.example.com'
      const res = await POST(buildLoginRequest({
        url: 'https://app.example.com/api/auth/login',
        headers: { host: 'app.example.com', origin: 'https://blog.example.com', 'sec-fetch-site': 'same-site' },
      }))
      await expectRejectedWithoutSession(res)
    })

    test('the rejection happens before the rate limiter consumes a point', async () => {
      await POST(buildLoginRequest({
        headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
      }))
      expect(checkAuthRateLimitMock).not.toHaveBeenCalled()
    })
  })

  describe('keeps working', () => {
    test('the first-party login page (same-origin fetch with FormData)', async () => {
      const form = new FormData()
      form.append('email', 'user@example.com')
      form.append('password', 'secret')
      const res = await POST(new Request('http://localhost:3000/api/auth/login', {
        method: 'POST',
        headers: { host: 'localhost:3000', origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors' },
        body: form,
      }))
      await expectSessionIssued(res)
    })

    test('non-browser clients that send neither Origin nor Sec-Fetch-Site (CLI, scripts, Playwright request)', async () => {
      const res = await POST(buildLoginRequest())
      await expectSessionIssued(res)
    })

    test('Sec-Fetch-Site: none (user-initiated, no initiator site)', async () => {
      const res = await POST(buildLoginRequest({ headers: { 'sec-fetch-site': 'none' } }))
      await expectSessionIssued(res)
    })

    test('a TLS-terminating reverse proxy that forwards X-Forwarded-Host/Proto (no Fetch Metadata)', async () => {
      const res = await POST(buildLoginRequest({
        url: 'http://app-internal:3000/api/auth/login',
        headers: {
          host: 'app-internal:3000',
          'x-forwarded-host': 'admin.example.com',
          'x-forwarded-proto': 'https',
          origin: 'https://admin.example.com',
        },
      }))
      await expectSessionIssued(res)
    })

    test('a reverse proxy that rewrites Host but the Origin matches the configured APP_URL', async () => {
      process.env.APP_URL = 'https://admin.example.com'
      const res = await POST(buildLoginRequest({
        url: 'http://app-internal:3000/api/auth/login',
        headers: { host: 'app-internal:3000', origin: 'https://admin.example.com' },
      }))
      await expectSessionIssued(res)
    })

    test('a same-origin browser request behind a proxy that forwards nothing (Fetch Metadata decides)', async () => {
      const res = await POST(buildLoginRequest({
        url: 'http://app-internal:3000/api/auth/login',
        headers: { host: 'app-internal:3000', origin: 'https://admin.example.com', 'sec-fetch-site': 'same-origin' },
      }))
      await expectSessionIssued(res)
    })

    test('an extra origin listed in APP_ALLOWED_ORIGINS posting as same-site', async () => {
      process.env.APP_URL = 'https://app.example.com'
      process.env.APP_ALLOWED_ORIGINS = 'https://ops.example.com'
      const res = await POST(buildLoginRequest({
        url: 'https://app.example.com/api/auth/login',
        headers: { host: 'app.example.com', origin: 'https://ops.example.com', 'sec-fetch-site': 'same-site' },
      }))
      await expectSessionIssued(res)
    })
  })
})
