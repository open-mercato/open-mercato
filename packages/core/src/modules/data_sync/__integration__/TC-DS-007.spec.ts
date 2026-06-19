import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJson, uniqueIntegrationId } from './helpers/support'
import { decodeTokenScope, deleteSyncRunsByIntegration, seedSyncRuns } from './helpers/db'

/**
 * TC-DS-007: Run retry state validation
 *
 * Implements issue #2475 scenario "TC-DS-006 — Run state validation: prevent
 * retry of completed/running runs" (renumbered to avoid existing TC-DS files).
 *
 * `POST /api/data_sync/runs/:id/retry` only allows runs in `failed`/`cancelled`
 * state (retry.ts) — any other state returns 409, and a missing run returns 404.
 * Runs are seeded directly in Postgres to control status deterministically.
 *
 * The positive path (failed/cancelled → 201 new run, inheriting integration +
 * entity + direction) is already covered by TC-DS-001; this spec covers the
 * state-guard rejections that TC-DS-001 does not exercise.
 */

test.describe('TC-DS-007: Data sync run retry state validation', () => {
  test('rejects retry of completed, running, and missing runs', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const scope = decodeTokenScope(token)
    const integrationId = uniqueIntegrationId('test_ds007')
    const entityType = 'catalog.product'

    const [completedId, runningId] = await seedSyncRuns([
      { ...scope, integrationId, entityType, direction: 'import', status: 'completed' },
      { ...scope, integrationId, entityType, direction: 'import', status: 'running' },
    ])

    try {
      // Completed run cannot be retried
      const completedRetry = await apiRequest(
        request,
        'POST',
        `/api/data_sync/runs/${completedId}/retry`,
        { token, data: { fromBeginning: false } },
      )
      expect(completedRetry.status()).toBe(409)
      const completedBody = await readJson(completedRetry)
      expect(String(completedBody.error ?? '')).toMatch(/only failed or cancelled runs can be retried/i)

      // Running run cannot be retried
      const runningRetry = await apiRequest(
        request,
        'POST',
        `/api/data_sync/runs/${runningId}/retry`,
        { token, data: { fromBeginning: false } },
      )
      expect(runningRetry.status()).toBe(409)

      // Missing run returns 404 (well-formed uuid that does not exist)
      const missingRetry = await apiRequest(
        request,
        'POST',
        `/api/data_sync/runs/${randomUUID()}/retry`,
        { token, data: { fromBeginning: false } },
      )
      expect(missingRetry.status()).toBe(404)
    } finally {
      await deleteSyncRunsByIntegration(integrationId)
    }
  })
})
