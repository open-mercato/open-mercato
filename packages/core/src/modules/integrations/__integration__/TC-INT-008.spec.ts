import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setUserAclVisibility,
} from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures'
import {
  createOrganizationInDb,
  deleteIntegrationCredentialsInDb,
  deleteOrganizationInDb,
  deleteUserAclInDb,
} from '@open-mercato/core/modules/core/__integration__/helpers/dbFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'

type JsonRecord = Record<string, unknown>

async function readJson(response: APIResponse): Promise<JsonRecord> {
  return ((await readJsonSafe<JsonRecord>(response)) ?? {}) as JsonRecord
}

async function pickIntegrationId(request: APIRequestContext, token: string): Promise<string | null> {
  const listResponse = await apiRequest(request, 'GET', '/api/integrations', { token })
  if (listResponse.status() !== 200) return null
  const body = await readJson(listResponse)
  const items = Array.isArray(body.items) ? (body.items as JsonRecord[]) : []
  return items.length > 0 ? String(items[0].id) : null
}

async function readCredentials(
  request: APIRequestContext,
  token: string,
  integrationId: string,
): Promise<{ status: number; credentials: JsonRecord }> {
  const response = await apiRequest(request, 'GET', `/api/integrations/${integrationId}/credentials`, { token })
  const body = await readJson(response)
  const credentials = body.credentials && typeof body.credentials === 'object' ? (body.credentials as JsonRecord) : {}
  return { status: response.status(), credentials }
}

/**
 * TC-INT-008: Integration credentials organization isolation [P0]
 *
 * Surfaces: PUT/GET /api/integrations/:id/credentials, GET /api/integrations/:id
 *
 * Integration credentials and state are scoped by (organizationId, tenantId).
 * This exercises that boundary: a second organization is created in the admin's
 * tenant (directly in the DB, because directory org-create denies non-super-admin
 * accounts) plus a user whose home org is that second org. Credentials saved by
 * the home-org admin MUST NOT be visible to the second-org user, and vice versa.
 *
 * Mirrors the multi-org choreography proven by TC-CRM-072. It requires a coherent
 * app+DB stack (the standard yarn test:integration / ephemeral harness) where the
 * DB fixtures and the app server share one database.
 */
test.describe('TC-INT-008: Integration credentials organization isolation', () => {
  test('credentials saved in one organization are not visible from another', async ({ request }) => {
    test.slow()

    const stamp = Date.now()
    const password = 'Secret123!'
    const userBEmail = `tc-int-008-${stamp}@example.com`

    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenScope(adminToken)
    expect(tenantId, 'admin token should carry a tenant id').toBeTruthy()

    const integrationId = await pickIntegrationId(request, adminToken)
    if (!integrationId) {
      test.skip(true, 'No integration provider modules registered — skipping org isolation')
      return
    }

    // Probe encryption and capture the admin home-org (orgA) credentials for restore.
    const adminInitial = await readCredentials(request, adminToken, integrationId)
    if (adminInitial.status === 503) {
      test.skip(true, 'Integration credentials encryption is unavailable in this environment')
      return
    }
    expect(adminInitial.status).toBe(200)
    const originalCredentials = adminInitial.credentials
    const credentialsPath = `/api/integrations/${integrationId}/credentials`

    let orgBId: string | null = null
    let roleBId: string | null = null
    let userBId: string | null = null
    let userBToken: string | null = null

    try {
      orgBId = await createOrganizationInDb({ name: `TC-INT-008 Org B ${stamp}`, tenantId: tenantId as string })
      roleBId = await createRoleFixture(request, adminToken, { name: `TC-INT-008 Role ${stamp}` })
      userBId = await createUserFixture(request, adminToken, {
        email: userBEmail,
        password,
        organizationId: orgBId,
        roles: [roleBId],
      })
      // Grant org-B integration features via the ACL API so the RBAC cache is invalidated.
      await setUserAclVisibility(request, adminToken, {
        userId: userBId,
        features: ['integrations.view', 'integrations.manage', 'integrations.credentials.manage'],
        organizations: [orgBId],
      })
      userBToken = await getAuthToken(request, userBEmail, password)

      const orgAMarker = `org-a-${stamp}`
      const orgBMarker = `org-b-${stamp}`

      // orgA (admin home org) saves a distinctive credential.
      const adminSave = await apiRequest(request, 'PUT', credentialsPath, {
        token: adminToken,
        data: { credentials: { tcInt008Marker: orgAMarker } },
      })
      expect(adminSave.status(), 'admin (org-A) should save credentials').toBe(200)

      // orgB must NOT see orgA's credential.
      const orgBView = await readCredentials(request, userBToken, integrationId)
      expect(orgBView.status, 'org-B user reads its own (empty) credentials').toBe(200)
      expect(orgBView.credentials.tcInt008Marker, 'org-B must not see org-A credentials').toBeUndefined()

      // orgB saves its own distinct credential.
      const orgBSave = await apiRequest(request, 'PUT', credentialsPath, {
        token: userBToken,
        data: { credentials: { tcInt008Marker: orgBMarker } },
      })
      expect(orgBSave.status(), 'org-B user should save its own credentials').toBe(200)

      // Each org reads back only its own value — proves bidirectional isolation.
      const adminAfter = await readCredentials(request, adminToken, integrationId)
      expect(adminAfter.credentials.tcInt008Marker, 'org-A still reads its own credential').toBe(orgAMarker)
      const orgBAfter = await readCredentials(request, userBToken, integrationId)
      expect(orgBAfter.credentials.tcInt008Marker, 'org-B reads its own credential').toBe(orgBMarker)

      // hasCredentials on the detail read is also resolved per-org.
      const orgBDetail = await readJson(
        await apiRequest(request, 'GET', `/api/integrations/${integrationId}`, { token: userBToken }),
      )
      expect(orgBDetail.hasCredentials, 'org-B detail reflects its own credential state').toBe(true)
    } finally {
      // Restore the admin (org-A) credentials and remove every record created for org-B.
      await apiRequest(request, 'PUT', credentialsPath, { token: adminToken, data: { credentials: originalCredentials } }).catch(
        () => undefined,
      )
      await deleteUserIfExists(request, adminToken, userBId)
      await deleteUserAclInDb(userBId ?? '').catch(() => undefined)
      await deleteRoleIfExists(request, adminToken, roleBId)
      await deleteIntegrationCredentialsInDb(orgBId).catch(() => undefined)
      await deleteOrganizationInDb(orgBId).catch(() => undefined)
    }
  })
})
