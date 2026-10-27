import { expect, test, type APIRequestContext } from '@playwright/test'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  deleteOrganizationIfExists,
  getAuthToken,
} from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures'
import { withClient } from '@open-mercato/core/modules/core/__integration__/helpers/dbFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'

const WRITERS_PER_INTEGRATION = 6
const MAX_INTEGRATIONS = 4

type StateRow = { is_enabled: boolean; reauth_required: boolean }

async function listIntegrationIds(request: APIRequestContext, token: string, organizationId: string): Promise<string[]> {
  const response = await apiRequestWithSelectedOrg(request, 'GET', '/api/integrations', {
    token,
    selectedOrgId: organizationId,
  })
  expect(response.status(), 'GET /api/integrations should return 200').toBe(200)
  const body = await readJsonSafe<{ items?: Array<{ id?: unknown }> }>(response)
  const items = Array.isArray(body?.items) ? body.items : []
  return items
    .map((item) => (typeof item.id === 'string' ? item.id : null))
    .filter((id): id is string => id !== null)
    .slice(0, MAX_INTEGRATIONS)
}

async function readActiveStateRows(integrationId: string, organizationId: string): Promise<StateRow[]> {
  return withClient(async (client) => {
    const result = await client.query<StateRow>(
      `select "is_enabled", "reauth_required" from "integration_states"
       where "integration_id" = $1 and "organization_id" = $2 and "deleted_at" is null`,
      [integrationId, organizationId],
    )
    return result.rows
  })
}

async function deleteStateRows(organizationId: string | null): Promise<void> {
  if (!organizationId) return
  await withClient(async (client) => {
    await client.query('delete from "integration_states" where "organization_id" = $1', [organizationId])
  })
}

/**
 * TC-INT-012: concurrent first writes to an integration state keep one row
 *
 * Surface: PUT /api/integrations/:id/state
 *
 * In a fresh organization no integration has a state row yet. Parallel state
 * writes for the same integration (enable toggle + reauth flag) must all land on
 * a single integration_states row instead of each inserting its own.
 */
test.describe('TC-INT-012: integration state concurrent first writes', () => {
  test('parallel first state writes for one integration share a single row', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const { tenantId } = getTokenContext(token)
    let organizationId: string | null = null

    try {
      organizationId = await createOrganizationFixture(request, token, {
        name: `QA TC-INT-012 ${Date.now()}`,
        tenantId,
      })
      const scopedOrganizationId = organizationId
      const integrationIds = await listIntegrationIds(request, token, scopedOrganizationId)
      test.skip(integrationIds.length === 0, 'No integration provider modules registered')

      for (const integrationId of integrationIds) {
        const responses = await Promise.all(
          Array.from({ length: WRITERS_PER_INTEGRATION }, (_unused, index) =>
            apiRequestWithSelectedOrg(request, 'PUT', `/api/integrations/${encodeURIComponent(integrationId)}/state`, {
              token,
              selectedOrgId: scopedOrganizationId,
              data: index % 2 === 0 ? { isEnabled: true } : { reauthRequired: true },
            }),
          ),
        )

        expect(
          responses.map((response) => response.status()),
          `every parallel state write for ${integrationId} should succeed`,
        ).toEqual(Array.from({ length: WRITERS_PER_INTEGRATION }, () => 200))

        const rows = await readActiveStateRows(integrationId, scopedOrganizationId)
        expect(rows, `exactly one active state row for ${integrationId}`).toHaveLength(1)
        expect(rows[0]).toEqual({ is_enabled: true, reauth_required: true })
      }
    } finally {
      await deleteStateRows(organizationId)
      await deleteOrganizationIfExists(request, token, organizationId)
    }
  })
})
