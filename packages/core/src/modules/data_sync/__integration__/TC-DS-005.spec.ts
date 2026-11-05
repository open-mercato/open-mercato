import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJson, uniqueIntegrationId, type JsonRecord } from './helpers/support'
import { decodeTokenScope, deleteSyncRunsByIntegration, seedSyncRuns } from './helpers/db'

/**
 * TC-DS-005: Data sync run list filtering by status and direction
 *
 * Implements issue #2475 scenario "TC-DS-004 — Run list filtering by status and
 * direction" (renumbered to avoid the existing TC-DS-003/004 files).
 *
 * Run status cannot be controlled deterministically through the API (the queue
 * worker advances runs asynchronously), so runs are seeded directly in Postgres
 * under a per-run-unique integration id. Filtering by that id isolates the seeded
 * rows so `status`/`direction` assertions are exact. Cleanup hard-deletes them.
 */

test.describe('TC-DS-005: Data sync run list filtering', () => {
  test('filters runs by status, direction, and combined query params', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const scope = decodeTokenScope(token)
    const integrationId = uniqueIntegrationId('test_ds005')
    const entityType = 'catalog.product'
    const now = Date.now()

    // Seeded newest → oldest so the unfiltered list order is deterministic.
    const [completedId, failedId, pendingId] = await seedSyncRuns([
      { ...scope, integrationId, entityType, direction: 'import', status: 'completed', createdAt: new Date(now) },
      {
        ...scope,
        integrationId,
        entityType,
        direction: 'export',
        status: 'failed',
        lastError: 'TC-DS-005 seeded failure',
        createdAt: new Date(now - 1000),
      },
      { ...scope, integrationId, entityType, direction: 'import', status: 'pending', createdAt: new Date(now - 2000) },
    ])

    const idsFor = (body: JsonRecord): string[] => (body.items as JsonRecord[]).map((item) => String(item.id))

    try {
      // status=completed → only the completed run
      const completedRes = await apiRequest(
        request,
        'GET',
        `/api/data_sync/runs?integrationId=${integrationId}&status=completed`,
        { token },
      )
      expect(completedRes.status()).toBe(200)
      const completedBody = await readJson(completedRes)
      expect(idsFor(completedBody)).toEqual([completedId])
      expect((completedBody.items as JsonRecord[]).every((item) => item.status === 'completed')).toBe(true)

      // status=failed → only the failed run, with its persisted lastError
      const failedRes = await apiRequest(
        request,
        'GET',
        `/api/data_sync/runs?integrationId=${integrationId}&status=failed`,
        { token },
      )
      const failedBody = await readJson(failedRes)
      expect(idsFor(failedBody)).toEqual([failedId])
      expect((failedBody.items as JsonRecord[])[0].lastError).toBe('TC-DS-005 seeded failure')

      // direction=export → only the export run (the failed one)
      const exportRes = await apiRequest(
        request,
        'GET',
        `/api/data_sync/runs?integrationId=${integrationId}&direction=export`,
        { token },
      )
      const exportBody = await readJson(exportRes)
      expect(idsFor(exportBody)).toEqual([failedId])

      // combined integrationId + entityType + direction + status → only the pending import run
      const combinedRes = await apiRequest(
        request,
        'GET',
        `/api/data_sync/runs?integrationId=${integrationId}&entityType=${entityType}&direction=import&status=pending`,
        { token },
      )
      const combinedBody = await readJson(combinedRes)
      expect(idsFor(combinedBody)).toEqual([pendingId])

      // No status/direction filter → all three for this integration, ordered createdAt DESC
      const allRes = await apiRequest(request, 'GET', `/api/data_sync/runs?integrationId=${integrationId}`, { token })
      const allBody = await readJson(allRes)
      expect(allBody.total).toBe(3)
      expect(idsFor(allBody)).toEqual([completedId, failedId, pendingId])
    } finally {
      await deleteSyncRunsByIntegration(integrationId)
    }
  })
})
