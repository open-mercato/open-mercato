import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  readJsonSafe,
} from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'

test.describe('TC-CRM-034: Dashboard widgets, address format settings, and check-phone API', () => {
  test('should return new-customers dashboard widget data', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const response = await apiRequest(request, 'GET', '/api/customers/dashboard/widgets/new-customers', { token })
    expect([200, 403]).toContain(response.status())

    if (response.status() === 200) {
      const body = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(response)
      expect(Array.isArray(body?.items)).toBe(true)
    }
  })

  test('should return next-interactions dashboard widget data', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const response = await apiRequest(request, 'GET', '/api/customers/dashboard/widgets/next-interactions', { token })
    expect([200, 403]).toContain(response.status())

    if (response.status() === 200) {
      const body = await readJsonSafe<{ items?: Array<Record<string, unknown>>; now?: string }>(response)
      expect(Array.isArray(body?.items)).toBe(true)
      expect(typeof body?.now).toBe('string')
    }
  })

  test('should read and update address format settings', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    // Read current format
    const getResponse = await apiRequest(request, 'GET', '/api/customers/settings/address-format', { token })
    expect(getResponse.status(), 'GET /api/customers/settings/address-format should return 200').toBe(200)
    const getBody = await readJsonSafe<{ addressFormat?: string }>(getResponse)
    const originalFormat = getBody?.addressFormat ?? 'line_first'
    expect(['line_first', 'street_first']).toContain(originalFormat)

    // Update to the opposite
    const newFormat = originalFormat === 'line_first' ? 'street_first' : 'line_first'
    const putResponse = await apiRequest(request, 'PUT', '/api/customers/settings/address-format', {
      token,
      data: { addressFormat: newFormat },
    })
    expect(putResponse.status(), 'PUT /api/customers/settings/address-format should return 200').toBe(200)
    const putBody = await readJsonSafe<{ addressFormat?: string }>(putResponse)
    expect(putBody?.addressFormat).toBe(newFormat)

    // Verify persistence
    const verifyResponse = await apiRequest(request, 'GET', '/api/customers/settings/address-format', { token })
    const verifyBody = await readJsonSafe<{ addressFormat?: string }>(verifyResponse)
    expect(verifyBody?.addressFormat).toBe(newFormat)

    // Restore original
    await apiRequest(request, 'PUT', '/api/customers/settings/address-format', {
      token,
      data: { addressFormat: originalFormat },
    })
  })

  test('should check phone digits and return null match for non-existent number', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    // Query with digits that should not match any customer
    const response = await apiRequest(
      request,
      'GET',
      `/api/customers/people/check-phone?digits=${encodeURIComponent('00009999888877776666')}`,
      { token },
    )
    expect(response.status(), 'GET /api/customers/people/check-phone should return 200').toBe(200)
    const body = await readJsonSafe<{ match: null | Record<string, unknown> }>(response)
    expect(body?.match).toBeNull()
  })

  test('should return null for invalid phone digits format', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    // Too short (must be 4+ digits)
    const response = await apiRequest(
      request,
      'GET',
      `/api/customers/people/check-phone?digits=${encodeURIComponent('123')}`,
      { token },
    )
    expect(response.status()).toBe(200)
    const body = await readJsonSafe<{ match: null }>(response)
    expect(body?.match).toBeNull()
  })
})
