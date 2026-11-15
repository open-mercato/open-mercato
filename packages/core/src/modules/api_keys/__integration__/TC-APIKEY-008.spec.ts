import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
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
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

type KeyBody = { id?: string; secret?: string; organizationId?: string | null; fieldErrors?: { organizationId?: string } }

test.describe('TC-APIKEY-008: Reject unusable organization-scoped API keys', () => {
  test('rejects another organization before creation and preserves usable scopes', async ({ request }) => {
    const operatorToken = await getAuthToken(request, 'superadmin')
    const { tenantId } = getTokenContext(operatorToken)
    const stamp = randomUUID()
    const password = `Qa!${randomUUID()}1`
    const email = `qa-apikey-008-${stamp}@example.com`
    const keyIds = new Set<string>()
    let homeOrgId: string | null = null
    let otherOrgId: string | null = null
    let roleId: string | null = null
    let userId: string | null = null

    try {
      homeOrgId = await createOrganizationFixture(request, operatorToken, {
        name: `QA APIKEY-008 Home ${stamp}`, tenantId,
      })
      otherOrgId = await createOrganizationFixture(request, operatorToken, {
        name: `QA APIKEY-008 Other ${stamp}`, tenantId,
      })
      roleId = await createRoleFixture(request, operatorToken, { name: `qa-apikey-008-${stamp}`, tenantId })
      await setRoleAclFeatures(request, operatorToken, {
        roleId,
        features: ['api_keys.create', 'api_keys.view', 'api_keys.delete'],
        organizations: null,
      })
      userId = await createUserFixture(request, operatorToken, {
        email, password, organizationId: homeOrgId, roles: [roleId],
      })
      const token = await getAuthToken(request, email, password)

      for (const selection of ['inherited', 'explicit']) {
        const name = `QA APIKEY-008 rejected ${selection} ${stamp}`
        const response = await apiRequestWithSelectedOrg(request, 'POST', '/api/api_keys/keys', {
          token,
          selectedOrgId: otherOrgId,
          data: { name, roles: [roleId], ...(selection === 'explicit' ? { organizationId: otherOrgId } : {}) },
        })
        const body = await readJsonSafe<KeyBody>(response)
        if (body?.id) keyIds.add(body.id)
        expect(response.status(), `${selection} other-organization scope must be rejected`).toBe(400)
        expect(body?.fieldErrors?.organizationId).toBeTruthy()
        expect(body?.id).toBeUndefined()
        expect(body?.secret).toBeUndefined()

        const list = await apiRequestWithSelectedOrg(request, 'GET', `/api/api_keys/keys?search=${encodeURIComponent(name)}`, {
          token, selectedOrgId: otherOrgId,
        })
        expect(list.status()).toBe(200)
        expect((await readJsonSafe<{ items?: unknown[] }>(list))?.items).toEqual([])
      }

      for (const organizationId of [homeOrgId, homeOrgId.toUpperCase(), null]) {
        const response = await apiRequest(request, 'POST', '/api/api_keys/keys', {
          token,
          data: { name: `QA APIKEY-008 usable ${organizationId ?? 'tenant'} ${stamp}`, organizationId, roles: [roleId] },
        })
        const body = await readJsonSafe<KeyBody>(response)
        if (body?.id) keyIds.add(body.id)
        expect(response.status(), 'Own organization and tenant-wide keys should remain available').toBe(201)
        expect(body?.organizationId?.toLowerCase() ?? null).toBe(organizationId?.toLowerCase() ?? null)
        const secret = expectId(body?.secret, 'Creation must return a usable secret')
        await withCredentialIsolatedRequest(async (keyRequest) => {
          const authenticated = await keyRequest.get('/api/api_keys/keys', { headers: { 'x-api-key': secret } })
          expect(authenticated.status(), 'The issued key should authenticate without a session').toBe(200)
        })
      }
    } finally {
      for (const id of keyIds) {
        await apiRequest(request, 'DELETE', `/api/api_keys/keys?id=${encodeURIComponent(id)}`, { token: operatorToken }).catch(() => undefined)
      }
      await deleteUserIfExists(request, operatorToken, userId)
      await deleteRoleIfExists(request, operatorToken, roleId)
      await deleteOrganizationIfExists(request, operatorToken, otherOrgId)
      await deleteOrganizationIfExists(request, operatorToken, homeOrgId)
    }
  })
})
