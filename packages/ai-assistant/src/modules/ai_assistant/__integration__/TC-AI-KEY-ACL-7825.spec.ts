import { expect, test } from '@playwright/test'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { hash } from 'bcryptjs'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture, createUserFixture, deleteRoleIfExists, deleteUserIfExists,
  setRoleAclFeatures, setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  clearUserHomeOrganization, createOrganizationInDb, deleteOrganizationInDb, deleteUserAclInDb, withClient,
} from '@open-mercato/core/helpers/integration/dbFixtures'
import { deleteEntityByBody } from '@open-mercato/core/helpers/integration/crmFixtures'
import { expectId, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

for (const { keyKind, floating } of [
  { keyKind: 'mcp', floating: false },
  { keyKind: 'session', floating: false },
  { keyKind: 'mcp', floating: true },
] as const) {
  test(`${floating ? 'tenant-wide ' : ''}${keyKind} key preserves the owner UserAcl on cold and warm requests`, async ({ request }) => {
    const adminToken = await getAuthToken(request, 'superadmin')
    const { tenantId } = getTokenScope(adminToken)
    const stamp = randomUUID()
    const email = `ai-key-${stamp}@example.com`
    const password = `Secret-${stamp}!`
    const features = ['api_keys.create', 'ai_assistant.view', 'customers.people.view']
    const personIds: string[] = []
    let roleId: string | null = null
    let userId: string | null = null
    let organizationId: string | null = null
    let foreignOrganizationId: string | null = null
    try {
      organizationId = await createOrganizationInDb({ name: `AI owner ${stamp}`, tenantId })
      foreignOrganizationId = await createOrganizationInDb({ name: `AI excluded ${stamp}`, tenantId })
      for (const fixtureOrganizationId of [organizationId, foreignOrganizationId]) {
        const person = await apiRequest(request, 'POST', '/api/customers/people', {
          token: adminToken,
          headers: { Cookie: `om_selected_org=${fixtureOrganizationId}` },
          data: { firstName: 'AI ACL', lastName: stamp, displayName: `AI ACL ${stamp} ${fixtureOrganizationId}` },
        })
        expect(person.status()).toBe(201)
        const created = await readJsonSafe<{ id?: string }>(person)
        personIds.push(expectId(created?.id, 'Person fixture must return an id'))
      }
      roleId = await createRoleFixture(request, adminToken, { name: `AI broad ${stamp}`, tenantId })
      await setRoleAclFeatures(request, adminToken, {
        roleId, features: [...features, 'customers.people.manage'], organizations: null,
      })
      userId = await createUserFixture(request, adminToken, { email, password, organizationId, roles: [roleId] })
      await setUserAclVisibility(request, adminToken, { userId, features, organizations: [organizationId] })
      if (floating) await clearUserHomeOrganization(userId)
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
          'update api_keys set key_hash = $1, key_prefix = $2 where session_token_hash = $3 and session_user_id = $4 and tenant_id = $5 returning id',
          [keyHash, secret!.slice(0, 12), createHash('sha256').update(body!.sessionToken!).digest('hex'), userId, tenantId],
        ))
        expect(boundRows.rows).toHaveLength(1)
      }
      expect(secret).toMatch(/^omk_/)
      const checkFeatures = async (token: string, expected: string[]) => {
        const response = await apiRequest(request, 'POST', '/api/auth/feature-check', {
          token, data: { features: ['customers.people.view', 'customers.people.manage'] },
          headers: token.startsWith('omk_') ? { 'x-api-key': token } : {},
        })
        expect(response.status()).toBe(200)
        const result = await readJsonSafe<{ granted: string[] }>(response)
        expect(result?.granted).toEqual(expected)
      }
      const checkPeople = async (token: string, expectedId: string) => {
        const people = await apiRequest(request, 'GET', `/api/customers/people?ids=${personIds.join(',')}&pageSize=100`, {
          token,
          headers: { Cookie: 'om_selected_org=__all__', ...(token.startsWith('omk_') ? { 'x-api-key': token } : {}) },
        })
        expect(people.status()).toBe(200)
        const result = await readJsonSafe<{ items: Array<{ id: string }> }>(people)
        expect(result?.items.map((item) => item.id)).toEqual([expectedId])
      }
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await checkFeatures(ownerToken, ['customers.people.view'])
        await checkFeatures(secret!, ['customers.people.view'])
        for (const token of [ownerToken, secret!]) {
          await checkPeople(token, personIds[0])
          const denied = await apiRequest(request, 'PUT', '/api/customers/people', {
            token,
            headers: token.startsWith('omk_') ? { 'x-api-key': token } : {},
            data: { id: personIds[0], displayName: `Denied ${stamp}` },
          })
          expect(denied.status()).toBe(403)
        }
      }
      if (floating) {
        await setUserAclVisibility(request, adminToken, { userId, features, organizations: [foreignOrganizationId] })
        for (const token of [ownerToken, secret!]) {
          await checkFeatures(token, ['customers.people.view'])
          await checkPeople(token, personIds[1])
        }
      }
      await setUserAclVisibility(request, adminToken, { userId, features: ['ai_assistant.view'], organizations: [] })
      const persistedAcl = await apiRequest(request, 'GET', `/api/auth/users/acl?userId=${userId}`, { token: adminToken })
      expect(persistedAcl.status()).toBe(200)
      const acl = await readJsonSafe<{ hasCustomAcl: boolean; features: string[]; organizations: string[] }>(persistedAcl)
      expect(acl).toMatchObject({ hasCustomAcl: true, features: ['ai_assistant.view'], organizations: [] })
      await checkFeatures(ownerToken, [])
      await checkFeatures(secret!, [])
    } finally {
      for (const personId of personIds) await deleteEntityByBody(request, adminToken, '/api/customers/people', personId)
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
