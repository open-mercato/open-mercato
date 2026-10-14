import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  readWarrantyClaimSettings,
  restoreWarrantyClaimSettings,
  saveWarrantyClaimSettings,
  type WarrantyClaimSettingsResult,
} from './helpers'

/**
 * TC-WC-PRECISION-002: settings autoApproveMaxAmount beyond float precision is saved and read back exactly.
 * Source: .ai/specs/2026-10-08-arbitrary-precision-money-and-fx.md
 */

const LARGE_MAX_AMOUNT = '12345678901234.123456789012345678'
const TINY_MAX_AMOUNT = '0.000000000000000001'

test.describe('TC-WC-PRECISION-002: warranty claim settings amounts beyond float precision', () => {
  test('autoApproveMaxAmount keeps every digit through save and read', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let settingsBefore: WarrantyClaimSettingsResult | null = null

    try {
      settingsBefore = await readWarrantyClaimSettings(request, token)

      const savedLarge = await saveWarrantyClaimSettings(
        request,
        token,
        { autoApproveMaxAmount: LARGE_MAX_AMOUNT },
        settingsBefore.updatedAt,
      )
      expect(savedLarge.autoApproveMaxAmountExact, 'PUT response should echo the exact amount').toBe(LARGE_MAX_AMOUNT)
      expect(savedLarge.autoApproveMaxAmount).toBe(Number(LARGE_MAX_AMOUNT))

      const readLarge = await readWarrantyClaimSettings(request, token)
      expect(readLarge.autoApproveMaxAmountExact, 'GET should return the exact amount').toBe(LARGE_MAX_AMOUNT)
      expect(readLarge.autoApproveMaxAmount).toBe(Number(LARGE_MAX_AMOUNT))

      const savedTiny = await saveWarrantyClaimSettings(
        request,
        token,
        { autoApproveMaxAmount: TINY_MAX_AMOUNT },
        readLarge.updatedAt,
      )
      expect(savedTiny.autoApproveMaxAmountExact, 'PUT response should keep sub-float-epsilon digits').toBe(TINY_MAX_AMOUNT)

      const readTiny = await readWarrantyClaimSettings(request, token)
      expect(readTiny.autoApproveMaxAmountExact, 'GET should keep sub-float-epsilon digits').toBe(TINY_MAX_AMOUNT)
    } finally {
      await restoreWarrantyClaimSettings(request, token, settingsBefore)
    }
  })
})
