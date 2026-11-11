import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import {
  apiRequest,
  getAuthToken,
  postForm,
  withCredentialIsolatedRequest,
} from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { customerTestPassword } from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import {
  deleteGeneralEntityIfExists,
  expectId,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'

type StaffLoginResponse = { token?: string; refreshToken?: string; error?: string }
type PortalCreateResponse = { user?: { id?: string } }
type ApiKeyCreateResponse = { id?: string; secret?: string }

export const integrationMeta = { dependsOnModules: ['auth', 'directory', 'customer_accounts', 'api_keys'] }

function readSessionCookie(response: APIResponse, name: string): string {
  const value = response.headers()['set-cookie']?.match(new RegExp(`(?:^|[,\\n]\\s*)${name}=([^;]+)`))?.[1]
  expect(value, `${name} should be issued for the active tenant`).toBeTruthy()
  return `${name}=${value}`
}

async function expectLoginRejected(response: APIResponse): Promise<void> {
  expect(response.status(), 'the tenant-owned credentials must be rejected').toBe(401)
  expect((await readJsonSafe<{ error?: string }>(response))?.error).toBe('Invalid email or password')
}

test.describe('TC-AUTH-070: tenant suspension blocks staff, portal, and API-key authentication', () => {
  for (const suspension of ['inactive', 'soft-deleted'] as const) {
    test(`${suspension} tenants cannot log in, use existing sessions, or refresh them`, async ({ request }) => {
      const superadminToken = await getAuthToken(request, 'superadmin')
      const suffix = randomUUID()
      const password = customerTestPassword()
      const staffEmail = `qa-auth-070-staff-${suffix}@example.com`
      const portalEmail = `qa-auth-070-portal-${suffix}@example.com`
      let tenantId: string | null = null
      let organizationId: string | null = null
      let roleId: string | null = null
      let staffUserId: string | null = null
      let portalUserId: string | null = null
      let apiKeyId: string | null = null
      let selectedScopeCookie = ''

      try {
        const tenantResponse = await apiRequest(request, 'POST', '/api/directory/tenants', {
          token: superadminToken,
          data: { name: `QA AUTH 070 ${suffix}` },
        })
        expect(tenantResponse.status()).toBe(201)
        tenantId = expectId((await readJsonSafe<{ id?: string }>(tenantResponse))?.id, 'tenant fixture id')
        organizationId = await createOrganizationFixture(request, superadminToken, {
          name: `QA AUTH 070 Organization ${suffix}`,
          tenantId,
        })
        selectedScopeCookie = `om_selected_tenant=${tenantId}; om_selected_org=${organizationId}`
        roleId = await createRoleFixture(request, superadminToken, {
          name: `qa-auth-070-${suffix}`,
          tenantId,
        })
        await setRoleAclFeatures(request, superadminToken, {
          roleId,
          features: ['api_keys.create', 'customer_accounts.manage'],
          organizations: [organizationId],
        })
        staffUserId = await createUserFixture(request, superadminToken, {
          email: staffEmail,
          password,
          organizationId,
          roles: [roleId],
        })

        const staffLogin = () => postForm(request, '/api/auth/login', {
          email: staffEmail,
          password,
          tenantId: tenantId ?? '',
          remember: '1',
        }, { headers: { Cookie: '' } })
        const staffLoginResponse = await staffLogin()
        expect(staffLoginResponse.status(), 'staff login should work before suspension').toBe(200)
        const staffLoginBody = await readJsonSafe<StaffLoginResponse>(staffLoginResponse)
        const staffToken = expectId(staffLoginBody?.token, 'staff access token')
        const refreshToken = expectId(staffLoginBody?.refreshToken, 'staff refresh token')
        const staffRefreshCookie = readSessionCookie(staffLoginResponse, 'session_token')

        const portalCreateResponse = await apiRequest(request, 'POST', '/api/customer_accounts/admin/users', {
          token: staffToken,
          data: { email: portalEmail, password, displayName: `QA AUTH 070 Portal ${suffix}` },
        })
        expect(portalCreateResponse.status()).toBe(201)
        portalUserId = expectId((await readJsonSafe<PortalCreateResponse>(portalCreateResponse))?.user?.id, 'portal fixture id')
        const portalLogin = () => request.post('/api/customer_accounts/login', {
          headers: { 'Content-Type': 'application/json', Cookie: '' },
          data: { email: portalEmail, password, tenantId },
        })
        const portalLoginResponse = await portalLogin()
        expect(portalLoginResponse.status(), 'portal login should work before suspension').toBe(200)
        const portalCookie = [
          readSessionCookie(portalLoginResponse, 'customer_auth_token'),
          readSessionCookie(portalLoginResponse, 'customer_session_token'),
        ].join('; ')

        const keyResponse = await apiRequest(request, 'POST', '/api/api_keys/keys', {
          token: staffToken,
          data: { name: `QA AUTH 070 Key ${suffix}`, tenantId, organizationId },
        })
        expect(keyResponse.status()).toBe(201)
        const keyBody = await readJsonSafe<ApiKeyCreateResponse>(keyResponse)
        apiKeyId = expectId(keyBody?.id, 'API-key fixture id')
        const apiKeySecret = expectId(keyBody?.secret, 'API-key fixture secret')

        await withCredentialIsolatedRequest(async (keyRequest: APIRequestContext) => {
          const authenticateKey = () => keyRequest.post('/api/auth/feature-check', {
            headers: { 'x-api-key': apiKeySecret },
            data: { features: [] },
          })
          expect((await apiRequest(request, 'GET', '/api/auth/profile', { token: staffToken })).status()).toBe(200)
          expect((await request.get('/api/customer_accounts/portal/profile', { headers: { Cookie: portalCookie } })).status()).toBe(200)
          expect((await request.post('/api/customer_accounts/portal/sessions-refresh', { headers: { Cookie: portalCookie } })).status()).toBe(200)
          expect((await authenticateKey()).status(), 'the key must authenticate before suspension').toBe(200)
          expect((await authenticateKey()).status(), 'the successful key cache must be warm before suspension').toBe(200)

          const suspensionResponse = suspension === 'inactive'
            ? await apiRequest(request, 'PUT', '/api/directory/tenants', {
                token: superadminToken,
                data: { id: tenantId, isActive: false },
              })
            : await apiRequest(request, 'DELETE', `/api/directory/tenants?id=${tenantId}`, { token: superadminToken })
          expect(suspensionResponse.status(), 'the isolated tenant should be suspended').toBe(200)

          expect((await authenticateKey()).status(), 'a warm key cache must not retain access after suspension').toBe(401)
          expect((await apiRequest(request, 'GET', '/api/auth/profile', { token: staffToken })).status(), 'the existing staff JWT must be rejected').toBe(401)
          await expectLoginRejected(await staffLogin())
          const staffRefreshResponse = await request.post('/api/auth/session/refresh', {
            headers: { Cookie: '' },
            data: { refreshToken },
          })
          expect(staffRefreshResponse.status(), 'staff API refresh must fail').toBe(401)
          const browserRefreshResponse = await request.get('/api/auth/session/refresh', {
            headers: { Cookie: staffRefreshCookie },
            maxRedirects: 0,
          })
          expect(browserRefreshResponse.status(), 'staff browser refresh must redirect to login').toBe(307)
          expect(browserRefreshResponse.headers().location).toContain('/login?')

          expect((await request.get('/api/customer_accounts/portal/profile', { headers: { Cookie: portalCookie } })).status(), 'the existing portal JWT must be rejected').toBe(401)
          expect((await request.post('/api/customer_accounts/portal/sessions-refresh', { headers: { Cookie: portalCookie } })).status(), 'portal refresh must fail').toBe(401)
          await expectLoginRejected(await portalLogin())
        })
      } finally {
        const cleanupHeaders = { Cookie: selectedScopeCookie }
        if (portalUserId) {
          const portalCleanup = await apiRequest(request, 'DELETE', `/api/customer_accounts/admin/users/${portalUserId}`, {
            token: superadminToken,
            headers: cleanupHeaders,
          }).catch(() => null)
          expect.soft(portalCleanup?.status(), 'the separate administrator must clean up the portal fixture').toBe(200)
        }
        if (apiKeyId) {
          const keyCleanup = await apiRequest(request, 'DELETE', `/api/api_keys/keys?id=${apiKeyId}`, {
            token: superadminToken,
            headers: cleanupHeaders,
          }).catch(() => null)
          expect.soft(keyCleanup?.status(), 'the separate administrator must clean up the API-key fixture').toBe(200)
        }
        await deleteUserIfExists(request, superadminToken, staffUserId)
        await deleteRoleIfExists(request, superadminToken, roleId)
        await deleteOrganizationIfExists(request, superadminToken, organizationId)
        await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/tenants', tenantId)
      }
    })
  }
})
