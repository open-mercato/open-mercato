import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

type JsonRecord = Record<string, unknown>

const INTEGRATION_ID = 'channel_ms365'

/**
 * TC-CHANNEL-MS365-002 — Tenant OAuth client config + health check.
 *
 * An admin saves the Entra app credentials under Integrations → Microsoft 365.
 * The provider health check validates that config (no network call — per-user
 * tokens are validated on connect): a complete config is `healthy` and echoes
 * the effective tenant; a config without a client id is `unhealthy` with the
 * `invalid_oauth_client` reason. The previous credentials are restored afterwards.
 */
test.describe('TC-CHANNEL-MS365-002: Microsoft 365 tenant credentials + health check', () => {
  test('saving the client config flips the health check between healthy and unhealthy', async ({ request }) => {
    const token = await getAuthToken(request)

    const detail = await apiRequest(request, 'GET', `/api/integrations/${INTEGRATION_ID}`, { token })
    expect(detail.status(), 'channel_ms365 integration should be registered').toBe(200)
    const detailBody = (await readJsonSafe(detail)) as JsonRecord
    expect(detailBody.providerKey ?? (detailBody.integration as JsonRecord | undefined)?.providerKey ?? 'ms365').toBe('ms365')

    const initial = await apiRequest(request, 'GET', `/api/integrations/${INTEGRATION_ID}/credentials`, { token })
    expect(initial.status()).toBe(200)
    const initialBody = (await readJsonSafe(initial)) as JsonRecord
    const previousCredentials =
      initialBody.credentials && typeof initialBody.credentials === 'object' ? (initialBody.credentials as JsonRecord) : {}

    try {
      const save = await apiRequest(request, 'PUT', `/api/integrations/${INTEGRATION_ID}/credentials`, {
        token,
        data: {
          credentials: {
            clientId: 'tc-ms365-002-client-id',
            clientSecret: 'tc-ms365-002-client-secret',
            tenantId: 'contoso.onmicrosoft.com',
            scopes: '',
          },
        },
      })
      expect(save.status()).toBe(200)

      const healthy = await apiRequest(request, 'POST', `/api/integrations/${INTEGRATION_ID}/health`, { token })
      expect(healthy.status()).toBe(200)
      const healthyBody = (await readJsonSafe(healthy)) as JsonRecord
      expect(healthyBody.status).toBe('healthy')
      expect((healthyBody.details as JsonRecord | null)?.tenantId).toBe('contoso.onmicrosoft.com')

      const clear = await apiRequest(request, 'PUT', `/api/integrations/${INTEGRATION_ID}/credentials`, {
        token,
        data: { credentials: { clientId: '', clientSecret: '', tenantId: '', scopes: '' } },
      })
      expect(clear.status()).toBe(200)

      const unhealthy = await apiRequest(request, 'POST', `/api/integrations/${INTEGRATION_ID}/health`, { token })
      expect(unhealthy.status()).toBe(200)
      const unhealthyBody = (await readJsonSafe(unhealthy)) as JsonRecord
      expect(unhealthyBody.status).toBe('unhealthy')
      expect((unhealthyBody.details as JsonRecord | null)?.reason).toBe('invalid_oauth_client')
    } finally {
      await apiRequest(request, 'PUT', `/api/integrations/${INTEGRATION_ID}/credentials`, {
        token,
        data: { credentials: previousCredentials },
      })
    }
  })
})
