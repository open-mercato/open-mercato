import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import {
  assignEmployeeToProjectFixture,
  createTimeProjectFixture,
  deleteStaffEntityIfExists,
  getSelfStaffMemberId,
  stopRunningTimers,
} from '@open-mercato/core/helpers/integration/timesheetFixtures'
import { createTestCustomer, type TestCustomerFixture } from './fixtures'
import { expectOperation, skipIfUndoTestsDisabled, undoOk } from '@open-mercato/core/helpers/integration/undoHarness'

/**
 * TC-STAFF-041: undoing `staff.timesheets.time_entries.start_timer` must not leave
 * an orphaned work segment behind.
 *
 * `execute` creates the entry AND opens a work segment on it in one transaction.
 * Undo soft-deleted only the entry, so the segment stayed live (`deleted_at = NULL`)
 * AND open (`ended_at = NULL`) — a segment still running against an entry that no
 * longer exists. Reproduced during a local UI QA pass.
 *
 * Segments are asserted directly in the database rather than through the segments
 * API, because that route resolves the parent entry first and 404s once the entry
 * is soft-deleted — exactly the blind spot that let the orphan go unnoticed.
 *
 * Endpoints:
 *   - POST /api/staff/timesheets/time-entries/start-timer
 *   - POST /api/audit_logs/audit-logs/actions/undo  { undoToken }
 */

type SegmentRow = { id: string; deleted_at: string | null; ended_at: string | null }

/**
 * `pg` returns `timestamptz` as a Date, so raw rows compared with `toBe` fail on
 * identity even when the instants are equal. Normalizing to ISO strings keeps the
 * timestamp assertions meaningful instead of accidentally always-failing.
 */
function toIso(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString()
}

async function readSegments(timeEntryId: string): Promise<SegmentRow[]> {
  return withClient(async (client) => {
    const result = await client.query<Record<string, unknown>>(
      'select id, deleted_at, ended_at from staff_time_entry_segments where time_entry_id = $1',
      [timeEntryId],
    )
    return result.rows.map((row) => ({
      id: String(row.id),
      deleted_at: toIso(row.deleted_at),
      ended_at: toIso(row.ended_at),
    }))
  })
}

async function readEntryDeletedAt(timeEntryId: string): Promise<string | null | undefined> {
  return withClient(async (client) => {
    const result = await client.query<Record<string, unknown>>(
      'select deleted_at from staff_time_entries where id = $1',
      [timeEntryId],
    )
    if (result.rows.length === 0) return undefined
    return toIso(result.rows[0].deleted_at)
  })
}

test.describe('TC-STAFF-041: start_timer undo leaves no orphaned segment', () => {
  test('undoing a timer start soft-deletes the entry and its work segment', async ({ request }) => {
    skipIfUndoTestsDisabled()

    let token: string | null = null
    let projectId: string | null = null
    let customer: TestCustomerFixture | null = null
    let entryId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      const staffMemberId = await getSelfStaffMemberId(request, token)
      await stopRunningTimers(request, token, staffMemberId)

      customer = await createTestCustomer(request, token)
      projectId = await createTimeProjectFixture(request, token, { customerId: customer.id, name: `QA TC-STAFF-041 ${Date.now()}` })
      await assignEmployeeToProjectFixture(request, token, projectId, staffMemberId)

      const startRes = await apiRequest(request, 'POST', '/api/staff/timesheets/time-entries/start-timer', {
        token,
        data: {
          staffMemberId,
          timeProjectId: projectId,
          date: new Date().toISOString().slice(0, 10),
          notes: null,
        },
      })
      expect(startRes.ok(), `start-timer should succeed: ${startRes.status()}`).toBeTruthy()
      entryId = ((await startRes.json()) as { id?: string }).id ?? null
      expect(entryId, 'start-timer returned a time entry id').toBeTruthy()

      const operation = expectOperation(startRes, 'staff.timesheets.time_entries.start_timer')

      const beforeUndo = await readSegments(entryId as string)
      expect(beforeUndo, 'the start opened exactly one work segment').toHaveLength(1)
      expect(beforeUndo[0].deleted_at, 'segment is live before the undo').toBeNull()
      expect(beforeUndo[0].ended_at, 'segment is open before the undo').toBeNull()

      await undoOk(request, token, operation.undoToken, 'staff.timesheets.time_entries.start_timer')

      expect(await readEntryDeletedAt(entryId as string), 'entry is soft-deleted after the undo').not.toBeNull()

      const afterUndo = await readSegments(entryId as string)
      expect(
        afterUndo.filter((segment) => segment.deleted_at === null),
        'no live segment survives the undo',
      ).toHaveLength(0)
      expect(
        afterUndo.filter((segment) => segment.ended_at === null),
        'no segment is left running after the undo',
      ).toHaveLength(0)
    } finally {
      if (token && entryId) {
        await apiRequest(request, 'DELETE', `/api/staff/timesheets/time-entries?id=${encodeURIComponent(entryId)}`, {
          token,
        }).catch(() => {})
      }
      if (token && projectId) {
        await deleteStaffEntityIfExists(request, token, '/api/staff/timesheets/time-projects', projectId)
      }
      await customer?.cleanup()
    }
  })
})
