import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, postForm, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

test.use({ trace: 'off' })

/**
 * The managed ephemeral runner calls the real `initialize` command against its
 * disposable PostgreSQL container before starting the app. Run fresh with:
 * yarn test:integration:ephemeral TC-AUTH-7809 --no-reuse-env
 * Bootstrap users belong to that container; this test only owns login sessions.
 * Credential-bearing requests must not be retained in retry traces or errors.
 */
test.describe('TC-AUTH-7809: Initialized bootstrap credentials', () => {
  test('rejects former superadmin placeholders, accepts the bootstrap credential, and preserves demo admin login', async () => {
    test.skip(process.env.OM_INTEGRATION_TEST !== 'true', 'Requires the managed disposable initialization environment')

    const superadminEmail = process.env.OM_INIT_SUPERADMIN_EMAIL?.trim() || 'superadmin@acme.com'
    const superadminPassword = process.env.OM_INIT_SUPERADMIN_PASSWORD
    expect(Boolean(superadminPassword?.trim()), 'The runner must forward its actual initialization credential').toBe(true)
    if (!superadminPassword) throw new Error('[internal] Missing ephemeral bootstrap credential')

    const domain = superadminEmail.split('@')[1]
    const adminEmail = process.env.OM_INIT_ADMIN_EMAIL?.trim() || `admin@${domain}`
    const adminPassword = process.env.OM_INIT_ADMIN_PASSWORD?.trim() || 'secret'

    await withCredentialIsolatedRequest(async (request) => {
      const tokens: string[] = []
      const attemptLogin = async (email: string, password: string, role: string) => {
        const response = await postForm(request, '/api/auth/login', { email, password, requireRole: role })
          .catch(() => { throw new Error('[internal] Bootstrap login request failed') })
        const body = await readJsonSafe<{ ok?: boolean; token?: unknown }>(response)
        const token = typeof body?.token === 'string' ? body.token : ''
        if (token) tokens.push(token)
        return { status: response.status(), ok: body?.ok, token }
      }

      try {
        for (const placeholder of ['secret', 'password']) {
          const rejected = await attemptLogin(superadminEmail, placeholder, 'superadmin')
          expect(rejected.status, 'Former superadmin placeholder must fail real password verification').toBe(401)
          expect(rejected.ok).toBe(false)
          expect(Boolean(rejected.token), 'Rejected login must not issue a token').toBe(false)
        }

        const superadmin = await attemptLogin(superadminEmail, superadminPassword, 'superadmin')
        expect(superadmin.status, 'The credential passed to initialization must authenticate the persisted superadmin').toBe(200)
        expect(superadmin.ok).toBe(true)
        expect(Boolean(superadmin.token), 'Successful bootstrap login must issue a token').toBe(true)
        await expectAuthenticatedUsers(request, superadmin.token)

        const admin = await attemptLogin(adminEmail, adminPassword, 'admin')
        expect(admin.status, 'Initialization must preserve the intended derived demo-admin credential').toBe(200)
        expect(admin.ok).toBe(true)
        expect(Boolean(admin.token), 'Successful demo-admin login must issue a token').toBe(true)
        await expectAuthenticatedUsers(request, admin.token)

        const superadminScope = getTokenScope(superadmin.token)
        const adminScope = getTokenScope(admin.token)
        expect(Boolean(superadminScope.userId && adminScope.userId)).toBe(true)
        if (adminEmail.toLowerCase() !== superadminEmail.toLowerCase()) {
          expect(adminScope.userId === superadminScope.userId, 'Demo admin must be a separate persisted user').toBe(false)
        }
        expect(Boolean(superadminScope.tenantId)).toBe(true)
        expect(adminScope.tenantId).toBe(superadminScope.tenantId)
        expect(adminScope.organizationId).toBe(superadminScope.organizationId)
      } finally {
        const logouts = await Promise.allSettled(tokens.map((token) => request.post('/api/auth/logout', {
          headers: { Cookie: `auth_token=${token}` },
          maxRedirects: 0,
        })))
        expect(logouts.every((result) => result.status === 'fulfilled' && result.value.status() === 303),
          'Revoke every session issued by this test').toBe(true)
      }
    })
  })
})

async function expectAuthenticatedUsers(request: APIRequestContext, token: string): Promise<void> {
  const response = await apiRequest(request, 'GET', '/api/auth/users?pageSize=1', { token })
    .catch(() => { throw new Error('[internal] Bootstrap authenticated request failed') })
  expect(response.status(), 'Issued bootstrap session must authorize a real protected API request').toBe(200)
}
