import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-SEARCH-005: Search validates the query parameter (400)
 * Source: issue #2483.
 *
 * Route: GET /api/search/search (requireFeatures ['search.view']). The handler
 * trims `q` and returns 400 { error: 'Missing query' } when it is empty; a
 * non-empty query is accepted with 200 (empty results when no strategy matches),
 * never 400. All cases authenticate as `admin`, which holds search.view, so the
 * empty-query 400 is produced by the handler rather than the framework gate.
 */
test.describe('TC-SEARCH-005: search validates the query parameter (400)', () => {
  let token = ''

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'admin')
  })

  test('missing q returns 400', async ({ request }) => {
    const res = await apiRequest(request, 'GET', '/api/search/search', { token })
    expect(res.status()).toBe(400)
    const body = await readJsonSafe<{ error?: string }>(res)
    expect(typeof body?.error, 'a 400 response carries an error message').toBe('string')
  })

  test('empty q returns 400', async ({ request }) => {
    const res = await apiRequest(request, 'GET', '/api/search/search?q=', { token })
    expect(res.status()).toBe(400)
  })

  test('whitespace-only q returns 400', async ({ request }) => {
    const res = await apiRequest(request, 'GET', '/api/search/search?q=%20%20%20', { token })
    expect(res.status()).toBe(400)
  })

  test('non-empty q is accepted with 200 (not rejected as 400)', async ({ request }) => {
    const res = await apiRequest(request, 'GET', `/api/search/search?q=qa-search-005-${Date.now()}`, { token })
    // The route resolves searchService and returns 200 (empty results when no
    // strategy matches); it does not 503 on this path. So a valid query is a 200.
    expect(res.status(), 'a valid query is accepted with 200').toBe(200)
  })
})
