import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJson, uniqueIntegrationId } from './helpers/support'
import { decodeTokenScope, deleteSyncRunsByIntegration, seedSyncRuns } from './helpers/db'

/**
 * TC-DS-014: "Run again" can be served from what a completed run stores
 *
 * Covers spec step 3.4 of `.ai/specs/2026-09-16-data-sync-retry-resume-actions.md`.
 * "Run again" navigates to `/backend/data-sync?from=<runId>`; the start form
 * then fetches that run and seeds itself from the response. That design only
 * holds if the run detail endpoint actually carries everything the form needs,
 * which is what this asserts at the API layer:
 *
 *   - `integrationId`, `entityType`, `direction` and `parameters` — the four
 *     things the form seeds;
 *   - and, just as importantly, that the payload carries NO `fullSync` and NO
 *     `batchSize`. `sync_runs` has no column for either, which is precisely why
 *     the prefill leaves both controls at their form defaults and says so. If a
 *     later change starts persisting them, this assertion should fail and the
 *     banner copy should be revisited — silently seeding them would be worse
 *     than not seeding them.
 *
 * Not covered by TC-DS-001..013: TC-DS-010 asserts `parameters` survive a run,
 * but nothing pins the whole seed set, and nothing pins the ABSENCE of the two
 * fields the prefill deliberately does not copy.
 */
test.describe('TC-DS-014: Data sync run again from a completed run', () => {
  test('a completed run carries the full prefill set, and nothing it cannot', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const scope = decodeTokenScope(token)
    const integrationId = uniqueIntegrationId('test_ds014')
    const entityType = 'catalog.product'

    const [completedRunId] = await seedSyncRuns([
      {
        ...scope,
        integrationId,
        entityType,
        direction: 'import',
        status: 'completed',
        cursor: 'ds014-final-cursor',
        initialCursor: 'ds014-start-cursor',
        batchesCompleted: 14,
      },
    ])

    try {
      const detail = await apiRequest(request, 'GET', `/api/data_sync/runs/${completedRunId}`, { token })
      expect(detail.status()).toBe(200)
      const body = await readJson(detail)

      // The four fields the form seeds.
      expect(body.integrationId).toBe(integrationId)
      expect(body.entityType).toBe(entityType)
      expect(body.direction).toBe('import')
      expect('parameters' in body).toBe(true)

      // The two it deliberately does not: the columns do not exist, so the
      // payload must not offer them either.
      expect(body.fullSync).toBeUndefined()
      expect(body.batchSize).toBeUndefined()

      // A completed run is not retryable — "Run again" exists precisely because
      // the retry endpoint refuses this state, and must keep refusing it.
      const retry = await apiRequest(request, 'POST', `/api/data_sync/runs/${completedRunId}/retry`, {
        token,
        data: { fromBeginning: false },
      })
      expect(retry.status()).toBe(409)
    } finally {
      await deleteSyncRunsByIntegration(integrationId)
    }
  })

  test('an unknown run id answers 404, so the prefill degrades to a plain form', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    // The UI treats this as "render the normal defaults", not as an error, so
    // the endpoint must stay a clean 404 rather than throwing.
    const missing = await apiRequest(
      request,
      'GET',
      '/api/data_sync/runs/00000000-0000-4000-8000-000000000000',
      { token },
    )
    expect(missing.status()).toBe(404)

    // A malformed id answers 400, which the form handles identically.
    const malformed = await apiRequest(request, 'GET', '/api/data_sync/runs/not-a-uuid', { token })
    expect(malformed.status()).toBe(400)
  })
})
