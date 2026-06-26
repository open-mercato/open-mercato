/** @jest-environment node */
import { GET, POST } from '@open-mercato/core/modules/auth/api/session/refresh'

const refreshFromSessionToken = jest.fn()
const originalAppUrl = process.env.APP_URL

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
  signJwt: () => 'jwt-token',
}))

jest.mock('@open-mercato/core/modules/auth/lib/rateLimitCheck', () => ({
  checkAuthRateLimit: async () => ({ error: null }),
}))

describe('/api/auth/session/refresh', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.APP_URL = 'https://demo.openmercato.com'
  })

  afterAll(() => {
    if (originalAppUrl === undefined) {
      delete process.env.APP_URL
      return
    }
    process.env.APP_URL = originalAppUrl
  })

  it('GET clears cookies and redirects to the allowlisted app origin when session cookie is missing', async () => {
    const response = await GET(new Request('https://demo.openmercato.com/api/auth/session/refresh?redirect=%2Fbackend'))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://demo.openmercato.com/login?redirect=%2Fbackend')
    const setCookie = response.headers.get('set-cookie') || ''
    expect(setCookie).toContain('auth_token=;')
    expect(setCookie).toContain('session_token=;')
  })

  it('GET falls back to a host-relative redirect when the request origin is not allowlisted', async () => {
    const response = await GET(new Request('https://develop.openmercato.com/api/auth/session/refresh?redirect=%2Fbackend'))

    expect(response.status).toBe(307)
    // No absolute origin is emitted — the browser resolves the relative
    // Location against the real request URL, never a spoofed forwarded host.
    expect(response.headers.get('location')).toBe('/login?redirect=%2Fbackend')
  })

  it('GET does not honour a spoofed X-Forwarded-Host as the redirect origin', async () => {
    const response = await GET(new Request('https://demo.openmercato.com/api/auth/session/refresh?redirect=%2Fbackend', {
      headers: { 'x-forwarded-host': 'attacker.example' },
    }))

    expect(response.status).toBe(307)
    const location = response.headers.get('location') || ''
    expect(location).not.toContain('attacker.example')
    expect(location).toBe('/login?redirect=%2Fbackend')
  })

  it('GET sanitizes a // open-redirect bypass before forwarding to /login', async () => {
    const response = await GET(new Request('https://demo.openmercato.com/api/auth/session/refresh?redirect=%2Fbackend%2F%2Fevil.com'))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://demo.openmercato.com/login?redirect=%2F')
  })

  it('GET redirects valid browser refreshes to the allowlisted app origin', async () => {
    refreshFromSessionToken.mockResolvedValue({
      user: {
        id: 'user-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        email: 'admin@acme.com',
      },
      roles: ['admin'],
    })

    const response = await GET(new Request('https://demo.openmercato.com/api/auth/session/refresh?redirect=%2Fbackend', {
      headers: {
        cookie: 'session_token=refresh-token',
      },
    }))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://demo.openmercato.com/backend')
    expect(refreshFromSessionToken).toHaveBeenCalledWith('refresh-token')
  })

  it('POST clears cookies when refresh token is invalid', async () => {
    refreshFromSessionToken.mockResolvedValue(null)

    const response = await POST(new Request('http://localhost/api/auth/session/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: 'stale-token' }),
    }))

    expect(response.status).toBe(401)
    const setCookie = response.headers.get('set-cookie') || ''
    expect(setCookie).toContain('auth_token=;')
    expect(setCookie).toContain('session_token=;')
  })
})
