import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createApiKeyFixture } from '@open-mercato/core/modules/core/__integration__/helpers/apiKeysFixtures'

/**
 * TC-APIKEY-003: Revoke API key via API
 * Source: issue #2470
 *
 * DELETE /api/api_keys/keys?id=<id> soft-deletes the key; it must disappear from
 * the list. Complements the UI-level revoke covered by TC-ADMIN-002.
 */
test.describe('TC-APIKEY-003: Revoke API key via API', () => {
  test('removes a deleted key from the list', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const keyName = `QA TC-APIKEY-003 ${Date.now()}`
    const created = await createApiKeyFixture(request, token, keyName)

    try {
      // Sanity: key is present before deletion.
      const before = await apiRequest(request, 'GET', `/api/api_keys/keys?search=${encodeURIComponent(keyName)}`, { token })
      expect(before.status()).toBe(200)
      const beforeList = (await before.json()) as { items?: Array<Record<string, unknown>> }
      expect((beforeList.items ?? []).some((item) => item.id === created.id)).toBe(true)

      const deleteResponse = await apiRequest(request, 'DELETE', `/api/api_keys/keys?id=${encodeURIComponent(created.id)}`, { token })
      expect(deleteResponse.status(), 'delete should succeed').toBe(200)
      const deleteBody = (await deleteResponse.json()) as { success?: boolean }
      expect(deleteBody.success).toBe(true)

      const after = await apiRequest(request, 'GET', `/api/api_keys/keys?search=${encodeURIComponent(keyName)}`, { token })
      expect(after.status()).toBe(200)
      const afterList = (await after.json()) as { items?: Array<Record<string, unknown>> }
      expect((afterList.items ?? []).some((item) => item.id === created.id)).toBe(false)
    } finally {
      await apiRequest(request, 'DELETE', `/api/api_keys/keys?id=${encodeURIComponent(created.id)}`, { token }).catch(() => {})
    }
  })
})
