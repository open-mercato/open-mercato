import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  extractOperation,
  runCrudUndoRoundTrip,
  skipIfUndoTestsDisabled,
} from '@open-mercato/core/helpers/integration/undoHarness'
import {
  SCHEDULER_JOBS_PATH,
  SCHEDULER_TRIGGER_PATH,
  createScheduleJob,
  deleteScheduleJob,
} from './helpers/scheduler'

/**
 * TC-UNDO-001 (#2582, refs #2468) — scheduler.jobs undo/redo correctness.
 *
 * Regression lock for #2504: scheduler.jobs undo was a silent no-op because every
 * undo handler read `logEntry.payload` (always undefined — the command bus persists
 * the undo snapshot under `commandPayload`), so undo returned `{ ok: true }` while
 * changing nothing. Fixed in PR #2514 via `extractUndoPayload`. This spec asserts the
 * corrected behavior (full restoration), driving the real command bus through the
 * public API + the audit-log undo/redo endpoints.
 *
 * scheduler.jobs is a standard `makeCrudRoute` entity (POST/PUT/DELETE on the
 * collection, `?id=` read-back, camelCase serializer, no custom fields), so the shared
 * `runCrudUndoRoundTrip` harness covers the full round-trip in one pass:
 *   - I1 update → undo restores every scalar (and bumps `updatedAt`)
 *   - I2 delete → undo re-materializes the soft-deleted job
 *   - I3 create → undo soft-deletes (never hard-deletes)
 *   - I5 a consumed undo token is rejected on a second undo
 *   - I6 redo re-applies the command's after-snapshot
 *
 * I4 (custom fields) is N/A — `scheduled_job` declares no `ce.ts`, so it has no `cf_*`.
 */
function jobCreatePayload(stamp: string): Record<string, unknown> {
  return {
    name: `TC-UNDO-001 Scheduler ${stamp}`,
    description: 'TC-UNDO-001 undo/redo probe',
    scopeType: 'organization',
    scheduleType: 'interval',
    scheduleValue: '15m',
    timezone: 'UTC',
    targetType: 'queue',
    targetQueue: 'scheduler-execution',
    isEnabled: true,
    sourceType: 'user',
  }
}

test.describe('TC-UNDO-001 scheduler.jobs undo/redo (#2504)', () => {
  test.beforeAll(() => {
    skipIfUndoTestsDisabled()
  })

  test('jobs CRUD commands restore scalar state on undo/redo (I1/I2/I3/I5/I6)', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    await runCrudUndoRoundTrip(request, token, {
      label: 'scheduler.jobs',
      collectionPath: SCHEDULER_JOBS_PATH,
      field: 'name',
      createPayload: jobCreatePayload,
      updatePayload: (id, stamp) => ({ id, name: `TC-UNDO-001 Scheduler Renamed ${stamp}` }),
    })
  })

  // §4 — manual trigger is a fire-and-forget enqueue that never goes through the
  // command bus, so it exposes no undo affordance. The assertion holds regardless of
  // QUEUE_STRATEGY: async returns 200 (enqueued), local returns 400 (rejected) — neither
  // issues an `x-om-operation` undo token.
  test('§4 trigger exposes no undo token', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let jobId: string | null = null
    try {
      jobId = await createScheduleJob(request, token)
      const triggerRes = await apiRequest(request, 'POST', SCHEDULER_TRIGGER_PATH, {
        token,
        data: { id: jobId },
      })
      expect(extractOperation(triggerRes), 'trigger response carries no undo token (§4)').toBeNull()
    } finally {
      await deleteScheduleJob(request, token, jobId)
    }
  })
})
