import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import { withClient, type IntegrationDbClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import {
  assignEmployeeToProjectFixture,
  createTimeProjectFixture,
  deleteStaffEntityIfExists,
  getSelfStaffMemberId,
  stopRunningTimers,
} from '@open-mercato/core/helpers/integration/timesheetFixtures'
import { expectOperation, skipIfUndoTestsDisabled, undoByToken } from '@open-mercato/core/helpers/integration/undoHarness'
import { createTestCustomer, type TestCustomerFixture } from './fixtures'

/**
 * TC-STAFF-049: a segment inserted concurrently with a cascade never outlives its
 * deleted parent.
 *
 * `POST /time-entries/{id}/segments` inserts under a PESSIMISTIC_WRITE lock on the
 * live parent entry. Every path that soft-deletes an entry and cascades to its
 * segments must take that same lock BEFORE reading the segment set, inside the
 * transaction that commits both deletions. Before that, the cascade read the set
 * first and only blocked on the parent row at flush time, so a segment committed in
 * between was absent from the set and stayed live under a deleted entry.
 *
 * The interleaving is forced with a second database connection that plays the
 * segment route's part: it locks the live parent row, the cascade request is sent
 * and observed waiting on that lock in `pg_stat_activity`, and only then does the
 * connection insert its segment and commit. Correct code reads the segment set after
 * the commit and cascades the new row; the old code had already read it.
 *
 * Paths: `DELETE /time-entries`, the weekly-grid bulk save zeroing a cell, and the
 * undo of a timer start.
 */

type SettledResponse = { status: number; ok: boolean; body: string }

/**
 * Reads the response inside its credential-isolated context: that context is
 * disposed as soon as the callback returns, and a disposed response has no body.
 */
async function settle(response: APIResponse): Promise<SettledResponse> {
  return { status: response.status(), ok: response.ok(), body: await response.text() }
}

type Fixture = { projectId: string; entryId: string; entryDate: string; scope: { tenantId: string; organizationId: string } }

function toIso(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString()
}

async function readSegmentDeletedAt(segmentId: string): Promise<string | null> {
  return withClient(async (client) => {
    const result = await client.query<Record<string, unknown>>(
      'select deleted_at from staff_time_entry_segments where id = $1',
      [segmentId],
    )
    return toIso(result.rows[0]?.deleted_at)
  })
}

async function readEntryDeletedAt(entryId: string): Promise<string | null> {
  return withClient(async (client) => {
    const result = await client.query<Record<string, unknown>>(
      'select deleted_at from staff_time_entries where id = $1',
      [entryId],
    )
    return toIso(result.rows[0]?.deleted_at)
  })
}

/**
 * Waits until `count` sessions are queued, directly or transitively, behind the
 * blocker's locks, so the request under test is provably parked inside the race
 * window rather than merely sent.
 */
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
  throw new Error('[internal] The cascade request never queued behind the parent-row lock')
}

/**
 * Holds the live parent locked, lets `send` reach the lock, inserts a segment the way
 * the segment route does, commits, and returns the cascade's response plus the new
 * segment id.
 */
async function raceSegmentInsertAgainst(
  fixture: Fixture,
  send: () => Promise<SettledResponse>,
): Promise<{ response: SettledResponse; insertedSegmentId: string }> {
  return withClient(async (blocker) => withClient(async (observer) => {
    const blockerPid = Number((await blocker.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]?.pid)
    const insertedSegmentId = randomUUID()
    let pending: Promise<SettledResponse> | null = null
    await blocker.query('begin')
    try {
      const locked = await blocker.query(
        'select id from staff_time_entries where id = $1 and deleted_at is null for update',
        [fixture.entryId],
      )
      expect(locked.rows, 'the blocker holds the live parent').toHaveLength(1)
      pending = send()
      await waitForLockWaiters(observer, blockerPid, 1)
      await blocker.query(
        `insert into staff_time_entry_segments
           (id, tenant_id, organization_id, time_entry_id, started_at, ended_at, segment_type, created_at, updated_at, deleted_at)
         values ($1, $2, $3, $4, now() - interval '20 minutes', now() - interval '10 minutes', 'work', now(), now(), null)`,
        [insertedSegmentId, fixture.scope.tenantId, fixture.scope.organizationId, fixture.entryId],
      )
      await blocker.query('commit')
      return { response: await pending, insertedSegmentId }
    } catch (error) {
      await blocker.query('rollback').catch(() => {})
      if (pending) await pending.catch(() => null)
      throw error
    }
  }))
}

async function startTimerEntry(
  request: APIRequestContext,
  token: string,
  label: string,
  customerId: string,
): Promise<Fixture & { startResponse: APIResponse }> {
  const staffMemberId = await getSelfStaffMemberId(request, token)
  await stopRunningTimers(request, token, staffMemberId)
  const projectId = await createTimeProjectFixture(request, token, { customerId, name: `QA ${label} ${Date.now()}` })
  try {
    await assignEmployeeToProjectFixture(request, token, projectId, staffMemberId)
    const entryDate = new Date().toISOString().slice(0, 10)
    const startResponse = await apiRequest(request, 'POST', '/api/staff/timesheets/time-entries/start-timer', {
      token,
      data: { staffMemberId, timeProjectId: projectId, date: entryDate, notes: null },
    })
    expect(startResponse.ok(), `start-timer should succeed: ${startResponse.status()}`).toBeTruthy()
    const entryId = ((await startResponse.json()) as { id?: string }).id as string
    expect(entryId, 'start-timer returned a time entry id').toBeTruthy()
    const scope = await withClient(async (client) => {
      const result = await client.query<{ tenant_id: string; organization_id: string }>(
        'select tenant_id, organization_id from staff_time_entries where id = $1',
        [entryId],
      )
      return { tenantId: String(result.rows[0]?.tenant_id), organizationId: String(result.rows[0]?.organization_id) }
    })
    return { projectId, entryId, entryDate, scope, startResponse }
  } catch (error) {
    await deleteStaffEntityIfExists(request, token, '/api/staff/timesheets/time-projects', projectId)
    throw error
  }
}

async function cleanup(
  request: APIRequestContext,
  token: string | null,
  fixture: Fixture | null,
  customer: TestCustomerFixture | null,
): Promise<void> {
  if (token && fixture) {
    await apiRequest(request, 'DELETE', `/api/staff/timesheets/time-entries?id=${encodeURIComponent(fixture.entryId)}`, {
      token,
    }).catch(() => {})
    await withClient(async (client) => {
      await client.query(
        'update staff_time_entry_segments set deleted_at = coalesce(deleted_at, now()) where time_entry_id = $1',
        [fixture.entryId],
      )
    }).catch(() => {})
    await deleteStaffEntityIfExists(request, token, '/api/staff/timesheets/time-projects', fixture.projectId)
  }
  await customer?.cleanup()
}

test.describe('TC-STAFF-049: a segment inserted during a cascade is cascaded with its parent', () => {
  test('DELETE /time-entries waits for the parent lock and cascades the segment committed meanwhile', async ({ request }) => {
    let token: string | null = null
    let customer: TestCustomerFixture | null = null
    let fixture: Fixture | null = null
    try {
      token = await getAuthToken(request, 'admin')
      customer = await createTestCustomer(request, token)
      fixture = await startTimerEntry(request, token, 'TC-STAFF-049 delete', customer.id)
      const authToken = token
      const target = fixture

      const { response, insertedSegmentId } = await raceSegmentInsertAgainst(target, () =>
        withCredentialIsolatedRequest((isolated) =>
          apiRequest(isolated, 'DELETE', `/api/staff/timesheets/time-entries?id=${encodeURIComponent(target.entryId)}`, {
            token: authToken,
            timeout: 20_000,
            retryTransport: false,
          }).then(settle),
        ),
      )

      expect(response.ok, `the delete should succeed: ${response.status} ${response.body}`).toBeTruthy()
      const entryDeletedAt = await readEntryDeletedAt(target.entryId)
      expect(entryDeletedAt, 'the entry is soft-deleted').not.toBeNull()
      expect(
        await readSegmentDeletedAt(insertedSegmentId),
        'the segment committed while the delete waited is cascaded on the same instant',
      ).toBe(entryDeletedAt)
    } finally {
      await cleanup(request, token, fixture, customer)
    }
  })

  test('the bulk save zeroing a cell waits for the parent lock and cascades the segment committed meanwhile', async ({ request }) => {
    let token: string | null = null
    let customer: TestCustomerFixture | null = null
    let fixture: Fixture | null = null
    try {
      token = await getAuthToken(request, 'admin')
      customer = await createTestCustomer(request, token)
      fixture = await startTimerEntry(request, token, 'TC-STAFF-049 bulk', customer.id)
      const authToken = token
      const target = fixture

      const { response, insertedSegmentId } = await raceSegmentInsertAgainst(target, () =>
        withCredentialIsolatedRequest((isolated) =>
          apiRequest(isolated, 'POST', '/api/staff/timesheets/time-entries/bulk', {
            token: authToken,
            data: {
              entries: [
                { id: target.entryId, date: target.entryDate, timeProjectId: target.projectId, durationMinutes: 0 },
              ],
            },
            timeout: 20_000,
            retryTransport: false,
          }).then(settle),
        ),
      )

      expect(response.ok, `the bulk save should succeed: ${response.status} ${response.body}`).toBeTruthy()
      const entryDeletedAt = await readEntryDeletedAt(target.entryId)
      expect(entryDeletedAt, 'the zeroed entry is soft-deleted').not.toBeNull()
      expect(
        await readSegmentDeletedAt(insertedSegmentId),
        'the segment committed while the bulk save waited is cascaded on the same instant',
      ).toBe(entryDeletedAt)
    } finally {
      await cleanup(request, token, fixture, customer)
    }
  })

  test('undoing a timer start waits for the parent lock and cascades the segment committed meanwhile', async ({ request }) => {
    skipIfUndoTestsDisabled()
    let token: string | null = null
    let customer: TestCustomerFixture | null = null
    let fixture: Fixture | null = null
    try {
      token = await getAuthToken(request, 'admin')
      customer = await createTestCustomer(request, token)
      const started = await startTimerEntry(request, token, 'TC-STAFF-049 undo', customer.id)
      fixture = started
      const operation = expectOperation(started.startResponse, 'staff.timesheets.time_entries.start_timer')
      const authToken = token

      const { response, insertedSegmentId } = await raceSegmentInsertAgainst(started, () =>
        withCredentialIsolatedRequest((isolated) => undoByToken(isolated, authToken, operation.undoToken).then(settle)),
      )

      expect(response.ok, `the undo should succeed: ${response.status} ${response.body}`).toBeTruthy()
      const entryDeletedAt = await readEntryDeletedAt(started.entryId)
      expect(entryDeletedAt, 'the undone timer entry is soft-deleted').not.toBeNull()
      expect(
        await readSegmentDeletedAt(insertedSegmentId),
        'the segment committed while the undo waited is cascaded on the same instant',
      ).toBe(entryDeletedAt)
    } finally {
      await cleanup(request, token, fixture, customer)
    }
  })
})
