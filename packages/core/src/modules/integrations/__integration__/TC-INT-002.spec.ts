import { expect, request as playwrightRequest, test, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'

type JsonRecord = Record<string, unknown>
const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'

async function readJson(response: APIResponse): Promise<JsonRecord> {
  return ((await readJsonSafe<JsonRecord>(response)) ?? {}) as JsonRecord
}

/**
 * TC-INT-002: Integrations foundation APIs
 *
 * Tests the core integration marketplace API endpoints.
 * Dynamically detects available integrations — works with or without provider modules.
 */
test.describe('TC-INT-002: Integrations foundation APIs', () => {
  test('credentials endpoint enforces authorization', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const listResponse = await apiRequest(request, 'GET', '/api/integrations', { token: adminToken })
    expect(listResponse.status()).toBe(200)
    const listBody = await readJson(listResponse)
    const items = Array.isArray(listBody.items) ? (listBody.items as JsonRecord[]) : []
    if (items.length === 0) {
      test.skip(true, 'No integration provider modules registered — skipping authorization checks')
      return
    }
    const integrationId = String(items[0].id)

    const anonymousRequest = await playwrightRequest.newContext({ baseURL: BASE_URL })
    try {
      const noTokenResponse = await anonymousRequest.get(`/api/integrations/${integrationId}/credentials`)
      expect(noTokenResponse.status()).toBe(401)
    } finally {
      await anonymousRequest.dispose()
    }

    const employeeToken = await getAuthToken(request, 'employee')
    const forbiddenResponse = await apiRequest(
      request,
      'GET',
      `/api/integrations/${integrationId}/credentials`,
      { token: employeeToken },
    )
    expect(forbiddenResponse.status()).toBe(403)
  })

  test('list endpoint returns valid response structure', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const listResponse = await apiRequest(request, 'GET', '/api/integrations', { token })
    expect(listResponse.status()).toBe(200)
    const listBody = await readJson(listResponse)
    expect(listBody).toHaveProperty('items')
    expect(Array.isArray(listBody.items)).toBe(true)
    expect(listBody).toHaveProperty('bundles')
    expect(Array.isArray(listBody.bundles)).toBe(true)
  })

  test('detail/state/credentials endpoints work for available integrations', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const listResponse = await apiRequest(request, 'GET', '/api/integrations', { token })
    expect(listResponse.status()).toBe(200)
    const listBody = await readJson(listResponse)
    const items = Array.isArray(listBody.items) ? (listBody.items as JsonRecord[]) : []

    if (items.length === 0) {
      test.skip(true, 'No integration provider modules registered — skipping detail/state/credentials tests')
      return
    }

    const integrationId = String(items[0].id)
    const bundleId = items[0].bundleId ? String(items[0].bundleId) : null

    // Detail endpoint
    const detailResponse = await apiRequest(request, 'GET', `/api/integrations/${integrationId}`, { token })
    expect(detailResponse.status()).toBe(200)
    const detailBody = await readJson(detailResponse)
    expect((detailBody.integration as JsonRecord).id).toBe(integrationId)

    if (bundleId) {
      expect((detailBody.bundle as JsonRecord).id).toBe(bundleId)
    }

    // Credentials — read current state
    const initialCredentialsResponse = await apiRequest(
      request,
      'GET',
      `/api/integrations/${integrationId}/credentials`,
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
      // Save credentials
      const updateCredentialsResponse = await apiRequest(
        request,
        'PUT',
        `/api/integrations/${integrationId}/credentials`,
        {
          token,
          data: { credentials: { testKey: 'integration-test-value' } },
        },
      )
      expect(updateCredentialsResponse.status()).toBe(200)

      // Verify credentials persisted
      const verifyCredentialsResponse = await apiRequest(
        request,
        'GET',
        `/api/integrations/${integrationId}/credentials`,
        { token },
      )
      expect(verifyCredentialsResponse.status()).toBe(200)
      const verifyCredentialsBody = await readJson(verifyCredentialsResponse)
      const credentials = verifyCredentialsBody.credentials as JsonRecord
      expect(credentials.testKey).toBe('integration-test-value')

      // Disable integration
      const disableResponse = await apiRequest(
        request,
        'PUT',
        `/api/integrations/${integrationId}/state`,
        {
          token,
          data: { isEnabled: false, reauthRequired: true },
        },
      )
      expect(disableResponse.status()).toBe(200)
      const disableBody = await readJson(disableResponse)
      expect(disableBody.isEnabled).toBe(false)
      expect(disableBody.reauthRequired).toBe(true)

      // Re-enable integration
      const enableResponse = await apiRequest(
        request,
        'PUT',
        `/api/integrations/${integrationId}/state`,
        {
          token,
          data: { isEnabled: true, reauthRequired: false },
        },
      )
      expect(enableResponse.status()).toBe(200)

      // Attempt invalid version update
      const versionResponse = await apiRequest(
        request,
        'PUT',
        `/api/integrations/${integrationId}/version`,
        {
          token,
          data: { apiVersion: 'non-existent-version' },
        },
      )
      expect(versionResponse.status()).toBe(422)
    } finally {
      // Restore original state
      await apiRequest(request, 'PUT', `/api/integrations/${integrationId}/credentials`, {
        token,
        data: { credentials: previousCredentials },
      })

      await apiRequest(request, 'PUT', `/api/integrations/${integrationId}/state`, {
        token,
        data: {
          isEnabled:
            typeof baselineState.isEnabled === 'boolean'
              ? baselineState.isEnabled
              : false,
          reauthRequired:
            typeof baselineState.reauthRequired === 'boolean'
              ? baselineState.reauthRequired
              : false,
        },
      })
    }
  })

  test('detail returns 404 for non-existent integration', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const detailResponse = await apiRequest(request, 'GET', '/api/integrations/non_existent_xyz', { token })
    expect(detailResponse.status()).toBe(404)
  })
})
