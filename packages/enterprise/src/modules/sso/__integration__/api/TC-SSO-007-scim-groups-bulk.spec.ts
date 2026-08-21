import { expect, test } from '@playwright/test'
import {
  activateConfigFixture,
  addDomainFixture,
  apiRequest,
  createScimTokenFixture,
  createSsoConfigFixture,
  getAuthToken,
  scimRequest,
} from '../helpers/ssoFixtures'

test.describe('TC-SSO-007: SCIM groups and bulk provisioning', () => {
  test('supports Entra-compatible group membership and bulk operations', async ({ request }) => {
    const authToken = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const { configId, cleanup: cleanupConfig } = await createSsoConfigFixture(request, authToken, {
      jitEnabled: false,
      issuer: 'https://accounts.google.com',
    })
    const { tokenId, rawToken, cleanup: cleanupToken } = await createScimTokenFixture(request, authToken, configId)
    await addDomainFixture(request, authToken, configId, `scim-groups-${stamp}.example.com`)
    await activateConfigFixture(request, authToken, configId)

    const createdUserIds: string[] = []
    const createdGroupIds: string[] = []

    try {
      const tokenListResponse = await apiRequest(request, 'GET', `/api/sso/scim/tokens?ssoConfigId=${configId}`, { token: authToken })
      expect(tokenListResponse.ok()).toBeTruthy()
      const tokenList = await tokenListResponse.json() as { items: Array<{ id: string; createdBy: string | null }> }
      expect(tokenList.items.find((item) => item.id === tokenId)?.createdBy).toMatch(/^[0-9a-f-]{36}$/i)

      const userResponse = await scimRequest(request, 'POST', '/api/sso/scim/v2/Users', rawToken, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: `group-user-${stamp}@test.example.com`,
        displayName: `Group User ${stamp}`,
        active: true,
        externalId: `group-user-${stamp}`,
      })
      expect(userResponse.status()).toBe(201)
      const user = await userResponse.json() as { id: string }
      createdUserIds.push(user.id)

      const groupResponse = await scimRequest(request, 'POST', '/api/sso/scim/v2/Groups', rawToken, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
        externalId: `entra-group-${stamp}`,
        displayName: `Finance ${stamp}`,
        members: [{ value: user.id, $ref: null }],
      })
      expect(groupResponse.status()).toBe(201)
      const group = await groupResponse.json() as { id: string; members: Array<{ value: string }> }
      createdGroupIds.push(group.id)
      expect(group.members).toEqual([expect.objectContaining({ value: user.id })])

      const filteredResponse = await scimRequest(
        request,
        'GET',
        `/api/sso/scim/v2/Groups?filter=${encodeURIComponent(`displayName eq "Finance ${stamp}"`)}`,
        rawToken,
      )
      expect(filteredResponse.ok()).toBeTruthy()
      const filtered = await filteredResponse.json() as { totalResults: number; Resources: Array<{ id: string }> }
      expect(filtered.totalResults).toBe(1)
      expect(filtered.Resources[0]?.id).toBe(group.id)

      const removeResponse = await scimRequest(request, 'PATCH', `/api/sso/scim/v2/Groups/${group.id}`, rawToken, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'Remove', path: `members[value eq "${user.id}"]` }],
      })
      expect(removeResponse.ok()).toBeTruthy()
      expect((await removeResponse.json() as { members: unknown[] }).members).toHaveLength(0)

      const addResponse = await scimRequest(request, 'PATCH', `/api/sso/scim/v2/Groups/${group.id}`, rawToken, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'Add', path: 'members', value: [{ value: user.id }] }],
      })
      expect(addResponse.ok()).toBeTruthy()
      expect((await addResponse.json() as { members: Array<{ value: string }> }).members[0]?.value).toBe(user.id)

      const bulkResponse = await scimRequest(request, 'POST', '/api/sso/scim/v2/Bulk', rawToken, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:BulkRequest'],
        failOnErrors: 1,
        Operations: [
          {
            method: 'POST',
            path: '/Users',
            bulkId: 'bulk-user',
            data: {
              schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
              userName: `bulk-user-${stamp}@test.example.com`,
              displayName: `Bulk User ${stamp}`,
              active: true,
              externalId: `bulk-user-${stamp}`,
            },
          },
          {
            method: 'POST',
            path: '/Groups',
            bulkId: 'bulk-group',
            data: {
              schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
              externalId: `bulk-group-${stamp}`,
              displayName: `Bulk Group ${stamp}`,
              members: [{ value: 'bulkId:bulk-user' }],
            },
          },
        ],
      })
      expect(bulkResponse.ok()).toBeTruthy()
      const bulk = await bulkResponse.json() as {
        Operations: Array<{ bulkId?: string; status: string; location?: string }>
      }
      expect(bulk.Operations.map((operation) => operation.status)).toEqual(['201', '201'])
      const bulkUserId = bulk.Operations.find((operation) => operation.bulkId === 'bulk-user')?.location?.split('/').pop()
      const bulkGroupId = bulk.Operations.find((operation) => operation.bulkId === 'bulk-group')?.location?.split('/').pop()
      expect(bulkUserId).toMatch(/^[0-9a-f-]{36}$/i)
      expect(bulkGroupId).toMatch(/^[0-9a-f-]{36}$/i)
      createdUserIds.push(bulkUserId!)
      createdGroupIds.push(bulkGroupId!)

      const serviceConfigResponse = await scimRequest(request, 'GET', '/api/sso/scim/v2/ServiceProviderConfig', rawToken)
      expect(serviceConfigResponse.ok()).toBeTruthy()
      expect((await serviceConfigResponse.json() as { bulk: { supported: boolean } }).bulk.supported).toBe(true)

      const schemasResponse = await scimRequest(request, 'GET', '/api/sso/scim/v2/Schemas', rawToken)
      expect(schemasResponse.ok()).toBeTruthy()
      expect((await schemasResponse.json() as { totalResults: number }).totalResults).toBe(2)
    } finally {
      for (const groupId of createdGroupIds.reverse()) {
        await scimRequest(request, 'DELETE', `/api/sso/scim/v2/Groups/${groupId}`, rawToken).catch(() => {})
      }
      for (const userId of createdUserIds.reverse()) {
        await scimRequest(request, 'DELETE', `/api/sso/scim/v2/Users/${userId}`, rawToken).catch(() => {})
      }
      await cleanupToken()
      await apiRequest(request, 'POST', `/api/sso/config/${configId}/activate`, {
        token: authToken,
        data: { active: false },
      }).catch(() => {})
      await cleanupConfig()
    }
  })
})
