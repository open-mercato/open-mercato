import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

type JsonRecord = Record<string, unknown>

/**
 * TC-CHANNEL-MS365-006 — Microsoft 365 appears in Integrations with its credential fields.
 *
 * The provider registers an `IntegrationDefinition` (`channel_ms365`) in the
 * communication category. The detail API must expose the four tenant credential
 * fields (client id, client secret, tenant id, scopes) and the Integrations
 * page must list the provider so an admin can find it.
 */
test.describe('TC-CHANNEL-MS365-006: Microsoft 365 integration card', () => {
  test('GET /api/integrations/channel_ms365 exposes the tenant credential fields', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(request, 'GET', '/api/integrations/channel_ms365', { token })
    expect(response.status()).toBe(200)
    const body = (await readJsonSafe(response)) as JsonRecord
    const serialized = JSON.stringify(body)
    for (const key of ['clientId', 'clientSecret', 'tenantId', 'scopes']) {
      expect(serialized, `credential field ${key} should be declared`).toContain(`"${key}"`)
    }
    expect(serialized).toContain('"ms365"')
    expect(serialized).toContain('communication_channels')
  })

  test('the Integrations page lists Microsoft 365', async ({ page }) => {
    await login(page, 'admin')
    await page.goto('/backend/integrations')
    await expect(page.getByText('Microsoft 365', { exact: false }).first()).toBeVisible({ timeout: 30_000 })
  })
})
