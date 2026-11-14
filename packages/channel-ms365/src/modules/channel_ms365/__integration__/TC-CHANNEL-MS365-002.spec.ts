import { expect, test } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createMs365Sandbox, MS365_INTEGRATION_ID } from './fixtures'

type JsonRecord = Record<string, unknown>

/**
 * TC-CHANNEL-MS365-002 — Tenant OAuth client config + health check.
 *
 * Runs inside a dedicated organization/user sandbox (see `fixtures.ts`) so the
 * shared default organization's credentials are never overwritten. The
 * provider health check validates the client config without a network call:
 * a complete config is `healthy` and echoes the effective tenant; a config
 * without a client id is `unhealthy` with the `invalid_oauth_client` reason.
 */
test.describe('TC-CHANNEL-MS365-002: Microsoft 365 tenant credentials + health check', () => {
  test('saving the client config flips the health check between healthy and unhealthy', async ({ request }) => {
    const sandbox = await createMs365Sandbox(request, 'TC-MS365-002')
    try {
      const detail = await apiRequest(request, 'GET', `/api/integrations/${MS365_INTEGRATION_ID}`, { token: sandbox.token })
      expect(detail.status(), 'channel_ms365 integration should be registered').toBe(200)

      await sandbox.saveClientCredentials({
        clientId: 'tc-ms365-002-client-id',
        clientSecret: 'tc-ms365-002-client-secret',
        tenantId: 'contoso.onmicrosoft.com',
        scopes: '',
      })
      const healthy = await apiRequest(request, 'POST', `/api/integrations/${MS365_INTEGRATION_ID}/health`, { token: sandbox.token })
      expect(healthy.status()).toBe(200)
      const healthyBody = (await readJsonSafe(healthy)) as JsonRecord
      expect(healthyBody.status).toBe('healthy')
      expect((healthyBody.details as JsonRecord | null)?.tenantId).toBe('contoso.onmicrosoft.com')

      await sandbox.saveClientCredentials({ clientId: '', clientSecret: '', tenantId: '', scopes: '' })
      const unhealthy = await apiRequest(request, 'POST', `/api/integrations/${MS365_INTEGRATION_ID}/health`, { token: sandbox.token })
      expect(unhealthy.status()).toBe(200)
      const unhealthyBody = (await readJsonSafe(unhealthy)) as JsonRecord
      expect(unhealthyBody.status).toBe('unhealthy')
      expect((unhealthyBody.details as JsonRecord | null)?.reason).toBe('invalid_oauth_client')
    } finally {
      await sandbox.dispose()
    }
  })
})
