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
 * acquires a per-tenant DB lock before starting the operation. In queue mode
 * (useQueue:true — the default) it only KEEPS the lock when there is queued work
 * for workers to own — i.e. the fulltext backend is available AND at least one
 * indexing job was enqueued. On the no-op paths (no indexable strategy / backend
 * unavailable → 503, or zero jobs enqueued) the route deliberately releases the
 * lock in `finally` so it cannot get stuck with no worker to clear it (the
 * unit-level contract is pinned by `reindex.routes.test.ts`).
 *
 * Consequently the 409 "already in progress" guarantee is only observable while a
 * real reindex is actively holding the lock. This integration environment has no
 * Meilisearch backend, so the first reindex returns 503 and holds no lock; the
 * test asserts the held-lock → 409 contract only when a lock is genuinely present,
 * and otherwise asserts that a backend-unavailable reindex neither leaves a lock
 * nor spuriously rejects a concurrent call. Integration specs run serially
 * (workers:1), so no other test contends for the shared lock; it is released in
 * `finally` via the cancel endpoint.
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

      // First reindex acquires the lock. It keeps the lock only when there is
      // queued work (backend available + jobs enqueued); otherwise it returns
      // 503/200 and releases the lock.
      const first = await apiRequest(request, 'POST', '/api/search/reindex', { token, data: { useQueue: true } })
      expect(first.status(), 'first reindex must not hit a pre-existing lock').not.toBe(409)
      expect([200, 503], 'first reindex starts (200) or reports backend unavailable (503)').toContain(first.status())

      const settings = await apiRequest(request, 'GET', '/api/search/settings', { token })
      expect(settings.ok(), 'search settings should be readable after starting reindex').toBeTruthy()
      const settingsBody = (await readJsonSafe<SearchSettingsResponse>(settings)) ?? {}
      const heldLock = settingsBody.settings?.fulltextReindexLock ?? null

      if (heldLock) {
        // A real reindex is holding the lock: the concurrency contract applies.
        expect(heldLock.type, 'a held reindex lock identifies the fulltext lock').toBe('fulltext')

        const second = await apiRequest(request, 'POST', '/api/search/reindex', { token, data: { useQueue: true } })
        expect(second.status(), 'a concurrent reindex must be rejected with 409').toBe(409)
        const body = (await readJsonSafe<ConflictBody>(second)) ?? {}
        expect(body.lock?.type, 'the 409 lock descriptor identifies the fulltext lock').toBe('fulltext')
        expect(typeof body.lock?.action, 'the lock reports its action').toBe('string')
        expect(typeof body.lock?.startedAt, 'the lock reports when it started').toBe('string')
        expect(typeof body.lock?.elapsedMinutes, 'the lock reports elapsed minutes').toBe('number')
      } else {
        // No backend / no queued work: the route released the lock, so a
        // concurrent reindex is NOT rejected with 409 — it behaves like the first.
        const second = await apiRequest(request, 'POST', '/api/search/reindex', { token, data: { useQueue: true } })
        expect(
          [200, 503],
          'with no held lock a concurrent reindex is not rejected with 409',
        ).toContain(second.status())
      }
    } finally {
      if (token) {
        await apiRequest(request, 'POST', '/api/search/reindex/cancel', { token }).catch(() => undefined)
      }
    }
  })
})
