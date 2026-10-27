import { expect, test } from '@playwright/test'
import { randomBytes, randomUUID } from 'node:crypto'
import { hash } from 'bcryptjs'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture, createUserFixture, deleteRoleIfExists, deleteUserIfExists,
  setRoleAclFeatures, setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  createOrganizationInDb, deleteOrganizationInDb, deleteUserAclInDb, withClient,
} from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

for (const keyKind of ['mcp', 'session'] as const) {
  test(`${keyKind} key preserves the owner UserAcl on cold and warm requests`, async ({ request }) => {
    const adminToken = await getAuthToken(request, 'superadmin')
    const { tenantId } = getTokenScope(adminToken)
    const stamp = randomUUID()
    const email = `ai-key-${stamp}@example.com`
    const password = `Secret-${stamp}!`
    const features = ['api_keys.create', 'ai_assistant.view', 'customers.people.view', 'directory.organizations.view']
    let roleId: string | null = null
    let userId: string | null = null
    let organizationId: string | null = null
    let foreignOrganizationId: string | null = null
    try {
      organizationId = await createOrganizationInDb({ name: `AI owner ${stamp}`, tenantId })
      foreignOrganizationId = await createOrganizationInDb({ name: `AI excluded ${stamp}`, tenantId })
      roleId = await createRoleFixture(request, adminToken, { name: `AI broad ${stamp}`, tenantId })
      await setRoleAclFeatures(request, adminToken, {
        roleId, features: [...features, 'customers.people.edit'], organizations: null,
      })
      userId = await createUserFixture(request, adminToken, { email, password, organizationId, roles: [roleId] })
      await setUserAclVisibility(request, adminToken, { userId, features, organizations: [organizationId] })
      const ownerToken = await getAuthToken(request, email, password)
      const issued = await apiRequest(request, 'POST', `/api/ai_assistant/${keyKind}-key`, {
        token: ownerToken, data: {},
      })
      expect(issued.status()).toBe(200)
      const body = await readJsonSafe<{ secret?: string; sessionToken?: string }>(issued)
      let secret = body?.secret
      if (keyKind === 'session') {
        expect(body?.sessionToken).toMatch(/^sess_[a-f0-9]{32}$/)
        secret = `omk_${randomBytes(4).toString('hex')}.${randomBytes(24).toString('hex')}`
        const keyHash = await hash(secret, 10)
        const boundRows = await withClient((client) => client.query<{ id: string }>(
          'update api_keys set key_hash = $1, key_prefix = $2 where session_token = $3 and session_user_id = $4 and tenant_id = $5 returning id',
          [keyHash, secret!.slice(0, 12), body?.sessionToken, userId, tenantId],
        ))
        expect(boundRows.rows).toHaveLength(1)
      }
      expect(secret).toMatch(/^omk_/)
      const checkFeatures = async (token: string, expected: string[]) => {
        const response = await apiRequest(request, 'POST', '/api/auth/feature-check', {
          token, data: { features: ['customers.people.view', 'customers.people.edit'] },
          headers: token.startsWith('omk_') ? { 'x-api-key': token } : {},
        })
        expect(response.status()).toBe(200)
        const result = await readJsonSafe<{ granted: string[] }>(response)
        expect(result?.granted).toEqual(expected)
      }
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await checkFeatures(ownerToken, ['customers.people.view'])
        await checkFeatures(secret!, ['customers.people.view'])
        const organizations = await apiRequest(request, 'GET', '/api/directory/organizations?pageSize=100', {
          token: secret!, headers: { Cookie: 'om_selected_org=__all__', 'x-api-key': secret! },
        })
        expect(organizations.status()).toBe(200)
        const result = await readJsonSafe<{ items: Array<{ id: string }> }>(organizations)
        expect(result?.items.map((item) => item.id)).toContain(organizationId)
        expect(result?.items.map((item) => item.id)).not.toContain(foreignOrganizationId)
      }
      await setUserAclVisibility(request, adminToken, { userId, features: [], organizations: [] })
      await checkFeatures(ownerToken, [])
      await checkFeatures(secret!, [])
    } finally {
      if (userId) {
        await withClient((client) => client.query('delete from api_keys where session_user_id = $1 and tenant_id = $2', [userId, tenantId]))
        await deleteUserAclInDb(userId)
      }
      await deleteUserIfExists(request, adminToken, userId)
      await deleteRoleIfExists(request, adminToken, roleId)
      await deleteOrganizationInDb(organizationId)
      await deleteOrganizationInDb(foreignOrganizationId)
    }
  })
}
