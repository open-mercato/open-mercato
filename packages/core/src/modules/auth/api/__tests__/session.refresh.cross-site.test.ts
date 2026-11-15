/** @jest-environment node */
import { POST } from '@open-mercato/core/modules/auth/api/session/refresh'

const refreshFromSessionToken = jest.fn()
const checkAuthRateLimitMock = jest.fn(async () => ({ error: null }))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? '',
  }),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (_name: string) => ({
      refreshFromSessionToken: (...args: unknown[]) => refreshFromSessionToken(...args),
    }),
  }),
}))

jest.mock('@open-mercato/shared/lib/auth/jwt', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/auth/jwt'),
  signJwt: () => 'fresh-jwt',
}))

jest.mock('@open-mercato/core/modules/auth/lib/rateLimitCheck', () => ({
  checkAuthRateLimit: (...args: unknown[]) => checkAuthRateLimitMock(...(args as [])),
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

function textPlainRefreshBody(): string {
  return '{"refreshToken":"attacker-session-token","padding":"="}'
}

function buildRefreshRequest(headers: Record<string, string>, body = textPlainRefreshBody()) {
  return new Request('http://localhost:3000/api/auth/session/refresh', {
    method: 'POST',
    headers: { host: 'localhost:3000', ...headers },
    body,
  })
}

describe('POST /api/auth/session/refresh — cross-site browser submissions (#7239)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    restoreEnv()
    delete process.env.APP_URL
    delete process.env.NEXT_PUBLIC_APP_URL
    delete process.env.APP_ALLOWED_ORIGINS
    refreshFromSessionToken.mockResolvedValue({
      user: { id: 'attacker-id', email: 'attacker@example.com', tenantId: null, organizationId: null },
      roles: [],
      session: { id: 'attacker-session' },
    })
  })

  afterAll(() => {
    restoreEnv()
  })

  test.each([
    ['a text/plain cross-site form', { 'content-type': 'text/plain', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' }],
    ['a foreign Origin without Fetch Metadata', { 'content-type': 'text/plain', origin: 'https://evil.example' }],
    ['an opaque Origin: null', { 'content-type': 'text/plain', origin: 'null' }],
  ])('rejects %s with 403 and leaves the session cookies alone', async (_label, headers) => {
    const res = await POST(buildRefreshRequest(headers))

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(typeof body.error).toBe('string')
    expect(body.accessToken).toBeUndefined()
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(checkAuthRateLimitMock).not.toHaveBeenCalled()
    expect(refreshFromSessionToken).not.toHaveBeenCalled()
  })

  test('keeps serving API and mobile clients that send no browser headers', async () => {
    const res = await POST(buildRefreshRequest({ 'content-type': 'application/json' }, JSON.stringify({ refreshToken: 'session-token' })))

    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie') ?? '').toContain('auth_token=fresh-jwt')
    expect(refreshFromSessionToken).toHaveBeenCalledWith('session-token')
  })

  test('keeps serving a same-origin browser request', async () => {
    const res = await POST(buildRefreshRequest(
      { 'content-type': 'application/json', origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin' },
      JSON.stringify({ refreshToken: 'session-token' }),
    ))

    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie') ?? '').toContain('auth_token=fresh-jwt')
    expect(refreshFromSessionToken).toHaveBeenCalledWith('session-token')
  })
})
