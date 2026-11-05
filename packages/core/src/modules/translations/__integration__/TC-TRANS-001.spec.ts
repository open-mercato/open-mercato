import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { getLocales, setLocales } from './helpers/translationFixtures'

/**
 * TC-TRANS-001: Locale Configuration CRUD
 * Covers GET/PUT /api/translations/locales — read defaults, update, validation.
 */
test.describe('TC-TRANS-001: Locale Configuration CRUD', () => {
  test('should return default locales for authenticated user', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const response = await apiRequest(request, 'GET', '/api/translations/locales', { token })

    expect(response.ok()).toBeTruthy()
    const body = (await response.json()) as { locales: string[] }
    expect(Array.isArray(body.locales)).toBeTruthy()
    expect(body.locales.length).toBeGreaterThan(0)
  })

  test('should update locales and confirm via GET', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const originalLocales = await getLocales(request, token)

    try {
      const putResponse = await apiRequest(request, 'PUT', '/api/translations/locales', {
        token,
        data: { locales: ['en', 'de', 'fr'] },
      })
      expect(putResponse.ok()).toBeTruthy()
      const putBody = (await putResponse.json()) as { locales: string[] }
      expect(putBody.locales).toEqual(['en', 'de', 'fr'])

      const confirmedLocales = await getLocales(request, token)
      expect(confirmedLocales).toEqual(['en', 'de', 'fr'])
    } finally {
      await setLocales(request, token, originalLocales).catch(() => {})
    }
  })

  test('should reject invalid ISO 639-1 codes with 400', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const response = await apiRequest(request, 'PUT', '/api/translations/locales', {
      token,
      data: { locales: ['en', 'xx'] },
    })
    expect(response.status()).toBe(400)
  })

  test('should reject empty locales array with 400', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const response = await apiRequest(request, 'PUT', '/api/translations/locales', {
      token,
      data: { locales: [] },
    })
    expect(response.status()).toBe(400)
  })
})
