import { expect, test, type APIRequestContext } from '@playwright/test'
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
 * TC-STAFF-042: deleting a time entry cascades to its segments, and undoing that
 * delete restores EXACTLY the set the delete removed — no more.
 *
 * The restore is keyed on the single `deletedAt` instant that `execute` stamps on
 * the entry and every segment it cascades, recorded in the undo payload as
 * `segmentsDeletedAt`. A segment the user soft-deleted individually beforehand
 * carries a different timestamp, so the restore cannot resurrect it. That is the
 * property this spec exists to pin: keying on parentage instead would silently
 * undo a deliberate user action.
 *
 * The legacy case matters for the same reason from the other direction: action
 * logs written before the cascade existed carry no `segmentsDeletedAt`, and their
 * undo must restore NO segment — those deletes never cascaded, so there is nothing
 * to put back. Absence is a defined case, not a trigger for a broader restore.
 *
 * Segments are asserted directly in the database, because the segments route
 * resolves its parent entry first and 404s while the entry is soft-deleted.
 *
 * The individually-deleted precondition is written straight to the database: the
 * segments API exposes POST and PATCH only, with no route that deletes a single
 * segment. The state is nonetheless reachable in production — `start_timer_existing`
 * undo soft-deletes the segment it created — so the command must handle it.
 *
 * Endpoints:
 *   - POST   /api/staff/timesheets/time-entries/start-timer
 *   - POST   /api/staff/timesheets/time-entries/{id}/segments
 *   - DELETE /api/staff/timesheets/time-entries?id={id}
 *   - POST   /api/audit_logs/audit-logs/actions/undo  { undoToken }
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

async function readSegments(timeEntryId: string): Promise<Map<string, SegmentRow>> {
  return withClient(async (client) => {
    const result = await client.query<Record<string, unknown>>(
      'select id, deleted_at, ended_at from staff_time_entry_segments where time_entry_id = $1',
      [timeEntryId],
    )
    return new Map(
      result.rows.map((row) => {
        const id = String(row.id)
        return [id, { id, deleted_at: toIso(row.deleted_at), ended_at: toIso(row.ended_at) }] as const
      }),
    )
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

/** Soft-deletes one segment, standing in for the missing per-segment DELETE route. */
async function softDeleteSegment(segmentId: string): Promise<string> {
  return withClient(async (client) => {
    const result = await client.query<Record<string, unknown>>(
      'update staff_time_entry_segments set deleted_at = now(), updated_at = now() where id = $1 returning deleted_at',
      [segmentId],
    )
    const deletedAt = toIso(result.rows[0]?.deleted_at)
    expect(deletedAt, 'the segment was soft-deleted').toBeTruthy()
    return deletedAt as string
  })
}

/** Strips `segmentsDeletedAt` from a stored action log, reproducing a pre-cascade log. */
async function stripRecordedInstantFromLog(logId: string): Promise<void> {
  await withClient(async (client) => {
    await client.query(
      "update action_logs set command_payload = jsonb_set(command_payload, '{undo}', (command_payload->'undo') - 'segmentsDeletedAt') where id = $1",
      [logId],
    )
  })
}

async function setupEntryWithTwoSegments(
  request: APIRequestContext,
  token: string,
  label: string,
  customerId: string,
): Promise<{ projectId: string; entryId: string; segmentA: string; segmentB: string }> {
  const staffMemberId = await getSelfStaffMemberId(request, token)
  await stopRunningTimers(request, token, staffMemberId)

  const projectId = await createTimeProjectFixture(request, token, { customerId, name: `QA ${label} ${Date.now()}` })
  // A failure past this point would never hand projectId or entryId back to the
  // test's `finally`, so setup releases what it created before rethrowing.
  let entryId: string | null = null
  try {
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
    entryId = ((await startRes.json()) as { id?: string }).id as string
    expect(entryId, 'start-timer returned a time entry id').toBeTruthy()

    const existing = await readSegments(entryId)
    expect(existing.size, 'the timer start opened one segment').toBe(1)
    const segmentA = [...existing.keys()][0]

    const addRes = await apiRequest(
      request,
      'POST',
      `/api/staff/timesheets/time-entries/${encodeURIComponent(entryId)}/segments`,
      {
        token,
        data: {
          startedAt: new Date(Date.now() - 3_600_000).toISOString(),
          endedAt: new Date(Date.now() - 1_800_000).toISOString(),
          segmentType: 'work',
        },
      },
    )
    expect(addRes.ok(), `adding a second segment should succeed: ${addRes.status()}`).toBeTruthy()
    const segmentB = ((await addRes.json()) as { id?: string }).id as string
    expect(segmentB, 'the segments API returned an id').toBeTruthy()

    return { projectId, entryId, segmentA, segmentB }
  } catch (error) {
    await cleanup(request, token, entryId, projectId, null)
    throw error
  }
}

async function cleanup(
  request: APIRequestContext,
  token: string | null,
  entryId: string | null,
  projectId: string | null,
  customer: TestCustomerFixture | null,
): Promise<void> {
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

test.describe('TC-STAFF-042: time entry delete/undo round-trips exactly the cascaded segments', () => {
  test('undo restores the cascaded segment and leaves an individually-deleted one deleted', async ({ request }) => {
    skipIfUndoTestsDisabled()

    let token: string | null = null
    let projectId: string | null = null
    let customer: TestCustomerFixture | null = null
    let entryId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      customer = await createTestCustomer(request, token)
      const fixture = await setupEntryWithTwoSegments(request, token, 'TC-STAFF-042 roundtrip', customer.id)
      projectId = fixture.projectId
      entryId = fixture.entryId
      const { segmentA, segmentB } = fixture

      await softDeleteSegment(segmentB)

      const afterSegmentDelete = await readSegments(entryId)
      expect(afterSegmentDelete.get(segmentA)?.deleted_at, 'segment A is still live').toBeNull()
      const segmentBDeletedAt = afterSegmentDelete.get(segmentB)?.deleted_at
      expect(segmentBDeletedAt, 'segment B is soft-deleted').not.toBeNull()

      const deleteRes = await apiRequest(
        request,
        'DELETE',
        `/api/staff/timesheets/time-entries?id=${encodeURIComponent(entryId)}`,
        { token },
      )
      expect(deleteRes.ok(), `deleting the entry should succeed: ${deleteRes.status()}`).toBeTruthy()
      const operation = expectOperation(deleteRes, 'staff.timesheets.time_entries.delete')

      const afterEntryDelete = await readSegments(entryId)
      expect(afterEntryDelete.get(segmentA)?.deleted_at, 'segment A cascaded with the entry').not.toBeNull()
      expect(
        afterEntryDelete.get(segmentB)?.deleted_at,
        'segment B keeps its own earlier delete timestamp',
      ).toBe(segmentBDeletedAt)

      await undoOk(request, token, operation.undoToken, 'staff.timesheets.time_entries.delete')

      expect(await readEntryDeletedAt(entryId), 'the entry is restored').toBeNull()

      const afterUndo = await readSegments(entryId)
      expect(afterUndo.get(segmentA)?.deleted_at, 'segment A is restored with the entry').toBeNull()
      expect(
        afterUndo.get(segmentB)?.deleted_at,
        'segment B stays deleted — the user deleted it deliberately, before the entry',
      ).not.toBeNull()
    } finally {
      await cleanup(request, token, entryId, projectId, customer)
    }
  })

  test('undo of a pre-cascade action log restores the entry and no segment', async ({ request }) => {
    skipIfUndoTestsDisabled()

    let token: string | null = null
    let projectId: string | null = null
    let customer: TestCustomerFixture | null = null
    let entryId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      customer = await createTestCustomer(request, token)
      const fixture = await setupEntryWithTwoSegments(request, token, 'TC-STAFF-042 legacy', customer.id)
      projectId = fixture.projectId
      entryId = fixture.entryId
      const { segmentA, segmentB } = fixture

      const deleteRes = await apiRequest(
        request,
        'DELETE',
        `/api/staff/timesheets/time-entries?id=${encodeURIComponent(entryId)}`,
        { token },
      )
      expect(deleteRes.ok(), `deleting the entry should succeed: ${deleteRes.status()}`).toBeTruthy()
      const operation = expectOperation(deleteRes, 'staff.timesheets.time_entries.delete')

      const cascaded = await readSegments(entryId)
      const cascadedA = cascaded.get(segmentA)?.deleted_at
      const cascadedB = cascaded.get(segmentB)?.deleted_at
      expect(cascadedA, 'segment A cascaded with the entry').not.toBeNull()
      expect(cascadedB, 'segment B cascaded with the entry').not.toBeNull()

      await stripRecordedInstantFromLog(operation.logId)

      await undoOk(request, token, operation.undoToken, 'staff.timesheets.time_entries.delete (legacy payload)')

      expect(await readEntryDeletedAt(entryId), 'the entry is still restored').toBeNull()

      const afterUndo = await readSegments(entryId)
      expect(
        afterUndo.get(segmentA)?.deleted_at,
        'segment A is untouched — a legacy payload restores no segment',
      ).toBe(cascadedA)
      expect(
        afterUndo.get(segmentB)?.deleted_at,
        'segment B is untouched — a legacy payload restores no segment',
      ).toBe(cascadedB)
    } finally {
      await cleanup(request, token, entryId, projectId, customer)
    }
  })
})
