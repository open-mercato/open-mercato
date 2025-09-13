/** @jest-environment node */
import { POST } from '@/modules/auth/api/login'

jest.mock('@/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (_: string) => ({
      findUserByEmail: async (email: string) => ({ id: 1, email, passwordHash: 'hash', tenant: { id: 1 }, organization: { id: 1 } }),
      verifyPassword: async () => true,
      getUserRoles: async () => ['admin'],
      updateLastLoginAt: async () => undefined,
      createSession: async (_user: any, _exp: Date) => ({ token: 'session-token' }),
    }),
  }),
}))

jest.mock('@/lib/auth/jwt', () => ({ signJwt: () => 'jwt-token' }))

function makeFormData(data: Record<string, string>) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(data)) fd.append(k, v)
  return fd
}

describe('POST /api/auth/login', () => {
  it('returns token and sets cookies on success', async () => {
    const req = new Request('http://localhost/api/auth/login', { method: 'POST', body: makeFormData({ email: 'user@example.com', password: 'secret', remember: '1' }) })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('"ok":true')
    expect(text).toContain('"token":"jwt-token"')
    const setCookie = res.headers.get('set-cookie') || ''
    expect(setCookie).toContain('auth_token=')
  })
})

