import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture, createRoleFixture, createUserFixture,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createSuperadminApiToken, generateTotpCode, loginViaApi } from './helpers/securityFixtures'

const READ_PATH = '/api/sales/dashboard/widgets/new-orders'
const CUSTOM_WRITE_PATH = '/api/sales/quotes/convert'

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
    let userId: string | null = null
    let policyId: string | null = null
    let keyId: string | null = null
    let quoteId: string | null = null
    try {
      organizationId = await createOrganizationFixture(request, adminToken, { name: roleName, tenantId })
      roleId = await createRoleFixture(request, adminToken, { name: roleName, tenantId })
      await setRoleAclFeatures(request, adminToken, { roleId, features, organizations: [organizationId] })
      userId = await createUserFixture(request, adminToken, { email, password, organizationId, roles: [roleName] })
      const session = await loginViaApi(request, email, password)
      expect(getTokenContext(session.token).organizationId).toBe(organizationId)
      const logoutSession = await loginViaApi(request, email, password)
      const key = await apiRequest(request, 'POST', '/api/api_keys/keys', {
        token: session.token, data: { name: roleName, roles: [roleId], organizationId },
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
        expect((await isolated.get(READ_PATH, { headers: cookie })).status()).toBe(200)
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
        expect((await isolated.post('/api/auth/logout', {
          headers: { cookie: `auth_token=${encodeURIComponent(logoutSession.token)}` },
        })).status()).toBe(200)

        await withCredentialIsolatedRequest(async (keyRequest) => {
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
      if (roleId) await removeFixture(`/api/auth/roles?id=${roleId}`)
      if (organizationId) await removeFixture('/api/directory/organizations', { data: { id: organizationId } })
      expect(failures, 'All API enrollment fixtures must be removed').toEqual([])
    }
  })
}
