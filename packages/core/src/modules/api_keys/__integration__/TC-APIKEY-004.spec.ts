import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createApiKeyFixture } from '@open-mercato/core/modules/core/__integration__/helpers/apiKeysFixtures'

/**
 * TC-APIKEY-004: List pagination and search
 * Source: issue #2470
 *
 * GET /api/api_keys/keys returns a paginated envelope and supports search by
 * name and by key prefix.
 */
test.describe('TC-APIKEY-004: List pagination and search', () => {
  test('paginates and filters API keys by name and prefix', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const marker = `TC-APIKEY-004-${Date.now()}`
    const created: Array<{ id: string; secret: string }> = []

    try {
      for (let index = 0; index < 3; index += 1) {
        created.push(await createApiKeyFixture(request, token, `${marker} key ${index}`))
      }

      // Search by shared name marker returns all three with a correct envelope.
      const byName = await apiRequest(request, 'GET', `/api/api_keys/keys?search=${encodeURIComponent(marker)}&pageSize=50`, { token })
      expect(byName.status()).toBe(200)
      const nameBody = (await byName.json()) as {
        items?: Array<Record<string, unknown>>
        total?: number
        page?: number
        pageSize?: number
        totalPages?: number
      }
      expect(Array.isArray(nameBody.items)).toBe(true)
      expect(nameBody.total).toBe(3)
      expect(nameBody.page).toBe(1)
      expect(nameBody.pageSize).toBe(50)
      expect(nameBody.totalPages).toBe(1)
      const matchedIds = new Set((nameBody.items ?? []).map((item) => item.id))
      for (const key of created) expect(matchedIds.has(key.id)).toBe(true)

      // Pagination: pageSize=2 yields 2 pages over the 3 matches.
      const page1 = await apiRequest(request, 'GET', `/api/api_keys/keys?search=${encodeURIComponent(marker)}&page=1&pageSize=2`, { token })
      const page1Body = (await page1.json()) as { items?: unknown[]; total?: number; totalPages?: number }
      expect((page1Body.items ?? []).length).toBe(2)
      expect(page1Body.total).toBe(3)
      expect(page1Body.totalPages).toBe(2)

      const page2 = await apiRequest(request, 'GET', `/api/api_keys/keys?search=${encodeURIComponent(marker)}&page=2&pageSize=2`, { token })
      const page2Body = (await page2.json()) as { items?: unknown[] }
      expect((page2Body.items ?? []).length).toBe(1)

      // Search by key prefix returns the matching key.
      const targetPrefix = created[0].secret.slice(0, 12)
      const byPrefix = await apiRequest(request, 'GET', `/api/api_keys/keys?search=${encodeURIComponent(targetPrefix)}&pageSize=50`, { token })
      expect(byPrefix.status()).toBe(200)
      const prefixBody = (await byPrefix.json()) as { items?: Array<Record<string, unknown>> }
      expect((prefixBody.items ?? []).some((item) => item.id === created[0].id)).toBe(true)
    } finally {
      for (const key of created) {
        await apiRequest(request, 'DELETE', `/api/api_keys/keys?id=${encodeURIComponent(key.id)}`, { token }).catch(() => {})
      }
    }
  })
})
