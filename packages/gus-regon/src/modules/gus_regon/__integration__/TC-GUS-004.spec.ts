import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { restoreIntegration, saveCredentials, setIntegrationEnabled, snapshotIntegration } from './helpers/fixtures'

/**
 * TC-GUS-004: CRM company card gating (GET /api/gus_regon/status)
 *
 * - Off by default (switch not set).
 * - Switch on without an API key → still off (missing key), even in Test.
 * - Switch on with an API key and the integration enabled → on.
 * - Integration disabled → off.
 * - The key is never returned.
 *
 * Self-contained: state and credentials are restored in `finally`; skips when a
 * real API key is configured or credentials cannot be read.
 */
test.describe('TC-GUS-004: GUS REGON CRM company card gating', () => {
  test('is off by default, requires an API key, and follows the integration state', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const snapshot = await snapshotIntegration(request, token)
    test.skip(snapshot.credentials === null, 'Integration credentials cannot be read on this environment')
    test.skip(snapshot.apiKeyConfigured, 'A GUS API key is already configured on this environment')

    const readStatus = async () => {
      const response = await apiRequest(request, 'GET', '/api/gus_regon/status', { token })
      expect(response.status()).toBe(200)
      const raw = await response.text()
      return { raw, body: JSON.parse(raw) as Record<string, unknown> }
    }

    try {
      await saveCredentials(request, token, { environment: 'test' })
      await setIntegrationEnabled(request, token, true)
      let status = await readStatus()
      expect(status.body).toMatchObject({ enabled: true, lookupAvailable: true, companyFormsRequested: false, companyFormsActive: false })

      await saveCredentials(request, token, { environment: 'test', showOnCompanyForms: true })
      status = await readStatus()
      expect(status.body).toMatchObject({ hasApiKey: false, companyFormsRequested: true, companyFormsActive: false })

      const key = 'abcde12345abcde12345'
      await saveCredentials(request, token, { environment: 'test', apiKey: key, showOnCompanyForms: true })
      status = await readStatus()
      expect(status.body).toMatchObject({ hasApiKey: true, companyFormsActive: true })
      expect(status.raw).not.toContain(key)

      await setIntegrationEnabled(request, token, false)
      status = await readStatus()
      expect(status.body).toMatchObject({ enabled: false, companyFormsActive: false })
    } finally {
      await restoreIntegration(request, token, snapshot)
    }
  })
})
