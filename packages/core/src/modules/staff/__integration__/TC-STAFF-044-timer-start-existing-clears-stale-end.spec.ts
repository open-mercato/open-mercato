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
 * TC-STAFF-044: starting the timer on an existing entry must clear any end the
 * entry already carried.
 *
 * `startTimerExistingCommand.execute` set `startedAt` and `source` but left
 * `endedAt` untouched, so an entry could end up with `ended_at < started_at`.
 * The reachable route in is a manual create: `staffTimeEntryCreateSchema` accepts
 * `startedAt` and `endedAt` as independent optional fields with no cross-field
 * refinement, so an entry can record an end while its start is still null. A
 * later `timer-start` then gave it a start and a fresh segment while the stale
 * end stayed put.
 *
 * Three consequences, all asserted below:
 *   1. the entry drops out of the running-timer lookup, which reads the pair as
 *      `started_at IS NOT NULL AND ended_at IS NULL` — so the user's own timer is
 *      invisible to the timer bar;
 *   2. the single-active-timer guard reads the same pair, so a second timer can
 *      be started alongside the hidden one;
 *   3. the command's own undo becomes permanently impossible, because it treats a
 *      present `endedAt` as proof that a stop landed after the start.
 *
 * Step 04 goes through the real `?running=true` HTTP route rather than
 * `buildTimeEntryListFilters`, which is the assertion that did not exist anywhere
 * before this spec: it catches route-level regressions (interceptors, enrichers,
 * scoping) that a filter-builder unit test cannot see.
 *
 * Endpoints:
 *   - POST /api/staff/timesheets/time-entries                  (create with endedAt, no startedAt)
 *   - POST /api/staff/timesheets/time-entries/{id}/timer-start
 *   - GET  /api/staff/timesheets/time-entries?running=true
 *   - POST /api/audit_logs/audit-logs/actions/undo
 */

type EntryTimes = {
  started_at: string | null
  ended_at: string | null
  source: string | null
}

/**
 * `pg` returns `timestamptz` as a Date, so raw rows compared with `toBe` fail on
 * identity even when the instants are equal. Normalizing to ISO strings keeps the
 * timestamp assertions meaningful instead of accidentally always-failing.
 */
function toIso(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString()
}

/**
 * Read straight from the table. The list route projects the entry through the
 * query engine, and the whole point of consequence 1 is that a bad row is missing
 * from those results — so the API cannot be the source of truth for the pair.
 */
async function readEntryTimes(timeEntryId: string): Promise<EntryTimes | undefined> {
  return withClient(async (client) => {
    const result = await client.query<Record<string, unknown>>(
      'select started_at, ended_at, source from staff_time_entries where id = $1',
      [timeEntryId],
    )
    if (result.rows.length === 0) return undefined
    return {
      started_at: toIso(result.rows[0].started_at),
      ended_at: toIso(result.rows[0].ended_at),
      source: result.rows[0].source === null ? null : String(result.rows[0].source),
    }
  })
}

async function listRunningEntryIds(
  request: APIRequestContext,
  token: string,
  staffMemberId: string,
): Promise<string[]> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/staff/timesheets/time-entries?staffMemberId=${encodeURIComponent(staffMemberId)}&running=true&pageSize=50`,
    { token },
  )
  expect(response.ok(), `GET ...?running=true should succeed: ${response.status()}`).toBeTruthy()
  const body = (await response.json()) as { items?: Array<{ id?: string }> }
  return (body.items ?? []).map((item) => String(item.id ?? ''))
}

async function createEntryEndedWithoutStart(
  request: APIRequestContext,
  token: string,
  input: { staffMemberId: string; timeProjectId: string; date: string; endedAt: string },
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/staff/timesheets/time-entries', {
    token,
    data: {
      staffMemberId: input.staffMemberId,
      timeProjectId: input.timeProjectId,
      date: input.date,
      durationMinutes: 45,
      endedAt: input.endedAt,
      source: 'manual',
    },
  })
  expect(response.ok(), `create with endedAt and no startedAt should succeed: ${response.status()}`).toBeTruthy()
  const body = (await response.json()) as { id?: string }
  expect(typeof body.id === 'string' && body.id.length > 0, 'create returned a time entry id').toBeTruthy()
  return body.id as string
}

test.describe('TC-STAFF-044: timer-start on an existing entry clears a stale end', () => {
  test('starting the timer clears the end, exposes the entry as running, and stays undoable', async ({ request }) => {
    skipIfUndoTestsDisabled()

    let token: string | null = null
    let projectId: string | null = null
    let customer: TestCustomerFixture | null = null
    let entryId: string | null = null
    let secondEntryId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      const staffMemberId = await getSelfStaffMemberId(request, token)
      await stopRunningTimers(request, token, staffMemberId)

      customer = await createTestCustomer(request, token)
      projectId = await createTimeProjectFixture(request, token, { customerId: customer.id, name: `QA TC-STAFF-044 ${Date.now()}` })
      await assignEmployeeToProjectFixture(request, token, projectId, staffMemberId)

      // Six hours back, so the stale end is unambiguously older than the start the
      // timer is about to stamp. Captured once so the undo can assert it came back.
      const staleEndedAt = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
      const date = new Date().toISOString().slice(0, 10)

      // 02 — the precondition IS the reachable route into the defect, so pin it
      // rather than assume the validator still permits the shape.
      entryId = await createEntryEndedWithoutStart(request, token, {
        staffMemberId,
        timeProjectId: projectId,
        date,
        endedAt: staleEndedAt,
      })

      const beforeStart = await readEntryTimes(entryId)
      expect(beforeStart?.started_at, 'the entry carries no start before the timer runs').toBeNull()
      expect(beforeStart?.ended_at, 'the entry carries an end before the timer runs').toBe(staleEndedAt)

      // 03 — the fix itself.
      const startRes = await apiRequest(
        request,
        'POST',
        `/api/staff/timesheets/time-entries/${encodeURIComponent(entryId)}/timer-start`,
        { token, data: {} },
      )
      expect(startRes.ok(), `timer-start should succeed: ${startRes.status()}`).toBeTruthy()
      const operation = expectOperation(startRes, 'staff.timesheets.time_entries.start_timer_existing')

      // 04 — through the real route, not the filter builder. Asserted BEFORE the
      // raw column read on purpose: this is the assertion that exists nowhere
      // else, so it is the one that should trip first when the fix regresses.
      expect(
        await listRunningEntryIds(request, token, staffMemberId),
        'the started entry is visible to the live running-timer lookup',
      ).toContain(entryId)

      const afterStart = await readEntryTimes(entryId)
      expect(afterStart?.started_at, 'the timer stamped a start').not.toBeNull()
      expect(afterStart?.ended_at, 'the stale end is cleared by the start').toBeNull()

      // 05 — the invariant the backfill migration exists to repair. Vacuous once
      // the end is null, but it is exactly what fails before the fix, where both
      // are non-null and out of order.
      if (afterStart?.started_at && afterStart.ended_at) {
        expect(
          Date.parse(afterStart.ended_at) >= Date.parse(afterStart.started_at),
          `ended_at ${afterStart.ended_at} must not precede started_at ${afterStart.started_at}`,
        ).toBeTruthy()
      }

      // 07 — the single-active-timer guard reads the same pair, so a stale end
      // would have hidden this entry from it and let a second timer start.
      secondEntryId = await createEntryEndedWithoutStart(request, token, {
        staffMemberId,
        timeProjectId: projectId,
        date,
        endedAt: staleEndedAt,
      })
      const secondStartRes = await apiRequest(
        request,
        'POST',
        `/api/staff/timesheets/time-entries/${encodeURIComponent(secondEntryId)}/timer-start`,
        { token, data: {} },
      )
      expect(
        secondStartRes.status(),
        'a second concurrent timer is rejected while the first is running',
      ).toBe(409)

      // 06 — undo. Pre-fix the guard read the stale end as a completed stop and
      // rejected this with 409 timerAlreadyStopped, permanently.
      await undoOk(request, token, operation.undoToken, 'staff.timesheets.time_entries.start_timer_existing')

      const afterUndo = await readEntryTimes(entryId)
      expect(afterUndo?.started_at, 'undo clears the start it stamped').toBeNull()
      expect(afterUndo?.ended_at, 'undo restores the end the entry carried before').toBe(staleEndedAt)
      expect(afterUndo?.source, 'undo restores the pre-timer source').toBe('manual')

      expect(
        await listRunningEntryIds(request, token, staffMemberId),
        'the undone entry is no longer reported as running',
      ).not.toContain(entryId)
    } finally {
      if (token) {
        for (const id of [entryId, secondEntryId]) {
          if (!id) continue
          await apiRequest(request, 'DELETE', `/api/staff/timesheets/time-entries?id=${encodeURIComponent(id)}`, {
            token,
          }).catch(() => {})
        }
      }
      if (token && projectId) {
        await deleteStaffEntityIfExists(request, token, '/api/staff/timesheets/time-projects', projectId)
      }
      await customer?.cleanup()
    }
  })
})
