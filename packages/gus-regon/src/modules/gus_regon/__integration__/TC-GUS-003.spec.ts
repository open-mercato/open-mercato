import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  lookup,
  restoreIntegration,
  saveCredentials,
  setIntegrationEnabled,
  snapshotIntegration,
  VALID_NIP,
} from './helpers/fixtures'

/**
 * TC-GUS-003: fail-open lookup contract
 *
 * - Disabled integration → 200 { ok:false, reason:'not_configured' }.
 * - Production without an API key → 200 { ok:false, reason:'not_configured' }.
 *
 * Neither case reaches the GUS endpoint, so the test does not depend on the
 * external service. Rejected keys and upstream outages are covered by the unit
 * tests of the lookup and the route.
 *
 * Self-contained: the integration state and credentials are restored in `finally`.
 * Skips itself when a real API key is configured or credentials cannot be read,
 * so it never clobbers a shared environment.
 */
test.describe('TC-GUS-003: GUS REGON fail-open lookup contract', () => {
  test('reports not_configured for a disabled integration and for production without a key', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const snapshot = await snapshotIntegration(request, token)
    test.skip(snapshot.credentials === null, 'Integration credentials cannot be read on this environment')
    test.skip(snapshot.apiKeyConfigured, 'A GUS API key is already configured on this environment')

    try {
      await setIntegrationEnabled(request, token, false)
      const disabled = await lookup(request, token, VALID_NIP)
      expect(disabled.status()).toBe(200)
      expect(await disabled.json()).toEqual({ ok: false, reason: 'not_configured' })

      await saveCredentials(request, token, { environment: 'production', apiKey: '' })
      await setIntegrationEnabled(request, token, true)
      const missingKey = await lookup(request, token, VALID_NIP)
      expect(missingKey.status()).toBe(200)
      expect(await missingKey.json()).toEqual({ ok: false, reason: 'not_configured' })
    } finally {
      await restoreIntegration(request, token, snapshot)
    }
  })
})
