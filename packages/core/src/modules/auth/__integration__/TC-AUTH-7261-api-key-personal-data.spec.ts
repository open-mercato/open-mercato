import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture, createRoleFixture, createUserFixture,
  deleteOrganizationIfExists, deleteRoleIfExists, deleteUserIfExists, setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { customerTestPassword } from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import { deleteGeneralEntityIfExists, expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'

export const integrationMeta = { dependsOnModules: ['auth', 'api_keys', 'dashboards', 'directory'] }

test('TC-AUTH-7261: personal API-key data stays within the binding and key permissions', async ({ request }) => {
  const administrator = await getAuthToken(request, 'superadmin')
  const suffix = randomUUID()
  const password = customerTestPassword()
  const email = `qa-7261-${suffix}@example.com`
  const tenants: string[] = []
  const organizations: string[] = []
  const roles: string[] = []
  const keys: Array<{ id: string; secret: string }> = []
  let userId: string | null = null
  let cleanupCookie = ''

  try {
    for (const label of ['home', 'foreign']) {
      const response = await apiRequest(request, 'POST', '/api/directory/tenants', {
        token: administrator, data: { name: `QA 7261 ${label} ${suffix}` },
      })
      expect(response.status()).toBe(201)
      tenants.push(expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'tenant fixture'))
    }
    for (const label of ['home', 'other']) {
      organizations.push(await createOrganizationFixture(request, administrator, {
        name: `QA 7261 ${label} ${suffix}`, tenantId: tenants[0],
      }))
    }
    cleanupCookie = `om_selected_tenant=${tenants[0]}; om_selected_org=${organizations[0]}`
    for (const [label, features] of [
      ['owner', ['api_keys.*', 'dashboards.*']],
      ['reader', ['dashboards.view']],
    ] as const) {
      const roleId = await createRoleFixture(request, administrator, { name: `qa-7261-${label}-${suffix}`, tenantId: tenants[0] })
      roles.push(roleId)
      await setRoleAclFeatures(request, administrator, { roleId, features: [...features], organizations: [organizations[0]] })
    }
    userId = await createUserFixture(request, administrator, {
      email, password, organizationId: organizations[0], roles: [roles[0]], name: 'Personal API key fixture',
    })
    const userToken = await getAuthToken(request, email, password)
    for (const label of ['allowed', 'restricted', 'unbound', 'foreign-tenant', 'foreign-org']) {
      const response = await apiRequest(request, 'POST', '/api/api_keys/keys', {
        token: userToken,
        data: { name: `qa-7261-${label}-${suffix}`, roles: [roles[label === 'restricted' ? 1 : 0]], organizationId: organizations[0] },
      })
      expect(response.status()).toBe(201)
      const body = await readJsonSafe<{ id?: string; secret?: string }>(response)
      keys.push({ id: expectId(body?.id, 'API-key fixture'), secret: expectId(body?.secret, 'one-time key') })
    }
    await withClient(async (client) => {
      await client.query('update api_keys set created_by = null where id = $1 and tenant_id = $2', [keys[2].id, tenants[0]])
      await client.query('update api_keys set tenant_id = $1 where id = $2 and tenant_id = $3', [tenants[1], keys[3].id, tenants[0]])
      await client.query('update api_keys set organization_id = $1 where id = $2 and tenant_id = $3', [organizations[1], keys[4].id, tenants[0]])
    })

    for (const endpoint of ['/api/auth/profile', '/api/dashboards/layout']) {
      const bearer = await apiRequest(request, 'GET', endpoint, { token: userToken })
      const cookie = await request.get(endpoint, { headers: { Cookie: `auth_token=${userToken}` } })
      const bound = await request.get(endpoint, { headers: { 'x-api-key': keys[0].secret, Cookie: '' } })
      expect(bearer.status()).toBe(200)
      expect(cookie.status()).toBe(200)
      expect(bound.status()).toBe(200)
      const boundBody = await readJsonSafe<{ email?: string; roles?: string[]; context?: { userId?: string; tenantId?: string; organizationId?: string } }>(bound)
      if (endpoint === '/api/auth/profile') {
        expect(boundBody?.email).toBe(email)
      } else {
        expect(boundBody?.context).toMatchObject({ userId, tenantId: tenants[0], organizationId: organizations[0] })
      }
      const unbound = await request.get(endpoint, { headers: { 'x-api-key': keys[2].secret, Cookie: '' } })
      expect(unbound.status()).toBe(403)
      for (const key of keys.slice(3)) {
        const denied = await request.get(endpoint, { headers: { 'x-api-key': key.secret, Cookie: '' } })
        expect(denied.status()).toBe(401)
      }
      expect((await request.get(endpoint, { headers: { Cookie: '' } })).status()).toBe(401)
    }

    const restrictedHeaders = { 'x-api-key': keys[1].secret, Cookie: '' }
    const restrictedLayout = await request.get('/api/dashboards/layout', { headers: restrictedHeaders })
    expect(restrictedLayout.status()).toBe(200)
    expect((await readJsonSafe<{ canConfigure?: boolean }>(restrictedLayout))?.canConfigure).toBe(false)
    const restrictedProfile = await request.get('/api/auth/profile', { headers: restrictedHeaders })
    expect(restrictedProfile.status()).toBe(200)
    expect((await readJsonSafe<{ roles?: string[] }>(restrictedProfile))?.roles).toEqual([`qa-7261-reader-${suffix}`])
    expect((await request.put('/api/dashboards/layout', { headers: restrictedHeaders, data: { items: [] } })).status()).toBe(403)
    const profileUpdate = await request.put('/api/auth/profile', { headers: restrictedHeaders, data: { email: `changed-${email}` } })
    expect(profileUpdate.status()).toBe(403)
    expect(profileUpdate.headers()['set-cookie'] ?? '').not.toContain('auth_token=')
    const profileAfter = await apiRequest(request, 'GET', '/api/auth/profile', { token: userToken })
    expect((await readJsonSafe<{ email?: string }>(profileAfter))?.email).toBe(email)
  } finally {
    if (keys.length > 0) {
      await withClient(async (client) => {
        await client.query('update api_keys set tenant_id = $1, organization_id = $2 where id = any($3::uuid[])', [tenants[0], organizations[0], keys.map((key) => key.id)])
      })
      for (const key of keys) {
        await apiRequest(request, 'DELETE', `/api/api_keys/keys?id=${key.id}`, { token: administrator, headers: { Cookie: cleanupCookie } })
      }
    }
    if (userId) {
      await withClient(async (client) => {
        await client.query('delete from dashboard_layouts where user_id = $1 and tenant_id = $2', [userId, tenants[0]])
      })
    }
    await deleteUserIfExists(request, administrator, userId)
    for (const roleId of roles.reverse()) await deleteRoleIfExists(request, administrator, roleId)
    for (const organizationId of organizations.reverse()) await deleteOrganizationIfExists(request, administrator, organizationId)
    for (const tenantId of tenants.reverse()) await deleteGeneralEntityIfExists(request, administrator, '/api/directory/tenants', tenantId)
  }
})
