/** @jest-environment node */
import { POST } from '@open-mercato/core/modules/auth/api/login'
import { randomUUID } from 'crypto'

const tenantId = randomUUID()
const orgId = randomUUID()

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? '',
  }),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (_: string) => ({
      findUserByEmail: async (email: string) => ({ id: 1, email, passwordHash: 'hash', tenantId: tenantId, organizationId: orgId }),
      findUsersByEmail: async (email: string) => ([{ id: 1, email, passwordHash: 'hash', tenantId: tenantId, organizationId: orgId }]),
      findUserByEmailAndTenant: async (email: string) => ({ id: 1, email, passwordHash: 'hash', tenantId: tenantId, organizationId: orgId }),
      verifyPassword: async () => true,
      getUserRoles: async (_user: any, _tenant: string | null | undefined) => ['admin'],
      updateLastLoginAt: async () => undefined,
      createSession: async (_user: any, _exp: Date) => ({ token: 'session-token' }),
    }),
  }),
}))

jest.mock('@open-mercato/shared/lib/auth/jwt', () => ({ signJwt: () => 'jwt-token' }))

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
