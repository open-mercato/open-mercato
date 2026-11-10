import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-NOTIF-026: GET /api/notifications rejects an invalid query parameter with a 400.
 *
 * The list handler used to call a throwing `parse()` on the query string, so an unknown `status`,
 * a non-numeric `page` or an out-of-range `pageSize` escaped as an unhandled 500. Read-only: the
 * admin's own inbox is listed, nothing is created.
 */

const invalidQueries: Array<{ query: string; field: string }> = [
  { query: 'status=not-a-real-status', field: 'status' },
  { query: 'page=abc', field: 'page' },
  { query: 'pageSize=500', field: 'pageSize' },
  { query: 'sourceEntityId=not-a-uuid', field: 'sourceEntityId' },
  { query: 'since=yesterday', field: 'since' },
]

test.describe('TC-NOTIF-026: notification list query validation', () => {
  test('invalid query parameters return 400, a valid query still lists', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    for (const { query, field } of invalidQueries) {
      const res = await apiRequest(request, 'GET', `/api/notifications?${query}`, { token })
      expect(res.status(), query).toBe(400)
      const body = await readJsonSafe<{ error?: string }>(res)
      expect(body?.error, query).toContain(field)
    }

    const valid = await apiRequest(request, 'GET', '/api/notifications?status=unread&page=1&pageSize=5', { token })
    expect(valid.status()).toBe(200)
    const listed = await readJsonSafe<{ items?: unknown[]; page?: number; pageSize?: number }>(valid)
    expect(Array.isArray(listed?.items)).toBe(true)
    expect(listed?.page).toBe(1)
    expect(listed?.pageSize).toBe(5)
  })
})
