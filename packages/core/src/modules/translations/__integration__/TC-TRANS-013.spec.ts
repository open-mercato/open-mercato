import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { ISO_639_1 } from '@open-mercato/shared/lib/i18n/iso639'
import { getLocales, setLocales } from './helpers/translationFixtures'

/**
 * TC-TRANS-013: Locales max-50 boundary validation
 * Surfaces: PUT /api/translations/locales
 *
 * The supported-locales body schema accepts at most 50 ISO 639-1 codes. Verify
 * the boundary on both sides: 50 distinct valid codes succeed (200), 51 are
 * rejected (400). Locale codes are drawn from the canonical ISO_639_1 table so
 * they are guaranteed valid and distinct.
 */
const allCodes = ISO_639_1.map((entry) => entry.code)
const fiftyValidLocales = allCodes.slice(0, 50)
const fiftyOneValidLocales = allCodes.slice(0, 51)

test.describe('TC-TRANS-013: locales max-50 boundary', () => {
  test('accepts exactly 50 locales and rejects 51', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const originalLocales = await getLocales(request, adminToken)

    try {
      expect(fiftyValidLocales).toHaveLength(50)
      expect(fiftyOneValidLocales).toHaveLength(51)

      const okResponse = await apiRequest(request, 'PUT', '/api/translations/locales', {
        token: adminToken,
        data: { locales: fiftyValidLocales },
      })
      expect(okResponse.status()).toBe(200)
      const okBody = (await okResponse.json()) as { locales: string[] }
      expect(okBody.locales).toHaveLength(50)
      expect([...okBody.locales].sort()).toEqual([...fiftyValidLocales].sort())

      const tooManyResponse = await apiRequest(request, 'PUT', '/api/translations/locales', {
        token: adminToken,
        data: { locales: fiftyOneValidLocales },
      })
      expect(tooManyResponse.status()).toBe(400)
    } finally {
      await setLocales(request, adminToken, originalLocales).catch(() => {})
    }
  })
})
