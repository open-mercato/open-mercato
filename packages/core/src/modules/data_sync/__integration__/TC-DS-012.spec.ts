import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJson, uniqueIntegrationId, type JsonRecord } from './helpers/support'
import { decodeTokenScope, deleteSyncRunsByIntegration, seedSyncRuns } from './helpers/db'

/**
 * TC-DS-012: the resume point is readable from the run API
 *
 * Covers spec step 1.5 of `.ai/specs/2026-09-16-data-sync-retry-resume-actions.md`
 * at the API layer: both the run detail page and the runs list row menu tell an
 * operator WHERE a retry will resume, and both read that answer from the same
 * three fields — `cursor` (the last committed position), `initialCursor` (where
 * the run started) and `batchesCompleted`. If any of the three stops being
 * returned, the UI silently degrades to a non-committal string while a real
 * resume point exists, which is the one failure mode the copy must never have.
 *
 * Two shapes matter and are asserted separately:
 *   - a failed run that committed batches — the UI names the cursor verbatim;
 *   - a failed run with a NULL cursor — the UI must say "no committed batch",
 *     which is explicitly NOT a claim that the retry starts from the beginning
 *     (that depends on the shared cursor row; see TC-DS-013).
 *
 * Not covered by TC-DS-001..011: TC-DS-001 exercises the detail endpoint but
 * asserts only `integrationId`/`direction` on a live run, whose cursor is
 * whatever the adapter happens to have committed. TC-DS-010 asserts the
 * `parameters` field of the same payload. No existing spec asserts `cursor`,
 * `initialCursor` or `batchesCompleted` on either endpoint, and none pins the
 * NULL-cursor shape at all.
 */

function findItemById(body: JsonRecord, id: string): JsonRecord | null {
  const items = Array.isArray(body.items) ? (body.items as JsonRecord[]) : []
  return items.find((item) => item.id === id) ?? null
}

const COMMITTED_CURSOR = 'ds012-committed-cursor-4711'
const STARTED_FROM_CURSOR = 'ds012-started-from-cursor-4000'
const COMMITTED_BATCHES = 7

test.describe('TC-DS-012: Data sync run resume point', () => {
  test('run detail and runs list expose cursor, initialCursor and batchesCompleted verbatim', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const scope = decodeTokenScope(token)
    const integrationId = uniqueIntegrationId('test_ds012')
    const entityType = 'catalog.product'

    const [committedRunId, uncommittedRunId] = await seedSyncRuns([
      {
        ...scope,
        integrationId,
        entityType,
        direction: 'import',
        status: 'failed',
        // The started-from position is deliberately different from the
        // committed one so a handler returning the wrong column cannot pass.
        cursor: COMMITTED_CURSOR,
        initialCursor: STARTED_FROM_CURSOR,
        batchesCompleted: COMMITTED_BATCHES,
      },
      // The run that failed before committing anything: `cursor` stays NULL.
      { ...scope, integrationId, entityType: 'catalog.category', direction: 'import', status: 'failed' },
    ])

    try {
      // A run that committed batches names its resume point exactly.
      const committedDetail = await apiRequest(request, 'GET', `/api/data_sync/runs/${committedRunId}`, { token })
      expect(committedDetail.status()).toBe(200)
      const committedDetailBody = await readJson(committedDetail)
      expect(committedDetailBody.cursor).toBe(COMMITTED_CURSOR)
      expect(committedDetailBody.initialCursor).toBe(STARTED_FROM_CURSOR)
      expect(committedDetailBody.batchesCompleted).toBe(COMMITTED_BATCHES)

      // A run with no committed batch: the endpoint must return an explicit
      // null rather than omitting the key, because the UI branches on it to
      // choose the non-committal copy.
      const uncommittedDetail = await apiRequest(request, 'GET', `/api/data_sync/runs/${uncommittedRunId}`, { token })
      expect(uncommittedDetail.status()).toBe(200)
      const uncommittedDetailBody = await readJson(uncommittedDetail)
      expect('cursor' in uncommittedDetailBody).toBe(true)
      expect(uncommittedDetailBody.cursor).toBeNull()
      expect(uncommittedDetailBody.initialCursor).toBeNull()
      expect(uncommittedDetailBody.batchesCompleted).toBe(0)

      // No surface reads these from the list — D8 keeps the resume point on the
      // detail page alone. Asserted as a contract guard: the fields are public
      // on this endpoint and must not disappear if a surface starts using them.
      const listResponse = await apiRequest(
        request,
        'GET',
        `/api/data_sync/runs?integrationId=${encodeURIComponent(integrationId)}`,
        { token },
      )
      expect(listResponse.status()).toBe(200)
      const listBody = await readJson(listResponse)

      const committedRow = findItemById(listBody, committedRunId)
      expect(committedRow).not.toBeNull()
      expect(committedRow?.cursor).toBe(COMMITTED_CURSOR)
      expect(committedRow?.initialCursor).toBe(STARTED_FROM_CURSOR)
      expect(committedRow?.batchesCompleted).toBe(COMMITTED_BATCHES)

      const uncommittedRow = findItemById(listBody, uncommittedRunId)
      expect(uncommittedRow).not.toBeNull()
      expect('cursor' in (uncommittedRow ?? {})).toBe(true)
      expect(uncommittedRow?.cursor).toBeNull()
      expect(uncommittedRow?.initialCursor).toBeNull()
      expect(uncommittedRow?.batchesCompleted).toBe(0)
    } finally {
      await deleteSyncRunsByIntegration(integrationId)
    }
  })
})
