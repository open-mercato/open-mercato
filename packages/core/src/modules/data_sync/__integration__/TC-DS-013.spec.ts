import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJson, uniqueIntegrationId } from './helpers/support'
import {
  decodeTokenScope,
  deleteSyncCursorsByIntegration,
  deleteSyncRunsByIntegration,
  seedSyncCursors,
  seedSyncRuns,
} from './helpers/db'

/**
 * TC-DS-013: a from-the-beginning retry differs from a resumable one
 *
 * Covers spec step 2.4 of `.ai/specs/2026-09-16-data-sync-retry-resume-actions.md`.
 * `POST /api/data_sync/runs/:id/retry` takes a single flag, and the whole
 * feature rests on it meaning two different things:
 *
 *   fromBeginning: true   -> cursor = null                            (full replay)
 *   fromBeginning: false  -> cursor = previous.cursor ?? resolveStartCursor(...)
 *
 * `SyncRunService.createRun` copies the start cursor into `initial_cursor`, and
 * nothing afterwards rewrites that column, so the new run's `initialCursor` is
 * the durable record of which branch was taken — that is what this spec reads.
 *
 * The third case is the one an earlier draft got wrong. For a failed run whose
 * own `cursor` is NULL it is tempting to call the two requests identical,
 * because `previous.cursor` is null either way. They are not: `false` falls
 * through to `resolveStartCursor`, which (for an integration with no registered
 * adapter, hence `persistsSharedCursor === true`) reads the shared
 * `sync_cursors` row. The fixture therefore SEEDS that row for both null-cursor
 * runs, so the difference is actually observable. Without it both branches
 * would return null and the case would pass vacuously while proving nothing.
 *
 * Not covered by TC-DS-001..011: TC-DS-001 asserts a retry returns 201 and
 * inherits integration/direction, but sends no `fromBeginning` variation and
 * never reads `initialCursor`. TC-DS-007 covers only the state-guard
 * rejections. No existing spec distinguishes the two retry modes.
 */

const CURSOR_FULL_REPLAY_SOURCE = 'ds013-committed-cursor-a'
const CURSOR_RESUMABLE_SOURCE = 'ds013-committed-cursor-b'
const SHARED_CURSOR = 'ds013-shared-cursor-row-99'

// One entity type per retry so `findRunningOverlap` (pending/running for the
// same integration + entityType + direction) cannot answer 409 for a retry that
// an earlier case in this same spec already put in flight.
const ENTITY_FULL_REPLAY = 'catalog.product'
const ENTITY_RESUMABLE = 'catalog.category'
const ENTITY_NULL_CURSOR_FULL_REPLAY = 'sales.order'
const ENTITY_NULL_CURSOR_RESUMABLE = 'sales.shipment'

test.describe('TC-DS-013: Data sync retry from the beginning vs. resume', () => {
  test('fromBeginning decides whether the new run inherits a start cursor', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const scope = decodeTokenScope(token)
    const integrationId = uniqueIntegrationId('test_ds013')
    const spawnedRunIds: string[] = []

    const [fullReplaySourceId, resumableSourceId, nullCursorFullReplayId, nullCursorResumableId] = await seedSyncRuns([
      {
        ...scope,
        integrationId,
        entityType: ENTITY_FULL_REPLAY,
        direction: 'import',
        status: 'failed',
        cursor: CURSOR_FULL_REPLAY_SOURCE,
        initialCursor: CURSOR_FULL_REPLAY_SOURCE,
      },
      {
        ...scope,
        integrationId,
        entityType: ENTITY_RESUMABLE,
        direction: 'import',
        status: 'failed',
        cursor: CURSOR_RESUMABLE_SOURCE,
        initialCursor: CURSOR_RESUMABLE_SOURCE,
      },
      { ...scope, integrationId, entityType: ENTITY_NULL_CURSOR_FULL_REPLAY, direction: 'import', status: 'failed' },
      { ...scope, integrationId, entityType: ENTITY_NULL_CURSOR_RESUMABLE, direction: 'import', status: 'failed' },
    ])

    try {
      // Both null-cursor runs get the SAME shared-cursor state, so the only
      // difference between the two retries below is the request body. This is
      // the realistic shape: an earlier walk left a shared position, and the
      // run under retry died before committing a batch of its own.
      await seedSyncCursors([
        {
          ...scope,
          integrationId,
          entityType: ENTITY_NULL_CURSOR_FULL_REPLAY,
          direction: 'import',
          cursor: SHARED_CURSOR,
        },
        {
          ...scope,
          integrationId,
          entityType: ENTITY_NULL_CURSOR_RESUMABLE,
          direction: 'import',
          cursor: SHARED_CURSOR,
        },
      ])

      const retryAndReadInitialCursor = async (
        sourceRunId: string,
        fromBeginning: boolean,
      ): Promise<{ id: string; initialCursor: unknown; cursor: unknown }> => {
        const retryResponse = await apiRequest(request, 'POST', `/api/data_sync/runs/${sourceRunId}/retry`, {
          token,
          data: { fromBeginning },
        })
        expect(retryResponse.status()).toBe(201)
        const retryBody = await readJson(retryResponse)
        const newRunId = String(retryBody.id)
        expect(newRunId).toMatch(/^[0-9a-f-]{36}$/i)
        expect(newRunId).not.toBe(sourceRunId)
        spawnedRunIds.push(newRunId)

        const detailResponse = await apiRequest(request, 'GET', `/api/data_sync/runs/${newRunId}`, { token })
        expect(detailResponse.status()).toBe(200)
        const detailBody = await readJson(detailResponse)
        return { id: newRunId, initialCursor: detailBody.initialCursor ?? null, cursor: detailBody.cursor ?? null }
      }

      // 1. A committed cursor, replayed from the beginning: the stored position
      //    is deliberately discarded.
      const fullReplay = await retryAndReadInitialCursor(fullReplaySourceId, true)
      expect(fullReplay.initialCursor).toBeNull()
      expect(fullReplay.cursor).toBeNull()

      // 2. The same shape, resumed: the new run starts exactly where the failed
      //    one stopped.
      const resumed = await retryAndReadInitialCursor(resumableSourceId, false)
      expect(resumed.initialCursor).toBe(CURSOR_RESUMABLE_SOURCE)

      // 3. The important one. Both source runs have a NULL cursor and identical
      //    shared-cursor state, so `previous.cursor` contributes nothing —
      //    `fromBeginning` alone decides. `true` short-circuits to null; `false`
      //    falls through to `resolveStartCursor`, which reads the shared
      //    `sync_cursors` row this fixture seeded.
      const nullCursorFullReplay = await retryAndReadInitialCursor(nullCursorFullReplayId, true)
      expect(nullCursorFullReplay.initialCursor).toBeNull()

      const nullCursorResumed = await retryAndReadInitialCursor(nullCursorResumableId, false)
      expect(nullCursorResumed.initialCursor).toBe(SHARED_CURSOR)

      // The claim this spec exists to make, stated directly.
      expect(nullCursorFullReplay.initialCursor).not.toBe(nullCursorResumed.initialCursor)
    } finally {
      for (const runId of spawnedRunIds) {
        await apiRequest(request, 'POST', `/api/data_sync/runs/${runId}/cancel`, { token })
      }
      await deleteSyncCursorsByIntegration(integrationId)
      await deleteSyncRunsByIntegration(integrationId)
    }
  })
})
