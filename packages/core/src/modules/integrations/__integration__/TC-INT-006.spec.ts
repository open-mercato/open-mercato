import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'

type JsonRecord = Record<string, unknown>

async function readJson(response: APIResponse): Promise<JsonRecord> {
  return ((await readJsonSafe<JsonRecord>(response)) ?? {}) as JsonRecord
}

type VersionedIntegration = {
  id: string
  versionIds: string[]
  currentVersion: string | null
  defaultVersion: string | null
}

/**
 * Finds the first registered integration that declares two or more apiVersions.
 * The list endpoint does not expose apiVersions, so each candidate is probed via
 * the detail endpoint (integration.apiVersions).
 */
async function findVersionedIntegration(
  request: APIRequestContext,
  token: string,
): Promise<VersionedIntegration | null> {
  const listBody = await readJson(await apiRequest(request, 'GET', '/api/integrations?pageSize=100', { token }))
  const items = Array.isArray(listBody.items) ? (listBody.items as JsonRecord[]) : []
  for (const item of items) {
    const integrationId = String(item.id)
    const detail = await readJson(await apiRequest(request, 'GET', `/api/integrations/${integrationId}`, { token }))
    const integration = (detail.integration ?? {}) as JsonRecord
    const apiVersions = Array.isArray(integration.apiVersions) ? (integration.apiVersions as JsonRecord[]) : []
    if (apiVersions.length < 2) continue
    const versionIds = apiVersions.map((version) => String(version.id))
    const defaultVersion = apiVersions.find((version) => version.default === true)
    const state = (detail.state ?? {}) as JsonRecord
    return {
      id: integrationId,
      versionIds,
      currentVersion: typeof state.apiVersion === 'string' ? state.apiVersion : null,
      defaultVersion: defaultVersion ? String(defaultVersion.id) : versionIds[0],
    }
  }
  return null
}

/**
 * TC-INT-006: Integration version persistence and invalid version rejection [P1]
 *
 * Surface: PUT /api/integrations/:id/version (requires integrations.manage)
 *
 * updateVersionSchema requires a non-empty apiVersion; the route additionally
 * rejects versions that are not declared on the integration. A valid switch is
 * persisted on the per-org state and echoed back with the previous version.
 */
test.describe('TC-INT-006: Integration version persistence', () => {
  test('rejects unknown and empty versions, persists a valid switch', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const integration = await findVersionedIntegration(request, token)
    if (!integration) {
      test.skip(true, 'No versioned integrations registered in this environment')
      return
    }
    const path = `/api/integrations/${integration.id}/version`

    // Unknown version id => 422 with the documented message.
    const unknown = await apiRequest(request, 'PUT', path, { token, data: { apiVersion: 'nonexistent-v9999' } })
    expect(unknown.status(), 'unknown version should be rejected').toBe(422)
    expect(JSON.stringify(await readJson(unknown))).toContain('Unknown integration version')

    // Empty version string fails the min(1) schema rule => 422.
    const empty = await apiRequest(request, 'PUT', path, { token, data: { apiVersion: '' } })
    expect(empty.status(), 'empty version string should be rejected').toBe(422)

    const targetVersion = integration.versionIds.find((id) => id !== integration.currentVersion) ?? integration.versionIds[0]
    try {
      const apply = await apiRequest(request, 'PUT', path, { token, data: { apiVersion: targetVersion } })
      expect(apply.status(), 'a declared version should be accepted').toBe(200)
      const applyBody = await readJson(apply)
      expect(applyBody.apiVersion).toBe(targetVersion)
      expect(typeof applyBody.previousVersion, 'response should report the previous version').toBe('string')

      const detail = await readJson(await apiRequest(request, 'GET', `/api/integrations/${integration.id}`, { token }))
      const state = (detail.state ?? {}) as JsonRecord
      expect(state.apiVersion, 'the new version should persist on the integration state').toBe(targetVersion)
    } finally {
      const restoreVersion = integration.currentVersion ?? integration.defaultVersion
      if (restoreVersion) {
        await apiRequest(request, 'PUT', path, { token, data: { apiVersion: restoreVersion } }).catch(() => undefined)
      }
    }
  })
})
