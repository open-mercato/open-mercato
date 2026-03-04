import { expect, test, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

type JsonRecord = Record<string, unknown>

async function readJson(response: APIResponse): Promise<JsonRecord> {
  return (await response.json().catch(() => ({}))) as JsonRecord
}

const INTEGRATION_ID = 'sync_medusa_products'
const BUNDLE_ID = 'sync_medusa'

test.describe('TC-INT-002: Integrations foundation APIs', () => {
  test('list/detail/state/credentials endpoints work for bundle-backed integrations', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const listResponse = await apiRequest(request, 'GET', '/api/integrations', { token })
    expect(listResponse.status()).toBe(200)
    const listBody = await readJson(listResponse)
    const items = Array.isArray(listBody.items) ? (listBody.items as JsonRecord[]) : []
    const integrationIds = items.map((item) => String(item.id))
    expect(integrationIds).toContain(INTEGRATION_ID)
    expect(integrationIds).toContain('sync_medusa_orders')

    const detailResponse = await apiRequest(request, 'GET', `/api/integrations/${INTEGRATION_ID}`, { token })
    expect(detailResponse.status()).toBe(200)
    const detailBody = await readJson(detailResponse)
    expect((detailBody.integration as JsonRecord).id).toBe(INTEGRATION_ID)
    expect((detailBody.bundle as JsonRecord).id).toBe(BUNDLE_ID)
    const bundleIntegrations = Array.isArray(detailBody.bundleIntegrations)
      ? (detailBody.bundleIntegrations as JsonRecord[])
      : []
    expect(bundleIntegrations.map((entry) => String(entry.id))).toContain('sync_medusa_orders')

    const initialCredentialsResponse = await apiRequest(
      request,
      'GET',
      `/api/integrations/${INTEGRATION_ID}/credentials`,
      { token },
    )
    expect(initialCredentialsResponse.status()).toBe(200)
    const initialCredentialsBody = await readJson(initialCredentialsResponse)
    const previousCredentials =
      initialCredentialsBody.credentials && typeof initialCredentialsBody.credentials === 'object'
        ? (initialCredentialsBody.credentials as JsonRecord)
        : {}

    const baselineState = detailBody.state && typeof detailBody.state === 'object'
      ? (detailBody.state as JsonRecord)
      : {}

    try {
      const updateCredentialsResponse = await apiRequest(
        request,
        'PUT',
        `/api/integrations/${INTEGRATION_ID}/credentials`,
        {
          token,
          data: {
            credentials: {
              medusaApiUrl: 'https://example.medusa.local',
              medusaApiKey: 'integration-test-api-key',
            },
          },
        },
      )
      expect(updateCredentialsResponse.status()).toBe(200)

      const verifyCredentialsResponse = await apiRequest(
        request,
        'GET',
        `/api/integrations/${INTEGRATION_ID}/credentials`,
        { token },
      )
      expect(verifyCredentialsResponse.status()).toBe(200)
      const verifyCredentialsBody = await readJson(verifyCredentialsResponse)
      const credentials = verifyCredentialsBody.credentials as JsonRecord
      expect(credentials.medusaApiUrl).toBe('https://example.medusa.local')
      expect(credentials.medusaApiKey).toBe('integration-test-api-key')

      const disableResponse = await apiRequest(
        request,
        'PUT',
        `/api/integrations/${INTEGRATION_ID}/state`,
        {
          token,
          data: { isEnabled: false, reauthRequired: true },
        },
      )
      expect(disableResponse.status()).toBe(200)
      const disableBody = await readJson(disableResponse)
      expect(disableBody.isEnabled).toBe(false)
      expect(disableBody.reauthRequired).toBe(true)

      const enableResponse = await apiRequest(
        request,
        'PUT',
        `/api/integrations/${INTEGRATION_ID}/state`,
        {
          token,
          data: { isEnabled: true, reauthRequired: false },
        },
      )
      expect(enableResponse.status()).toBe(200)

      const versionResponse = await apiRequest(
        request,
        'PUT',
        `/api/integrations/${INTEGRATION_ID}/version`,
        {
          token,
          data: { apiVersion: 'non-existent-version' },
        },
      )
      expect(versionResponse.status()).toBe(422)
    } finally {
      await apiRequest(request, 'PUT', `/api/integrations/${INTEGRATION_ID}/credentials`, {
        token,
        data: { credentials: previousCredentials },
      })

      await apiRequest(request, 'PUT', `/api/integrations/${INTEGRATION_ID}/state`, {
        token,
        data: {
          isEnabled:
            typeof baselineState.isEnabled === 'boolean'
              ? baselineState.isEnabled
              : true,
          reauthRequired:
            typeof baselineState.reauthRequired === 'boolean'
              ? baselineState.reauthRequired
              : false,
        },
      })
    }
  })
})
