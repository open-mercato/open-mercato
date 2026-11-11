import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import { withClient, type IntegrationDbClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import {
  assignEmployeeToProjectFixture,
  createTimeProjectFixture,
  deleteStaffEntityIfExists,
  getSelfStaffMemberId,
  startTimerFixture,
  stopRunningTimers,
} from '@open-mercato/core/helpers/integration/timesheetFixtures'
import {
  expectOperation,
  skipIfUndoTestsDisabled,
  undoByToken,
  type Operation,
} from '@open-mercato/core/helpers/integration/undoHarness'
import { createTestCustomer, type TestCustomerFixture } from './fixtures'

/**
 * TC-STAFF-050: two concurrent undos of two stopped timers leave exactly one timer
 * running.
 *
 * Undoing a stop reopens a timer, so it must respect the single-active-timer
 * invariant (#2855). That invariant belongs to the staff member, not to an entry:
 * undos of two DIFFERENT stopped entries lock different rows, and before the
 * member-scoped timer lock both could read "nothing else running" and both reopen.
 *
 * The interleaving is forced with a second database connection holding the two
 * stopped segments locked. Each undo reaches the point where it writes its segment
 * and queues there, observed in `pg_stat_activity`, so both have run (or, with the
 * member lock, one of them is still waiting to run) the running-timer re-check
 * before either commits. Releasing the segments then lets them finish: one wins and
 * the other is refused, which the shared undo endpoint reports as a failed undo.
 *
 * Endpoints:
 *   - POST /api/staff/timesheets/time-entries/start-timer
 *   - POST /api/staff/timesheets/time-entries/{id}/timer-stop
 *   - POST /api/audit_logs/audit-logs/actions/undo  { undoToken }
 */

type StoppedTimer = { entryId: string; segmentId: string; stop: Operation }

async function waitForLockWaiters(observer: IntegrationDbClient, blockerPid: number, count: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const result = await observer.query<{ pid: number; blockers: number[] }>(
      `select pid, pg_blocking_pids(pid) as blockers from pg_stat_activity where wait_event_type = 'Lock'`,
    )
    const blocked = new Set<number>([blockerPid])
    let grew = true
    while (grew) {
      grew = false
      for (const row of result.rows) {
        if (blocked.has(row.pid)) continue
        if ((row.blockers ?? []).some((pid) => blocked.has(Number(pid)))) {
          blocked.add(row.pid)
          grew = true
        }
      }
    }
    if (blocked.size - 1 >= count) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('[internal] The undo contenders never queued behind the held segment locks')
}

async function startAndStop(
  request: APIRequestContext,
  token: string,
  staffMemberId: string,
  projectId: string,
): Promise<StoppedTimer> {
  const entryId = await startTimerFixture(request, token, {
    staffMemberId,
    timeProjectId: projectId,
    date: new Date().toISOString().slice(0, 10),
  })
  const segmentId = await withClient(async (client) => {
    const result = await client.query<{ id: string }>(
      'select id from staff_time_entry_segments where time_entry_id = $1 and deleted_at is null and ended_at is null',
      [entryId],
    )
    return String(result.rows[0]?.id)
  })
  const stopResponse = await apiRequest(
    request,
    'POST',
    `/api/staff/timesheets/time-entries/${encodeURIComponent(entryId)}/timer-stop`,
    { token },
  )
  expect(stopResponse.ok(), `timer-stop should succeed: ${stopResponse.status()}`).toBeTruthy()
  return { entryId, segmentId, stop: expectOperation(stopResponse, 'staff.timesheets.time_entries.stop_timer') }
}

async function readRunningEntryIds(staffMemberId: string, candidateIds: string[]): Promise<string[]> {
  return withClient(async (client) => {
    const result = await client.query<{ id: string }>(
      `select id from staff_time_entries
        where staff_member_id = $1 and id = any($2::uuid[])
          and started_at is not null and ended_at is null and deleted_at is null`,
      [staffMemberId, candidateIds],
    )
    return result.rows.map((row) => String(row.id))
  })
}

test.describe('TC-STAFF-050: concurrent stop undos cannot reopen two timers for one member', () => {
  test('one undo wins and the other is refused', async ({ request }) => {
    skipIfUndoTestsDisabled()

    let token: string | null = null
    let staffMemberId: string | null = null
    let projectId: string | null = null
    let customer: TestCustomerFixture | null = null
    const entryIds: string[] = []

    try {
      token = await getAuthToken(request, 'admin')
      const authToken = token
      customer = await createTestCustomer(request, token)
      staffMemberId = await getSelfStaffMemberId(request, token)
      await stopRunningTimers(request, token, staffMemberId)
      projectId = await createTimeProjectFixture(request, token, {
        customerId: customer.id,
        name: `QA TC-STAFF-050 ${Date.now()}`,
      })
      await assignEmployeeToProjectFixture(request, token, projectId, staffMemberId)

      const first = await startAndStop(request, token, staffMemberId, projectId)
      entryIds.push(first.entryId)
      const second = await startAndStop(request, token, staffMemberId, projectId)
      entryIds.push(second.entryId)
      expect(await readRunningEntryIds(staffMemberId, entryIds), 'both timers start stopped').toEqual([])

      const statuses = await withClient(async (blocker) => withClient(async (observer) => {
        const blockerPid = Number((await blocker.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]?.pid)
        const pending: Array<Promise<number>> = []
        await blocker.query('begin')
        try {
          const locked = await blocker.query(
            'select id from staff_time_entry_segments where id = any($1::uuid[]) for update',
            [[first.segmentId, second.segmentId]],
          )
          expect(locked.rows, 'the blocker holds both stopped segments').toHaveLength(2)
          for (const timer of [first, second]) {
            pending.push(
              withCredentialIsolatedRequest((isolated) =>
                undoByToken(isolated, authToken, timer.stop.undoToken).then((response) => response.status()),
              ),
            )
          }
          await waitForLockWaiters(observer, blockerPid, 2)
          await blocker.query('commit')
          return await Promise.all(pending)
        } catch (error) {
          await blocker.query('rollback').catch(() => {})
          await Promise.allSettled(pending)
          throw error
        }
      }))

      expect(statuses.filter((status) => status === 200), `exactly one undo wins: ${statuses.join(', ')}`).toHaveLength(1)
      expect(statuses.filter((status) => status >= 400), `the other undo is refused: ${statuses.join(', ')}`).toHaveLength(1)
      expect(
        await readRunningEntryIds(staffMemberId, entryIds),
        'exactly one of the two timers is running again',
      ).toHaveLength(1)
    } finally {
      if (token && staffMemberId) await stopRunningTimers(request, token, staffMemberId)
      if (token) {
        for (const entryId of entryIds) {
          await apiRequest(request, 'DELETE', `/api/staff/timesheets/time-entries?id=${encodeURIComponent(entryId)}`, {
            token,
          }).catch(() => {})
        }
        await deleteStaffEntityIfExists(request, token, '/api/staff/timesheets/time-projects', projectId)
      }
      await customer?.cleanup()
    }
  })
})
