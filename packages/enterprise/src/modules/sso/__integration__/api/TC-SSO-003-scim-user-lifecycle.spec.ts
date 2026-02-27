import { expect, test } from '@playwright/test'
import {
  createSsoConfigFixture,
  createScimTokenFixture,
  getAuthToken,
  scimRequest,
} from '../helpers/ssoFixtures'

test.describe('TC-SSO-003: SCIM User Lifecycle', () => {
  test('should create, read, list, patch, and delete a SCIM user', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const { configId, cleanup: cleanupConfig } = await createSsoConfigFixture(request, token, {
      jitEnabled: false,
    })

    const { rawToken, cleanup: cleanupToken } = await createScimTokenFixture(request, token, configId)
    let scimUserId: string | null = null

    try {
      // Create user
      const createResponse = await scimRequest(request, 'POST', '/api/sso/scim/v2/Users', rawToken, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: `scim-user-${stamp}@test.example.com`,
        displayName: `SCIM User ${stamp}`,
        name: { givenName: 'SCIM', familyName: 'User' },
        emails: [{ value: `scim-user-${stamp}@test.example.com`, type: 'work', primary: true }],
        active: true,
        externalId: `ext-${stamp}`,
      })
      expect(createResponse.status()).toBe(201)
      const created = (await createResponse.json()) as { id: string; userName: string }
      scimUserId = created.id
      expect(scimUserId).toBeTruthy()
      expect(created.userName).toContain(`scim-user-${stamp}`)

      // Read user
      const getResponse = await scimRequest(request, 'GET', `/api/sso/scim/v2/Users/${scimUserId}`, rawToken)
      expect(getResponse.ok()).toBeTruthy()
      const user = (await getResponse.json()) as { id: string; displayName: string }
      expect(user.id).toBe(scimUserId)

      // List users with filter
      const listResponse = await scimRequest(
        request,
        'GET',
        `/api/sso/scim/v2/Users?filter=userName eq "scim-user-${stamp}@test.example.com"`,
        rawToken,
      )
      expect(listResponse.ok()).toBeTruthy()
      const list = (await listResponse.json()) as { totalResults: number; Resources: Array<{ id: string }> }
      expect(list.totalResults).toBeGreaterThanOrEqual(1)
      expect(list.Resources.some((r) => r.id === scimUserId)).toBeTruthy()

      // Patch: update displayName
      const patchResponse = await scimRequest(request, 'PATCH', `/api/sso/scim/v2/Users/${scimUserId}`, rawToken, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', path: 'displayName', value: 'Updated Name' }],
      })
      expect(patchResponse.ok()).toBeTruthy()

      // Patch: deactivate
      const deactivateResponse = await scimRequest(request, 'PATCH', `/api/sso/scim/v2/Users/${scimUserId}`, rawToken, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', path: 'active', value: false }],
      })
      expect(deactivateResponse.ok()).toBeTruthy()

      // Patch: reactivate
      const reactivateResponse = await scimRequest(request, 'PATCH', `/api/sso/scim/v2/Users/${scimUserId}`, rawToken, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', path: 'active', value: true }],
      })
      expect(reactivateResponse.ok()).toBeTruthy()

      // Delete
      const deleteResponse = await scimRequest(request, 'DELETE', `/api/sso/scim/v2/Users/${scimUserId}`, rawToken)
      expect(deleteResponse.status()).toBe(204)
      scimUserId = null
    } finally {
      if (scimUserId) {
        await scimRequest(request, 'DELETE', `/api/sso/scim/v2/Users/${scimUserId}`, rawToken).catch(() => {})
      }
      await cleanupToken()
      await cleanupConfig()
    }
  })
})
