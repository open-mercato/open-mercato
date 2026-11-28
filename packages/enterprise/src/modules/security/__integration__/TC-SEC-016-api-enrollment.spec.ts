import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { hash } from 'bcryptjs'
import { apiRequest, postForm, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture, createRoleFixture, createUserFixture,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createSuperadminApiToken, generateTotpCode, loginViaApi } from './helpers/securityFixtures'

const READ_PATH = '/api/sales/dashboard/widgets/new-orders'
const CUSTOM_WRITE_PATH = '/api/sales/quotes/convert'

test('TC-SEC-016: a valid tenantless staff account retains authenticated API access', async () => {
  const userId = randomUUID()
  const email = `qa-mfa-tenantless-${userId}@example.test`
  const password = `Qa1!${userId}`
  const passwordHash = await hash(password, 10)
  await withClient((client) => client.query(
    'insert into users (id, email, password_hash, is_confirmed, created_at) values ($1, $2, $3, true, now())',
    [userId, email, passwordHash],
  ))

  try {
    await withCredentialIsolatedRequest(async (isolated) => {
      const session = await loginViaApi(isolated, email, password)
      expect(getTokenContext(session.token)).toEqual({ tenantId: '', organizationId: '' })
      const response = await isolated.post('/api/auth/feature-check', {
        headers: { cookie: `auth_token=${encodeURIComponent(session.token)}` },
        data: { features: [] },
      })
      expect(response.status()).toBe(200)
      expect(await response.json()).toEqual({ ok: true, granted: [], userId })
    })
  } finally {
    await withClient(async (client) => {
      await client.query('delete from sessions where user_id = $1', [userId])
      const result = await client.query('delete from users where id = $1', [userId])
      expect(result.rowCount).toBe(1)
    })
  }
})

for (const features of [
  ['*'],
  ['sales.*', 'dashboards.*', 'security.profile.*', 'security.mfa.manage', 'api_keys.create', 'api_keys.delete'],
]) {
  test(`TC-SEC-016: enrollment gates direct business APIs with ${features[0]} ACLs`, async ({ request }) => {
    const adminToken = await createSuperadminApiToken(request)
    const { tenantId } = getTokenContext(adminToken)
    const stamp = randomUUID()
    const roleName = `qa-mfa-api-${stamp}`
    const email = `${roleName}@example.com`
    const password = `Qa1!${stamp}`
    let organizationId: string | null = null
    let roleId: string | null = null
    let keyRoleId: string | null = null
    let issuerRoleId: string | null = null
    let issuerUserId: string | null = null
    let userId: string | null = null
    let policyId: string | null = null
    let keyId: string | null = null
    let quoteId: string | null = null
    try {
      organizationId = await createOrganizationFixture(request, adminToken, { name: roleName, tenantId })
      roleId = await createRoleFixture(request, adminToken, { name: roleName, tenantId })
      await setRoleAclFeatures(request, adminToken, { roleId, features, organizations: [organizationId] })
      keyRoleId = await createRoleFixture(request, adminToken, { name: `${roleName}-key`, tenantId })
      await setRoleAclFeatures(request, adminToken, {
        roleId: keyRoleId, features: ['sales.*', 'dashboards.*'], organizations: [organizationId],
      })
      const issuerRoleName = `${roleName}-issuer`
      issuerRoleId = await createRoleFixture(request, adminToken, { name: issuerRoleName, tenantId })
      await setRoleAclFeatures(request, adminToken, {
        roleId: issuerRoleId, features: ['sales.*', 'dashboards.*', 'api_keys.create'], organizations: [organizationId],
      })
      const issuerEmail = `${issuerRoleName}@example.com`
      issuerUserId = await createUserFixture(request, adminToken, {
        email: issuerEmail, password, organizationId, roles: [issuerRoleName],
      })
      const issuerSession = await loginViaApi(request, issuerEmail, password)
      expect(getTokenContext(issuerSession.token).organizationId).toBe(organizationId)
      userId = await createUserFixture(request, adminToken, { email, password, organizationId, roles: [roleName] })
      const session = await loginViaApi(request, email, password)
      expect(getTokenContext(session.token).organizationId).toBe(organizationId)
      const logoutSession = await loginViaApi(request, email, password)
      const key = await apiRequest(request, 'POST', '/api/api_keys/keys', {
        token: issuerSession.token, data: { name: roleName, roles: [keyRoleId], organizationId },
      })
      expect(key.status()).toBe(201)
      const keyBody = await readJsonSafe<{ id: string; secret: string }>(key)
      expect(keyBody?.secret).toBeTruthy()
      keyId = keyBody!.id

      const policy = await apiRequest(request, 'POST', '/api/security/enforcement', {
        token: adminToken,
        data: { scope: 'organisation', tenantId, organizationId, isEnforced: true, allowedMethods: ['totp'], enforcementDeadline: new Date(Date.now() + 86_400_000).toISOString() },
      })
      expect(policy.status()).toBe(201)
      policyId = (await readJsonSafe<{ id: string }>(policy))!.id

      await withCredentialIsolatedRequest(async (isolated) => {
        const cookie = { cookie: `auth_token=${encodeURIComponent(session.token)}` }
        const issuerCookie = { cookie: `auth_token=${encodeURIComponent(issuerSession.token)}` }
        expect((await isolated.get(READ_PATH, { headers: cookie })).status()).toBe(200)
        expect((await isolated.get(READ_PATH, { headers: issuerCookie })).status()).toBe(200)
        expect((await isolated.post(CUSTOM_WRITE_PATH, { headers: cookie, data: {} })).status()).toBe(400)

        const overdue = await apiRequest(request, 'PUT', `/api/security/enforcement/${policyId}`, {
          token: adminToken, data: { enforcementDeadline: new Date(Date.now() - 60_000).toISOString() },
        })
        expect(overdue.status()).toBe(200)
        for (const method of ['GET', 'POST'] as const) {
          const response = await isolated.fetch(method === 'GET' ? READ_PATH : CUSTOM_WRITE_PATH, {
            method, headers: cookie, ...(method === 'POST' ? { data: {} } : {}),
          })
          expect(response.status()).toBe(403)
          expect(response.headers()['set-cookie']).toBeUndefined()
        }
        expect((await isolated.get('/api/auth/profile', { headers: cookie })).status()).toBe(200)
        expect((await isolated.get('/api/security/profile', { headers: cookie })).status()).toBe(200)
        expect((await isolated.get('/api/security/mfa/providers', { headers: cookie })).status()).toBe(200)
        const refreshLogin = await postForm(isolated, '/api/auth/login', { email, password, remember: 'true' })
        expect(refreshLogin.status()).toBe(200)
        const refreshSession = await readJsonSafe<{ token: string; refreshToken: string }>(refreshLogin)
        expect(refreshSession?.refreshToken).toBeTruthy()
        const refreshCookie = {
          cookie: `auth_token=${encodeURIComponent(refreshSession!.token)}; session_token=${encodeURIComponent(refreshSession!.refreshToken)}`,
        }
        const refreshRedirect = await isolated.get('/api/auth/session/refresh?redirect=%2Fbackend', {
          headers: refreshCookie, maxRedirects: 0,
        })
        expect(refreshRedirect.status()).toBe(307)
        expect(new URL(refreshRedirect.headers().location, 'http://localhost').pathname).toBe('/backend')
        expect(refreshRedirect.headers()['set-cookie']).toContain('auth_token=')
        const refreshed = await isolated.post('/api/auth/session/refresh', {
          headers: refreshCookie, data: { refreshToken: refreshSession!.refreshToken },
        })
        expect(refreshed.status()).toBe(200)
        const refreshedSession = await readJsonSafe<{ accessToken: string }>(refreshed)
        expect(refreshedSession?.accessToken).toBeTruthy()
        expect((await isolated.get(READ_PATH, {
          headers: { cookie: `auth_token=${encodeURIComponent(refreshedSession!.accessToken)}` },
        })).status()).toBe(403)

        expect((await isolated.post('/api/auth/logout', {
          headers: { cookie: `auth_token=${encodeURIComponent(logoutSession.token)}` },
        })).status()).toBe(200)

        await withCredentialIsolatedRequest(async (keyRequest) => {
          expect((await keyRequest.get(READ_PATH, { headers: issuerCookie })).status()).toBe(403)
          expect((await keyRequest.get(READ_PATH, { headers: { 'x-api-key': keyBody!.secret } })).status()).toBe(200)
        })

        const setup = await isolated.post('/api/security/mfa/provider/totp', { headers: cookie, data: {} })
        expect(setup.status()).toBe(200)
        const enrollment = await readJsonSafe<{ setupId: string; clientData: { secret: string } }>(setup)
        expect(enrollment?.clientData.secret).toBeTruthy()
        const confirmed = await isolated.put('/api/security/mfa/provider/totp', {
          headers: cookie,
          data: { setupId: enrollment!.setupId, payload: { code: generateTotpCode(enrollment!.clientData.secret) } },
        })
        expect(confirmed.status()).toBe(200)
        expect((await isolated.get(READ_PATH, { headers: cookie })).status()).toBe(200)
        expect((await isolated.post(CUSTOM_WRITE_PATH, { headers: cookie, data: {} })).status()).toBe(400)
        const quote = await isolated.post('/api/sales/quotes', { headers: cookie, data: { currencyCode: 'USD' } })
        expect(quote.status()).toBe(201)
        quoteId = (await readJsonSafe<{ id: string }>(quote))!.id
      })
    } finally {
      const failures: string[] = []
      const removeFixture = async (path: string, options: { headers?: Record<string, string>; data?: unknown } = {}) => {
        try {
          const response = await apiRequest(request, 'DELETE', path, { token: adminToken, ...options })
          if (response.status() !== 200) failures.push(`${path}: HTTP ${response.status()}`)
        } catch {
          failures.push(`${path}: request failed`)
        }
      }
      if (policyId) await removeFixture(`/api/security/enforcement/${policyId}`)
      const scopedHeaders: Record<string, string> = organizationId ? { cookie: `om_selected_org=${organizationId}` } : {}
      if (quoteId) await removeFixture(`/api/sales/quotes?id=${quoteId}`, { headers: scopedHeaders })
      if (keyId) await removeFixture(`/api/api_keys/keys?id=${keyId}`, { headers: scopedHeaders })
      if (userId) await removeFixture(`/api/auth/users?id=${userId}`)
      if (issuerUserId) await removeFixture(`/api/auth/users?id=${issuerUserId}`)
      if (issuerRoleId) await removeFixture(`/api/auth/roles?id=${issuerRoleId}`)
      if (keyRoleId) await removeFixture(`/api/auth/roles?id=${keyRoleId}`)
      if (roleId) await removeFixture(`/api/auth/roles?id=${roleId}`)
      if (organizationId) await removeFixture('/api/directory/organizations', { data: { id: organizationId } })
      expect(failures, 'All API enrollment fixtures must be removed').toEqual([])
    }
  })
}
