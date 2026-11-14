import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-CRM-095: the shared CRUD validation error follows the request locale
 * instead of always answering in English.
 */
test.describe('TC-CRM-095: CRUD validation error locale', () => {
  const path = `/api/customers/people?tagIds=${encodeURIComponent('not-a-uuid')}`

  test('answers the 400 validation error in the requested language', async ({ request }) => {
    const token = await getAuthToken(request)

    const german = await apiRequest(request, 'GET', path, { token, headers: { 'Accept-Language': 'de' } })
    expect(german.status()).toBe(400)
    const germanBody = await readJsonSafe<{ error?: unknown; details?: unknown }>(german)
    expect(germanBody?.error).toBe('Ungültige Eingabe')
    expect(Array.isArray(germanBody?.details)).toBe(true)

    const english = await apiRequest(request, 'GET', path, { token, headers: { 'Accept-Language': 'en' } })
    expect(english.status()).toBe(400)
    const englishBody = await readJsonSafe<{ error?: unknown }>(english)
    expect(englishBody?.error).toBe('Invalid input')
  })
})
