import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

type GlobalSearchSettings = { enabledStrategies?: string[] }
type GlobalSearchUpdate = { ok?: boolean; enabledStrategies?: string[] }
type GlobalSearchResponse = { strategiesEnabled?: string[] }

const DEFAULT_STRATEGIES = ['fulltext', 'vector', 'tokens']

/**
 * TC-SEARCH-006: global (Cmd+K) search honors the saved strategy config over a
 * URL override. Source: issue #2483.
 *
 * Routes:
 *   - GET/POST /api/search/settings/global-search  (POST requires search.manage)
 *   - GET /api/search/search/global                 (ignores any `strategies` URL param)
 *
 * Saves enabledStrategies = ['tokens'], then calls global search with a
 * conflicting ?strategies=fulltext,vector and asserts the response's
 * strategiesEnabled reflects the SAVED config, not the URL. The original config
 * is restored in `finally`. `admin` holds both search.view and search.manage.
 */
test.describe('TC-SEARCH-006: global search honors saved strategy config over URL override', () => {
  test('persisted enabledStrategies wins over the strategies URL parameter', async ({ request }) => {
    test.slow()
    test.setTimeout(120_000)

    let token: string | null = null
    let originalStrategies: string[] | null = DEFAULT_STRATEGIES

    try {
      token = await getAuthToken(request, 'admin')

      const currentRes = await apiRequest(request, 'GET', '/api/search/settings/global-search', { token })
      expect(currentRes.ok(), 'GET global-search settings should succeed').toBeTruthy()
      const current = (await readJsonSafe<GlobalSearchSettings>(currentRes)) ?? {}
      expect(Array.isArray(current.enabledStrategies), 'settings expose an enabledStrategies array').toBe(true)
      originalStrategies =
        Array.isArray(current.enabledStrategies) && current.enabledStrategies.length > 0
          ? current.enabledStrategies
          : DEFAULT_STRATEGIES

      const updateRes = await apiRequest(request, 'POST', '/api/search/settings/global-search', {
        token,
        data: { enabledStrategies: ['tokens'] },
      })
      expect(updateRes.status(), 'POST global-search settings should return 200').toBe(200)
      const updated = (await readJsonSafe<GlobalSearchUpdate>(updateRes)) ?? {}
      expect(updated.ok, 'update reports ok').toBe(true)
      expect(updated.enabledStrategies, 'update echoes the saved strategies').toEqual(['tokens'])

      const globalRes = await apiRequest(
        request,
        'GET',
        `/api/search/search/global?q=qa-search-006-${Date.now()}&strategies=fulltext,vector`,
        { token },
      )
      expect(globalRes.ok(), 'GET global search should succeed').toBeTruthy()
      const globalBody = (await readJsonSafe<GlobalSearchResponse>(globalRes)) ?? {}
      expect(
        globalBody.strategiesEnabled,
        'global search must use the saved config (tokens), ignoring the strategies URL override',
      ).toEqual(['tokens'])
    } finally {
      if (token && originalStrategies) {
        await apiRequest(request, 'POST', '/api/search/settings/global-search', {
          token,
          data: { enabledStrategies: originalStrategies },
        }).catch(() => undefined)
      }
    }
  })
})
