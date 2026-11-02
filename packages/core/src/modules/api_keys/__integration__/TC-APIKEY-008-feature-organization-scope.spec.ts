import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

test('TC-APIKEY-008: unrelated global grants do not expose tenant-wide API keys', async ({ request }) => {
  const adminToken = await getAuthToken(request, 'admin')
  const marker = randomUUID()
  const roles: string[] = []
  const keys: string[] = []
  let organizationId: string | null = null
  let userId: string | null = null
  try {
    organizationId = await createOrganizationFixture(request, adminToken, { name: `API key scope ${marker}` })
    const keyRoleId = await createRoleFixture(request, adminToken, { name: `Key viewer ${marker}` })
    roles.push(keyRoleId)
    await setRoleAclFeatures(request, adminToken, { roleId: keyRoleId, features: ['api_keys.view'], organizations: [organizationId] })
    const unrelatedRoleId = await createRoleFixture(request, adminToken, { name: `Global catalog ${marker}` })
    roles.push(unrelatedRoleId)
    await setRoleAclFeatures(request, adminToken, { roleId: unrelatedRoleId, features: ['catalog.products.view'], organizations: null })
    const email = `api-key-scope-${marker}@example.com`
    const password = `Test-${randomUUID()}!`
    userId = await createUserFixture(request, adminToken, { email, password, organizationId, roles })
    for (const scope of [organizationId, null]) {
      const response = await apiRequest(request, 'POST', '/api/api_keys/keys', {
        token: adminToken,
        data: { name: `${marker}-${scope ? 'organization' : 'tenant'}`, organizationId: scope, roles: [] },
      })
      expect(response.status()).toBe(201)
      const body = await readJsonSafe<{ id: string }>(response)
      expect(body?.id).toBeTruthy()
      keys.push(body!.id)
    }
    const actorToken = await getAuthToken(request, email, password)
    const response = await apiRequestWithSelectedOrg(request, 'GET', `/api/api_keys/keys?search=${marker}&pageSize=100`, {
      token: actorToken,
      selectedOrgId: organizationId,
    })
    expect(response.status()).toBe(200)
    const body = await readJsonSafe<{ items: { id: string }[]; total: number }>(response)
    expect(body?.items.map((item) => item.id)).toEqual([keys[0]])
    expect(body?.total).toBe(1)
  } finally {
    for (const id of keys.reverse()) {
      await apiRequest(request, 'DELETE', `/api/api_keys/keys?id=${encodeURIComponent(id)}`, { token: adminToken }).catch(() => undefined)
    }
    await deleteUserIfExists(request, adminToken, userId)
    for (const id of roles.reverse()) await deleteRoleIfExists(request, adminToken, id)
    await deleteOrganizationIfExists(request, adminToken, organizationId)
  }
})
