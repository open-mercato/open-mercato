import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-SALES-7265: malformed `tagIds` on the sales document list APIs are rejected with a 400
 * instead of reaching the uuid column as a database error, while a valid but unknown tag id
 * still returns an empty page (#7265).
 */
const unknownTagId = '6f1c2a4e-7b3d-4c5e-9a8f-0d1e2f3a4b5c'

test.describe('TC-SALES-7265: sales document list tagIds validation', () => {
  for (const resource of ['orders', 'quotes'] as const) {
    test(`rejects malformed tagIds on /api/sales/${resource}`, async ({ request }) => {
      const token = await getAuthToken(request)

      for (const malformed of ['not-a-uuid', `${unknownTagId},not-a-uuid`]) {
        const response = await apiRequest(
          request,
          'GET',
          `/api/sales/${resource}?tagIds=${encodeURIComponent(malformed)}`,
          { token },
        )
        expect(response.status(), `tagIds=${malformed}`).toBe(400)
        const body = await readJsonSafe<{ error?: unknown }>(response)
        expect(body?.error).toBe('Invalid input')
      }

      const unknownResponse = await apiRequest(request, 'GET', `/api/sales/${resource}?tagIds=${unknownTagId}`, { token })
      expect(unknownResponse.status()).toBe(200)
      const unknownBody = await readJsonSafe<{ items?: unknown[] }>(unknownResponse)
      expect(unknownBody?.items).toEqual([])
    })
  }
})
