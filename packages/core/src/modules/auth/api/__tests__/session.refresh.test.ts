/** @jest-environment node */
import { GET, POST } from '@open-mercato/core/modules/auth/api/session/refresh'

const refreshFromSessionToken = jest.fn()

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

describe('/api/auth/session/refresh', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('GET clears cookies when session cookie is missing', async () => {
    const response = await GET(new Request('http://localhost/api/auth/session/refresh?redirect=%2Fbackend'))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('/login?redirect=%2Fbackend')
    const setCookie = response.headers.get('set-cookie') || ''
    expect(setCookie).toContain('auth_token=;')
    expect(setCookie).toContain('session_token=;')
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
