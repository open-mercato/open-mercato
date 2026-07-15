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
import {
  deleteGeneralEntityIfExists,
  expectId,
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'

type ErrorBody = { error?: string }
type KeyListBody = { items?: Array<{ id?: string }> }

async function createTenantFixture(
  request: APIRequestContext,
  token: string,
  name: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/directory/tenants', {
    token,
    data: { name },
  })
  const body = await readJsonSafe<{ id?: string }>(response)
  expect(response.status(), 'POST /api/directory/tenants should return 201').toBe(201)
  return expectId(body?.id, 'Tenant creation response should include id')
}

async function createScopedApiKey(
  request: APIRequestContext,
  token: string,
  input: { name: string; tenantId: string; organizationId: string },
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/api_keys/keys', {
    token,
    data: input,
  })
  const body = await readJsonSafe<{ id?: string }>(response)
  expect(response.status(), `POST /api/api_keys/keys should create ${input.name}`).toBe(201)
  return expectId(body?.id, 'API-key creation response should include id')
}

async function deleteWithCookie(
  request: APIRequestContext,
  token: string,
  id: string,
  cookie: string,
) {
  return request.fetch(`/api/api_keys/keys?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
  })
}

/**
 * TC-APIKEY-007 [P0]: API-key deletion is fail-closed and non-enumerating (#4033)
 *
 * A non-superadmin with an empty organization allowlist must not delete a known
 * organization-bound key. Allowed-scope deletion still succeeds, while foreign
 * organization, foreign tenant, and unknown ids remain indistinguishable and do
 * not mutate the target. Superadmin access remains scoped to its effective
 * tenant, including the existing explicit selected-tenant override.
 */
test.describe('TC-APIKEY-007: DELETE organization-scope enforcement (#4033)', () => {
  test('denies empty and foreign scopes without mutating keys', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const { tenantId: actorTenantId } = getTokenContext(superadminToken)
    expectId(actorTenantId, 'Superadmin token should carry the actor tenant')

    const stamp = randomUUID()
    const password = 'StrongSecret123!'
    const actorEmail = `qa-tc-apikey-007-${stamp}@example.com`
    const pendingKeyIds = new Set<string>()
    let allowedOrganizationId: string | null = null
    let foreignOrganizationId: string | null = null
    let actorHomeOrganizationId: string | null = null
    let foreignTenantId: string | null = null
    let foreignTenantOrganizationId: string | null = null
    let foreignTenantRoleId: string | null = null
    let foreignTenantUserId: string | null = null
    let foreignTenantToken: string | null = null
    let crossTenantKeyId: string | null = null
    let roleId: string | null = null
    let actorUserId: string | null = null

    const createKey = async (name: string, tenantId: string, organizationId: string): Promise<string> => {
      const id = await createScopedApiKey(request, superadminToken, { name, tenantId, organizationId })
      pendingKeyIds.add(id)
      return id
    }
    const deleteAsSuperadmin = async (id: string) => {
      const response = await apiRequest(
        request,
        'DELETE',
        `/api/api_keys/keys?id=${encodeURIComponent(id)}`,
        { token: superadminToken },
      )
      if (response.status() === 200) pendingKeyIds.delete(id)
      return response
    }

    try {
      allowedOrganizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-APIKEY-007 Allowed ${stamp}`,
        tenantId: actorTenantId,
      })
      foreignOrganizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-APIKEY-007 Foreign ${stamp}`,
        tenantId: actorTenantId,
      })
      actorHomeOrganizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-APIKEY-007 Temporary home ${stamp}`,
        tenantId: actorTenantId,
      })

      roleId = await createRoleFixture(request, superadminToken, {
        name: `qa-tc-apikey-007-${stamp}`,
        tenantId: actorTenantId,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId,
        features: ['api_keys.view', 'api_keys.delete'],
        organizations: [],
      })
      actorUserId = await createUserFixture(request, superadminToken, {
        email: actorEmail,
        password,
        organizationId: actorHomeOrganizationId,
        roles: [roleId],
        name: 'QA TC-APIKEY-007 Actor',
      })

      // Public-API-only construction of a genuine deny-all OrganizationScope:
      // the role stores organizations=[], and deleting the temporary home org
      // removes the resolver's account-org fallback before the JWT is minted.
      const removeHome = await apiRequest(
        request,
        'DELETE',
        `/api/directory/organizations?id=${encodeURIComponent(actorHomeOrganizationId)}`,
        { token: superadminToken },
      )
      expect(removeHome.status(), 'Temporary home organization should be soft-deleted').toBe(200)

      const actorToken = await getAuthToken(request, actorEmail, password)
      const denyAllKeyName = `QA TC-APIKEY-007 deny-all ${stamp}`
      const denyAllKeyId = await createKey(denyAllKeyName, actorTenantId, allowedOrganizationId)

      const emptyScopeProbe = await apiRequest(
        request,
        'GET',
        `/api/api_keys/keys?search=${encodeURIComponent(denyAllKeyName)}`,
        { token: actorToken },
      )
      const emptyScopeList = await readJsonSafe<KeyListBody>(emptyScopeProbe)
      expect(emptyScopeProbe.status(), 'Deny-all actor should pass the API-key view feature guard').toBe(200)
      expect(emptyScopeList?.items ?? [], 'organizations=[] should resolve to an empty visible key set').toEqual([])

      const unknownResponse = await apiRequest(
        request,
        'DELETE',
        `/api/api_keys/keys?id=${encodeURIComponent(randomUUID())}`,
        { token: actorToken },
      )
      const unknownBody = await readJsonSafe<ErrorBody>(unknownResponse)
      expect(unknownResponse.status(), 'Unknown id establishes the non-enumerating response').toBe(404)

      const denyAllResponse = await apiRequest(
        request,
        'DELETE',
        `/api/api_keys/keys?id=${encodeURIComponent(denyAllKeyId)}`,
        { token: actorToken },
      )
      const denyAllBody = await readJsonSafe<ErrorBody>(denyAllResponse)
      const denyAllSurvival = await deleteAsSuperadmin(denyAllKeyId)

      expect(
        denyAllResponse.status(),
        'organizations=[] must deny a known organization-bound key like an unknown id',
      ).toBe(unknownResponse.status())
      expect(denyAllBody, 'Deny-all response must not disclose whether the key exists').toEqual(unknownBody)
      expect(denyAllSurvival.status(), 'Rejected deny-all deletion must leave the key for superadmin cleanup').toBe(200)

      // Widen the same non-superadmin to exactly one organization. This proves
      // the legitimate path still works and a same-tenant foreign org does not.
      await setRoleAclFeatures(request, superadminToken, {
        roleId,
        features: ['api_keys.view', 'api_keys.delete'],
        organizations: [allowedOrganizationId],
      })
      const allowedKeyId = await createKey(
        `QA TC-APIKEY-007 allowed ${stamp}`,
        actorTenantId,
        allowedOrganizationId,
      )
      const foreignKeyId = await createKey(
        `QA TC-APIKEY-007 foreign ${stamp}`,
        actorTenantId,
        foreignOrganizationId,
      )

      const allowedResponse = await apiRequest(
        request,
        'DELETE',
        `/api/api_keys/keys?id=${encodeURIComponent(allowedKeyId)}`,
        { token: actorToken },
      )
      expect(allowedResponse.status(), 'Allowed organization deletion should succeed').toBe(200)
      pendingKeyIds.delete(allowedKeyId)

      const foreignResponse = await apiRequest(
        request,
        'DELETE',
        `/api/api_keys/keys?id=${encodeURIComponent(foreignKeyId)}`,
        { token: actorToken },
      )
      const foreignBody = await readJsonSafe<ErrorBody>(foreignResponse)
      expect(foreignResponse.status(), 'Foreign organization id must be non-enumerating').toBe(unknownResponse.status())
      expect(foreignBody, 'Foreign organization response must match an unknown id').toEqual(unknownBody)
      const foreignSurvival = await deleteAsSuperadmin(foreignKeyId)
      expect(foreignSurvival.status(), 'Rejected foreign-org deletion must not mutate the key').toBe(200)

      // Cross-tenant ids are equally non-enumerating without an explicit scope
      // override. The selected-tenant cookie then proves the key survived those
      // rejections and preserves the existing superadmin operator workflow.
      foreignTenantId = await createTenantFixture(request, superadminToken, `QA TC-APIKEY-007 Tenant B ${stamp}`)
      foreignTenantOrganizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-APIKEY-007 Tenant B org ${stamp}`,
        tenantId: foreignTenantId,
      })
      foreignTenantRoleId = await createRoleFixture(request, superadminToken, {
        name: `qa-tc-apikey-007-tenant-b-${stamp}`,
        tenantId: foreignTenantId,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId: foreignTenantRoleId,
        features: ['api_keys.create', 'api_keys.delete'],
        organizations: [foreignTenantOrganizationId],
      })
      const foreignTenantEmail = `qa-tc-apikey-007-tenant-b-${stamp}@example.com`
      foreignTenantUserId = await createUserFixture(request, superadminToken, {
        email: foreignTenantEmail,
        password,
        organizationId: foreignTenantOrganizationId,
        roles: [foreignTenantRoleId],
        name: 'QA TC-APIKEY-007 Tenant B Actor',
      })
      foreignTenantToken = await getAuthToken(request, foreignTenantEmail, password)

      crossTenantKeyId = await createScopedApiKey(request, foreignTenantToken, {
        name: `QA TC-APIKEY-007 cross-tenant ${stamp}`,
        tenantId: foreignTenantId,
        organizationId: foreignTenantOrganizationId,
      })
      pendingKeyIds.add(crossTenantKeyId)
      const crossTenantResponse = await apiRequest(
        request,
        'DELETE',
        `/api/api_keys/keys?id=${encodeURIComponent(crossTenantKeyId)}`,
        { token: actorToken },
      )
      const crossTenantBody = await readJsonSafe<ErrorBody>(crossTenantResponse)
      expect(crossTenantResponse.status(), 'Foreign tenant id must be non-enumerating').toBe(unknownResponse.status())
      expect(crossTenantBody, 'Foreign tenant response must match an unknown id').toEqual(unknownBody)

      const crossTenantSuperadminResponse = await apiRequest(
        request,
        'DELETE',
        `/api/api_keys/keys?id=${encodeURIComponent(crossTenantKeyId)}`,
        { token: superadminToken },
      )
      const crossTenantSuperadminBody = await readJsonSafe<ErrorBody>(crossTenantSuperadminResponse)
      expect(
        crossTenantSuperadminResponse.status(),
        'Superadmin bearer token must remain scoped to its authenticated tenant',
      ).toBe(unknownResponse.status())
      expect(crossTenantSuperadminBody, 'Cross-tenant superadmin response must match an unknown id').toEqual(unknownBody)

      const selectedTenantCookie = [
        `om_selected_tenant=${encodeURIComponent(foreignTenantId)}`,
        `om_selected_org=${encodeURIComponent(foreignTenantOrganizationId)}`,
      ].join('; ')
      const selectedTenantSuperadminResponse = await deleteWithCookie(
        request,
        superadminToken,
        crossTenantKeyId,
        selectedTenantCookie,
      )
      const selectedTenantSuperadminBody = await readJsonSafe<{ success?: boolean }>(selectedTenantSuperadminResponse)
      expect(
        selectedTenantSuperadminResponse.status(),
        'Selected-tenant superadmin deletion should preserve the existing platform-operator override',
      ).toBe(200)
      expect(
        selectedTenantSuperadminBody,
        'Selected-tenant superadmin deletion should return the normal success payload',
      ).toEqual({ success: true })
      pendingKeyIds.delete(crossTenantKeyId)
    } finally {
      if (crossTenantKeyId && foreignTenantToken && pendingKeyIds.has(crossTenantKeyId)) {
        const cleanup = await apiRequest(
          request,
          'DELETE',
          `/api/api_keys/keys?id=${encodeURIComponent(crossTenantKeyId)}`,
          { token: foreignTenantToken },
        ).catch(() => null)
        if (cleanup && [200, 404].includes(cleanup.status())) pendingKeyIds.delete(crossTenantKeyId)
      }
      for (const keyId of pendingKeyIds) {
        await deleteAsSuperadmin(keyId).catch(() => undefined)
      }
      await deleteUserIfExists(request, superadminToken, foreignTenantUserId)
      await deleteRoleIfExists(request, superadminToken, foreignTenantRoleId)
      await deleteUserIfExists(request, superadminToken, actorUserId)
      await deleteRoleIfExists(request, superadminToken, roleId)
      await deleteOrganizationIfExists(request, superadminToken, actorHomeOrganizationId)
      await deleteOrganizationIfExists(request, superadminToken, allowedOrganizationId)
      await deleteOrganizationIfExists(request, superadminToken, foreignOrganizationId)
      await deleteOrganizationIfExists(request, superadminToken, foreignTenantOrganizationId)
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/tenants', foreignTenantId)
    }
  })
})
