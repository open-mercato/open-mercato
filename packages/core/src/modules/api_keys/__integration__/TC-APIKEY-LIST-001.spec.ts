import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

type KeyListBody = { items?: Array<{ id?: string }> }

async function createKey(
  request: APIRequestContext,
  token: string,
  input: { name: string; tenantId: string; organizationId: string | null },
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/api_keys/keys', { token, data: input })
  const body = await readJsonSafe<{ id?: string }>(response)
  expect(response.status(), `POST /api/api_keys/keys should create ${input.name}`).toBe(201)
  return expectId(body?.id, 'API-key creation response should include id')
}

async function listKeyIds(
  request: APIRequestContext,
  token: string,
  search: string,
  cookie?: string,
): Promise<string[]> {
  const response = await request.fetch(`/api/api_keys/keys?search=${encodeURIComponent(search)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(cookie ? { Cookie: cookie } : {}),
    },
  })
  expect(response.status(), 'GET /api/api_keys/keys should return 200').toBe(200)
  const body = await readJsonSafe<KeyListBody>(response)
  return (body?.items ?? []).map((item) => item.id).filter((id): id is string => typeof id === 'string')
}

/**
 * TC-APIKEY-LIST-001 [P1]: tenant-wide API keys are listed only for actors trusted with them
 *
 * A key saved with no organization is tenant-wide. With an organization selected, a
 * superadmin and an actor without an organization allowlist see it next to the selected
 * organization's keys (so it can be revoked from the list), while an organization-restricted
 * actor still sees only the keys of its allowed organizations.
 */
test.describe('TC-APIKEY-LIST-001: tenant-wide key visibility in the API-key list', () => {
  test('lists tenant-wide keys for unrestricted actors only', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const { tenantId } = getTokenContext(superadminToken)
    expectId(tenantId, 'Superadmin token should carry the actor tenant')

    const stamp = randomUUID()
    const search = `qa-tc-apikey-list-001-${stamp}`
    const password = 'StrongSecret123!'
    const keyIds: string[] = []
    let organizationId: string | null = null
    let unrestrictedRoleId: string | null = null
    let restrictedRoleId: string | null = null
    let unrestrictedUserId: string | null = null
    let restrictedUserId: string | null = null

    try {
      organizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-APIKEY-LIST-001 ${stamp}`,
        tenantId,
      })
      const tenantWideKeyId = await createKey(request, superadminToken, {
        name: `${search} tenant-wide`,
        tenantId,
        organizationId: null,
      })
      keyIds.push(tenantWideKeyId)
      const organizationKeyId = await createKey(request, superadminToken, {
        name: `${search} organization`,
        tenantId,
        organizationId,
      })
      keyIds.push(organizationKeyId)

      const selectedOrganizationCookie = `om_selected_org=${encodeURIComponent(organizationId)}`
      const superadminIds = await listKeyIds(request, superadminToken, search, selectedOrganizationCookie)
      expect(superadminIds.sort(), 'Superadmin should see the tenant-wide key next to the selected organization key')
        .toEqual([tenantWideKeyId, organizationKeyId].sort())

      unrestrictedRoleId = await createRoleFixture(request, superadminToken, {
        name: `qa-tc-apikey-list-001-unrestricted-${stamp}`,
        tenantId,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId: unrestrictedRoleId,
        features: ['api_keys.view'],
        organizations: null,
      })
      const unrestrictedEmail = `qa-tc-apikey-list-001-unrestricted-${stamp}@example.com`
      unrestrictedUserId = await createUserFixture(request, superadminToken, {
        email: unrestrictedEmail,
        password,
        organizationId,
        roles: [unrestrictedRoleId],
        name: 'QA TC-APIKEY-LIST-001 Unrestricted',
      })
      const unrestrictedToken = await getAuthToken(request, unrestrictedEmail, password)
      const unrestrictedIds = await listKeyIds(request, unrestrictedToken, search, selectedOrganizationCookie)
      expect(unrestrictedIds.sort(), 'An actor without an organization allowlist should see the tenant-wide key')
        .toEqual([tenantWideKeyId, organizationKeyId].sort())

      restrictedRoleId = await createRoleFixture(request, superadminToken, {
        name: `qa-tc-apikey-list-001-restricted-${stamp}`,
        tenantId,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId: restrictedRoleId,
        features: ['api_keys.view'],
        organizations: [organizationId],
      })
      const restrictedEmail = `qa-tc-apikey-list-001-restricted-${stamp}@example.com`
      restrictedUserId = await createUserFixture(request, superadminToken, {
        email: restrictedEmail,
        password,
        organizationId,
        roles: [restrictedRoleId],
        name: 'QA TC-APIKEY-LIST-001 Restricted',
      })
      const restrictedToken = await getAuthToken(request, restrictedEmail, password)
      const restrictedIds = await listKeyIds(request, restrictedToken, search, selectedOrganizationCookie)
      expect(restrictedIds, 'An organization-restricted actor must not see the tenant-wide key')
        .toEqual([organizationKeyId])
    } finally {
      for (const keyId of keyIds) {
        await apiRequest(request, 'DELETE', `/api/api_keys/keys?id=${encodeURIComponent(keyId)}`, {
          token: superadminToken,
        }).catch(() => undefined)
      }
      await deleteUserIfExists(request, superadminToken, restrictedUserId)
      await deleteUserIfExists(request, superadminToken, unrestrictedUserId)
      await deleteRoleIfExists(request, superadminToken, restrictedRoleId)
      await deleteRoleIfExists(request, superadminToken, unrestrictedRoleId)
      await deleteOrganizationIfExists(request, superadminToken, organizationId)
    }
  })
})
