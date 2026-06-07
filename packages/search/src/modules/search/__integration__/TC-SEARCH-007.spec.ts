import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

type ReindexLock = {
  type?: string
  action?: string
  startedAt?: string
  elapsedMinutes?: number
  processedCount?: number | null
  totalCount?: number | null
}
type ConflictBody = { error?: string; lock?: ReindexLock }
type SearchSettingsResponse = { settings?: { fulltextReindexLock?: ReindexLock | null } }

const DEFAULT_STRATEGIES = ['fulltext', 'vector', 'tokens']

/**
 * TC-SEARCH-007: concurrent fulltext reindex returns 409 with lock info.
 * Source: issue #2483.
 *
 * Route: POST /api/search/reindex (requireFeatures ['search.reindex']). The route
 * acquires a per-tenant DB lock BEFORE any indexing work and, in queue mode
 * (useQueue:true — the default), does NOT release it in `finally` (workers and
 * the heartbeat own it). So a first call holds the lock and a second call returns
 * 409 with the lock descriptor — independent of whether a fulltext backend is
 * configured, because the lock is taken before the strategy-availability check.
 * Integration specs run serially (workers:1), so no other test contends for the
 * shared lock; it is released in `finally` via the cancel endpoint.
 */
test.describe('TC-SEARCH-007: concurrent fulltext reindex returns 409 with lock info', () => {
  test('a second reindex while one is active is rejected with 409', async ({ request }) => {
    test.slow()
    test.setTimeout(120_000)

    let token: string | null = null

    try {
      token = await getAuthToken(request, 'admin')

      // Start from a clean lock state.
      await apiRequest(request, 'POST', '/api/search/reindex/cancel', { token }).catch(() => undefined)
      await apiRequest(request, 'POST', '/api/search/settings/global-search', {
        token,
        data: { enabledStrategies: DEFAULT_STRATEGIES },
      }).catch(() => undefined)

      // First reindex acquires (and, in queue mode, holds) the fulltext lock.
      const first = await apiRequest(request, 'POST', '/api/search/reindex', { token, data: { useQueue: true } })
      expect(first.status(), 'first reindex must not hit a pre-existing lock').not.toBe(409)
      expect([200, 503], 'first reindex starts (200) or reports backend unavailable (503)').toContain(first.status())

      const settings = await apiRequest(request, 'GET', '/api/search/settings', { token })
      expect(settings.ok(), 'search settings should be readable after starting reindex').toBeTruthy()
      const settingsBody = (await readJsonSafe<SearchSettingsResponse>(settings)) ?? {}
      expect(settingsBody.settings?.fulltextReindexLock?.type, 'first reindex should leave an observable fulltext lock').toBe('fulltext')

      // Second reindex is rejected while the first holds the lock.
      const second = await apiRequest(request, 'POST', '/api/search/reindex', { token, data: { useQueue: true } })
      expect(second.status(), 'a concurrent reindex must be rejected with 409').toBe(409)
      const body = (await readJsonSafe<ConflictBody>(second)) ?? {}
      expect(body.lock?.type, 'the 409 lock descriptor identifies the fulltext lock').toBe('fulltext')
      expect(typeof body.lock?.action, 'the lock reports its action').toBe('string')
      expect(typeof body.lock?.startedAt, 'the lock reports when it started').toBe('string')
      expect(typeof body.lock?.elapsedMinutes, 'the lock reports elapsed minutes').toBe('number')
    } finally {
      if (token) {
        await apiRequest(request, 'POST', '/api/search/reindex/cancel', { token }).catch(() => undefined)
      }
    }
  })
})
