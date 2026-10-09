import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  TPAY_DUMMY_CLIENT_ID,
  TPAY_DUMMY_CLIENT_SECRET,
  captureTpayBaseline,
  readTpayCredentials,
  readTpayEnabled,
  restoreTpayBaseline,
  saveTpayDummyCredentials,
  setTpayEnabled,
} from './helpers/fixtures'

/**
 * TC-TPAY-001: Tpay credentials are saved write-only and the integration can be enabled
 *
 * Saves dummy sandbox credentials, enables the integration, and asserts that the credentials API
 * returns the client secret masked (never in plaintext). Never calls Tpay. Restores prior state.
 */
test.describe('TC-TPAY-001: Tpay credentials and enablement', () => {
  test('saves credentials without exposing the client secret and enables the integration', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const baseline = await captureTpayBaseline(request, token)

    try {
      await saveTpayDummyCredentials(request, token)
      await setTpayEnabled(request, token, true)

      const { credentials, secretFieldsConfigured } = await readTpayCredentials(request, token)
      expect(credentials.clientId).toBe(TPAY_DUMMY_CLIENT_ID)
      expect(credentials.environment).toBe('sandbox')
      expect(secretFieldsConfigured.clientSecret).toBe(true)
      expect(JSON.stringify(credentials)).not.toContain(TPAY_DUMMY_CLIENT_SECRET)
      expect(credentials.clientSecret).not.toBe(TPAY_DUMMY_CLIENT_SECRET)

      expect(await readTpayEnabled(request, token)).toBe(true)
    } finally {
      await restoreTpayBaseline(request, token, baseline)
    }
  })
})
