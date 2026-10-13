import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  TPAY_PRECONFIGURED_SKIP_REASON,
  captureTpayBaseline,
  hasPreconfiguredTpaySecrets,
  countGatewayTransactions,
  createTpaySession,
  restoreTpayBaseline,
  saveTpayDummyCredentials,
  setTpayEnabled,
} from './helpers/fixtures'

/**
 * TC-TPAY-002: Tpay session validation rejects before reaching the provider
 *
 * A PLN session with no payer metadata is rejected with 422 `gateway_tpay.errors.payerEmailRequired` and creates no gateway transaction.
 * Uses dummy credentials only; the rejection happens before any network call to Tpay.
 */
test.describe('TC-TPAY-002: Tpay session validation', () => {
  test('rejects a PLN session without payer data before any provider call', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const baseline = await captureTpayBaseline(request, token)
    test.skip(hasPreconfiguredTpaySecrets(baseline), TPAY_PRECONFIGURED_SKIP_REASON)

    try {
      await saveTpayDummyCredentials(request, token)
      await setTpayEnabled(request, token, true)
      const transactionsBefore = await countGatewayTransactions(request, token)

      const result = await createTpaySession(request, token, {
        amount: 49.99,
        currencyCode: 'PLN',
      })

      expect(result.status).toBe(422)
      expect(result.body.code).toBe('gateway_tpay.errors.payerEmailRequired')
      expect(await countGatewayTransactions(request, token)).toBe(transactionsBefore)
    } finally {
      await restoreTpayBaseline(request, token, baseline)
    }
  })
})
