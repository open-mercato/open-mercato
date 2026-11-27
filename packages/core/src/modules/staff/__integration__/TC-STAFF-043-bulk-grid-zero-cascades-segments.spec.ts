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

/**
 * TC-STAFF-043: the weekly-grid bulk save cascades the segment soft-delete when a
 * cell is zeroed, and only then.
 *
 * `POST /api/staff/timesheets/time-entries/bulk` treats `durationMinutes: 0` on an
 * existing entry as a delete. It is a distinct code path from the delete command
 * covered by TC-STAFF-042 — it never filters candidates by `source`, so a
 * timer-created entry that owns segments is eligible, and before the fix zeroing
 * such a cell orphaned them. The route runs inside `em.transactional` with a single
 * trailing flush, so the entry and its segments must land on one shared instant.
 *
 * The three properties pinned here:
 *   1. Zeroing cascades — every live segment is soft-deleted on the entry's exact
 *      `deleted_at`, and an open segment is closed at that same instant, so the
 *      entry leaves no segment reading as work still running.
 *   2. A non-zero save does NOT cascade — the update branch must leave segments
 *      completely untouched, otherwise editing a cell would silently destroy the
 *      timer detail behind it.
 *   3. An out-of-scope entry is rejected before the loop — the route's upfront
 *      validation is the only thing standing between a caller and another tenant's
 *      segments, so a foreign entry must 422 with its segments untouched.
 *
 * Segments are asserted directly in the database: the segments route resolves its
 * parent entry first and 404s once the entry is soft-deleted.
 *
 * Endpoints:
 *   - POST /api/staff/timesheets/time-entries/start-timer
 *   - POST /api/staff/timesheets/time-entries/{id}/segments
 *   - POST /api/staff/timesheets/time-entries/bulk
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

async function readEntry(timeEntryId: string): Promise<{ deleted_at: string | null; duration_minutes: number } | null> {
  return withClient(async (client) => {
    const result = await client.query<Record<string, unknown>>(
      'select deleted_at, duration_minutes from staff_time_entries where id = $1',
      [timeEntryId],
    )
    if (result.rows.length === 0) return null
    return {
      deleted_at: toIso(result.rows[0].deleted_at),
      duration_minutes: Number(result.rows[0].duration_minutes),
    }
  })
}

async function countOpenSegments(timeEntryId: string): Promise<number> {
  return withClient(async (client) => {
    const result = await client.query<Record<string, unknown>>(
      'select count(*)::int as open_count from staff_time_entry_segments where time_entry_id = $1 and ended_at is null',
      [timeEntryId],
    )
    return Number(result.rows[0]?.open_count ?? 0)
  })
}

async function setEntryTenant(timeEntryId: string, tenantId: string): Promise<void> {
  await withClient(async (client) => {
    await client.query('update staff_time_entries set tenant_id = $2 where id = $1', [timeEntryId, tenantId])
  })
}

async function readEntryTenant(timeEntryId: string): Promise<string> {
  return withClient(async (client) => {
    const result = await client.query<Record<string, unknown>>(
      'select tenant_id from staff_time_entries where id = $1',
      [timeEntryId],
    )
    return String(result.rows[0]?.tenant_id)
  })
}

type Fixture = {
  projectId: string
  entryId: string
  entryDate: string
  segmentA: string
  segmentB: string
  segmentBEndedAt: string | null
}

async function setupEntryWithTwoSegments(
  request: APIRequestContext,
  token: string,
  label: string,
  customerId: string,
): Promise<Fixture> {
  const staffMemberId = await getSelfStaffMemberId(request, token)
  await stopRunningTimers(request, token, staffMemberId)

  const projectId = await createTimeProjectFixture(request, token, { customerId, name: `QA ${label} ${Date.now()}` })
  // A failure past this point would never hand projectId or entryId back to the
  // test's `finally`, so setup releases what it created before rethrowing.
  let entryId: string | null = null
  try {
    await assignEmployeeToProjectFixture(request, token, projectId, staffMemberId)

    const entryDate = new Date().toISOString().slice(0, 10)
    const startRes = await apiRequest(request, 'POST', '/api/staff/timesheets/time-entries/start-timer', {
      token,
      data: { staffMemberId, timeProjectId: projectId, date: entryDate, notes: null },
    })
    expect(startRes.ok(), `start-timer should succeed: ${startRes.status()}`).toBeTruthy()
    entryId = ((await startRes.json()) as { id?: string }).id as string
    expect(entryId, 'start-timer returned a time entry id').toBeTruthy()

    const opened = await readSegments(entryId)
    expect(opened.size, 'the timer start opened one segment').toBe(1)
    const segmentA = [...opened.keys()][0]
    expect(opened.get(segmentA)?.ended_at, 'the timer segment is still open').toBeNull()

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

    const both = await readSegments(entryId)
    expect(both.size, 'the entry now owns two segments').toBe(2)

    return { projectId, entryId, entryDate, segmentA, segmentB, segmentBEndedAt: both.get(segmentB)?.ended_at ?? null }
  } catch (error) {
    await cleanup(request, token, entryId, projectId, null)
    throw error
  }
}

async function bulkSave(
  request: APIRequestContext,
  token: string,
  entry: { id: string; date: string; timeProjectId: string; durationMinutes: number },
) {
  return apiRequest(request, 'POST', '/api/staff/timesheets/time-entries/bulk', {
    token,
    data: { entries: [entry] },
  })
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

test.describe('TC-STAFF-043: the weekly-grid bulk save cascades the segment soft-delete', () => {
  test('zeroing a grid cell soft-deletes the entry and every segment on one shared instant', async ({ request }) => {
    let token: string | null = null
    let projectId: string | null = null
    let customer: TestCustomerFixture | null = null
    let entryId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      customer = await createTestCustomer(request, token)
      const fixture = await setupEntryWithTwoSegments(request, token, 'TC-STAFF-043 cascade', customer.id)
      projectId = fixture.projectId
      entryId = fixture.entryId
      const { segmentA, segmentB } = fixture

      const res = await bulkSave(request, token, {
        id: entryId,
        date: fixture.entryDate,
        timeProjectId: projectId,
        durationMinutes: 0,
      })
      expect(res.ok(), `the bulk save should succeed: ${res.status()} ${await res.text()}`).toBeTruthy()
      const payload = (await res.json()) as { deleted?: number }
      expect(payload.deleted, 'the bulk save reports one deletion').toBe(1)

      const entry = await readEntry(entryId)
      expect(entry?.deleted_at, 'the entry is soft-deleted').not.toBeNull()
      const entryDeletedAt = entry?.deleted_at as string

      const segments = await readSegments(entryId)
      expect(
        segments.get(segmentA)?.deleted_at,
        'the timer segment cascaded on the entry’s exact delete instant',
      ).toBe(entryDeletedAt)
      expect(
        segments.get(segmentB)?.deleted_at,
        'the manually added segment cascaded on the same instant',
      ).toBe(entryDeletedAt)

      expect(
        segments.get(segmentA)?.ended_at,
        'the open timer segment was closed at the delete instant',
      ).toBe(entryDeletedAt)
      expect(
        segments.get(segmentB)?.ended_at,
        'the already-closed segment keeps its own end',
      ).toBe(fixture.segmentBEndedAt)

      expect(await countOpenSegments(entryId), 'no segment is left reading as still running').toBe(0)
    } finally {
      await cleanup(request, token, entryId, projectId, customer)
    }
  })

  test('a non-zero bulk save updates the entry and leaves its segments untouched', async ({ request }) => {
    let token: string | null = null
    let projectId: string | null = null
    let customer: TestCustomerFixture | null = null
    let entryId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      customer = await createTestCustomer(request, token)
      const fixture = await setupEntryWithTwoSegments(request, token, 'TC-STAFF-043 no cascade', customer.id)
      projectId = fixture.projectId
      entryId = fixture.entryId
      const { segmentA, segmentB } = fixture

      const before = await readSegments(entryId)

      const res = await bulkSave(request, token, {
        id: entryId,
        date: fixture.entryDate,
        timeProjectId: projectId,
        durationMinutes: 90,
      })
      expect(res.ok(), `the bulk save should succeed: ${res.status()} ${await res.text()}`).toBeTruthy()
      const payload = (await res.json()) as { updated?: number; deleted?: number }
      expect(payload.updated, 'the bulk save reports one update').toBe(1)
      expect(payload.deleted ?? 0, 'the bulk save deletes nothing').toBe(0)

      const entry = await readEntry(entryId)
      expect(entry?.deleted_at, 'the entry is still live').toBeNull()
      expect(entry?.duration_minutes, 'the entry took the new duration').toBe(90)

      const after = await readSegments(entryId)
      expect(after.size, 'the segment set is unchanged').toBe(before.size)
      expect(after.get(segmentA)?.deleted_at, 'the timer segment is untouched').toBeNull()
      expect(after.get(segmentB)?.deleted_at, 'the added segment is untouched').toBeNull()
      expect(after.get(segmentA)?.ended_at, 'the open timer segment stays open').toBeNull()
      expect(after.get(segmentB)?.ended_at, 'the closed segment keeps its end').toBe(fixture.segmentBEndedAt)
    } finally {
      await cleanup(request, token, entryId, projectId, customer)
    }
  })

  test('an out-of-tenant entry is rejected and its segments are untouched', async ({ request }) => {
    let token: string | null = null
    let projectId: string | null = null
    let customer: TestCustomerFixture | null = null
    let entryId: string | null = null
    let originalTenantId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      customer = await createTestCustomer(request, token)
      const fixture = await setupEntryWithTwoSegments(request, token, 'TC-STAFF-043 cross tenant', customer.id)
      projectId = fixture.projectId
      entryId = fixture.entryId
      const { segmentA, segmentB } = fixture

      const before = await readSegments(entryId)
      originalTenantId = await readEntryTenant(entryId)
      // Re-stamps the entry into a tenant the caller has no claim on. The columns
      // carry no FK, so this reproduces a foreign row without standing up a second
      // tenant — and it is the entry's tenant, not the caller's, that the route's
      // upfront lookup filters on.
      await setEntryTenant(entryId, '00000000-0000-4000-8000-0000000043aa')

      const res = await bulkSave(request, token, {
        id: entryId,
        date: fixture.entryDate,
        timeProjectId: projectId,
        durationMinutes: 0,
      })
      expect(res.status(), 'a foreign entry is rejected before the delete branch runs').toBe(422)
      const body = (await res.json()) as { ok?: boolean; errors?: Array<{ path?: string; value?: string }> }
      expect(body.ok, 'the response reports failure').toBe(false)
      expect(
        body.errors?.some((issue) => issue.value === entryId),
        'the rejected id is named in the errors',
      ).toBe(true)

      const entry = await readEntry(entryId)
      expect(entry?.deleted_at, 'the foreign entry was not soft-deleted').toBeNull()

      const after = await readSegments(entryId)
      expect(after.get(segmentA)?.deleted_at, 'the foreign entry’s timer segment is untouched').toBe(
        before.get(segmentA)?.deleted_at ?? null,
      )
      expect(after.get(segmentB)?.deleted_at, 'the foreign entry’s added segment is untouched').toBe(
        before.get(segmentB)?.deleted_at ?? null,
      )
      expect(await countOpenSegments(entryId), 'the open segment stayed open').toBe(1)
    } finally {
      if (entryId && originalTenantId) await setEntryTenant(entryId, originalTenantId).catch(() => {})
      await cleanup(request, token, entryId, projectId, customer)
    }
  })
})
