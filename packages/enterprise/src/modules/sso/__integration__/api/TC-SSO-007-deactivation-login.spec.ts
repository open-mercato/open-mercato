import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import {
  createOrganizationFixture, createUserFixture, deleteOrganizationIfExists, deleteUserIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { createSsoConfigFixture, createScimTokenFixture, scimRequest } from '../helpers/ssoFixtures'
import { runSignInRevocationRace } from '../helpers/signInRevocationRace'

test.describe('TC-SSO-007: SCIM deactivation blocks sign-in', () => {
  for (const configTenant of ['explicit', 'omitted'] as const) {
    for (const deactivationMethod of ['PATCH', 'POST'] as const) {
      test(`revokes sessions and blocks sign-in with ${configTenant} config tenant and ${deactivationMethod} deactivation`, async ({ request }) => {
        const adminToken = await getAuthToken(request, 'superadmin')
        const { tenantId } = getTokenContext(adminToken)
        const stamp = randomUUID()
        const email = `scim-login-${stamp}@example.com`
        const otherEmail = `scim-active-${stamp}@example.com`
        const password = `Test-${randomUUID()}!`
        let organizationId: string | null = null
        let userId: string | null = null
        let otherOrganizationId: string | null = null
        let otherUserId: string | null = null
        let identityId: string | null = null
        let rawScimToken: string | null = null
        let cleanupConfig: (() => Promise<void>) | undefined
        let cleanupScimToken: (() => Promise<void>) | undefined

        const signIn = (loginEmail = email) => request.post('/api/auth/login', {
          form: { email: loginEmail, password, tenantId, remember: 'true' },
        })

        try {
          organizationId = await createOrganizationFixture(request, adminToken, { name: `SCIM login ${stamp}`, tenantId })
          userId = await createUserFixture(request, adminToken, { email, password, organizationId, roles: [] })
          otherOrganizationId = await createOrganizationFixture(request, adminToken, { name: `SCIM active ${stamp}`, tenantId })
          otherUserId = await createUserFixture(request, adminToken, {
            email: otherEmail, password, organizationId: otherOrganizationId, roles: [],
          })
          const config = await createSsoConfigFixture(request, adminToken, {
            organizationId, ...(configTenant === 'explicit' ? { tenantId } : {}),
            jitEnabled: false, issuer: 'https://idp.example.com',
            allowedDomains: ['example.com'],
          })
          cleanupConfig = config.cleanup
          const scimToken = await createScimTokenFixture(request, adminToken, config.configId)
          rawScimToken = scimToken.rawToken
          cleanupScimToken = scimToken.cleanup
          await withClient(async (client) => {
            await client.query(
              'update sso_configs set is_active = true where id = $1 and organization_id = $2 and tenant_id is not distinct from $3',
              [config.configId, organizationId, configTenant === 'explicit' ? tenantId : null],
            )
          })
          const provisionUser = (active: boolean) => scimRequest(request, 'POST', '/api/sso/scim/v2/Users', rawScimToken!, {
            schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
            userName: email, externalId: stamp, active,
          })

          const firstLogin = await signIn()
          expect(firstLogin.status()).toBe(200)
          const firstBody = await readJsonSafe<{ token: string; refreshToken: string }>(firstLogin)
          expect(firstBody?.token).toBeTruthy()
          expect(firstBody?.refreshToken).toBeTruthy()
          const oldToken = firstBody!.token
          const oldRefreshToken = firstBody!.refreshToken
          expect((await apiRequest(request, 'GET', '/api/auth/profile', { token: oldToken })).status()).toBe(200)

          const setActive = (active: boolean) => scimRequest(request, 'PATCH', `/api/sso/scim/v2/Users/${identityId}`, rawScimToken!, {
            schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
            Operations: [{ op: 'replace', path: 'active', value: active }],
          })
          if (deactivationMethod === 'PATCH') {
            const provision = await provisionUser(true)
            expect(provision.status()).toBe(201)
            identityId = (await readJsonSafe<{ id: string }>(provision))?.id ?? null
            expect(identityId).toBeTruthy()
          }
          const first = configTenant === 'explicit' ? 'deactivation' : 'session'
          const { deactivated, racedLogin } = await runSignInRevocationRace({
            userId,
            first,
            signIn,
            deactivate: deactivationMethod === 'PATCH' ? () => setActive(false) : () => provisionUser(false),
          })
          expect(deactivated.status()).toBe(deactivationMethod === 'PATCH' ? 200 : 201)
          const deactivatedBody = await readJsonSafe<{ active: boolean; id: string }>(deactivated)
          expect(deactivatedBody?.active).toBe(false)
          identityId = deactivatedBody?.id ?? identityId
          expect(identityId).toBeTruthy()
          expect(racedLogin.status()).toBe(first === 'deactivation' ? 401 : 200)
          const racedBody = await readJsonSafe<{ token?: string; refreshToken?: string }>(racedLogin)
          if (first === 'session') {
            expect(racedBody?.token).toBeTruthy()
            expect((await apiRequest(request, 'GET', '/api/auth/profile', { token: racedBody!.token! })).status()).toBe(401)
            expect((await request.post('/api/auth/session/refresh', {
              data: { refreshToken: racedBody!.refreshToken },
            })).status()).toBe(401)
          } else {
            expect(racedBody?.token).toBeUndefined()
          }
          expect((await apiRequest(request, 'GET', '/api/auth/profile', { token: oldToken })).status()).toBe(401)
          const refresh = await request.get('/api/auth/session/refresh', {
            headers: { Cookie: `session_token=${oldRefreshToken}` },
            maxRedirects: 0,
          })
          expect(refresh.status()).toBe(307)
          expect(new URL(refresh.headers().location, refresh.url()).pathname).toBe('/login')
          const apiRefresh = await request.post('/api/auth/session/refresh', {
            data: { refreshToken: oldRefreshToken },
          })
          expect(apiRefresh.status()).toBe(401)
          expect((await readJsonSafe<Record<string, unknown>>(apiRefresh))?.accessToken).toBeUndefined()

          const deniedLogin = await signIn()
          expect(deniedLogin.status()).toBe(401)
          expect((await readJsonSafe<Record<string, unknown>>(deniedLogin))?.token).toBeUndefined()
          expect(deniedLogin.headers()['set-cookie'] ?? '').not.toContain('auth_token=')
          expect((await signIn(otherEmail)).status()).toBe(200)

          const reactivated = await setActive(true)
          expect(reactivated.status()).toBe(200)
          expect((await readJsonSafe<{ active: boolean }>(reactivated))?.active).toBe(true)
          const restoredLogin = await signIn()
          expect(restoredLogin.status()).toBe(200)
          expect((await readJsonSafe<{ token: string }>(restoredLogin))?.token).toBeTruthy()
          expect((await apiRequest(request, 'GET', '/api/auth/profile', { token: oldToken })).status()).toBe(401)
        } finally {
          if (identityId && rawScimToken) {
            await scimRequest(request, 'DELETE', `/api/sso/scim/v2/Users/${identityId}`, rawScimToken).catch(() => undefined)
          }
          await cleanupScimToken?.()
          await cleanupConfig?.()
          await deleteUserIfExists(request, adminToken, userId)
          await deleteUserIfExists(request, adminToken, otherUserId)
          await deleteOrganizationIfExists(request, adminToken, organizationId)
          await deleteOrganizationIfExists(request, adminToken, otherOrganizationId)
        }
      })
    }
  }
})
