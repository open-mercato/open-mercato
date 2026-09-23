import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  assignEmployeeToProjectFixture,
  createTimeProjectFixture,
  deleteStaffEntityIfExists,
  getSelfStaffMemberId,
  readTimesheetPreference,
  setTimesheetPreference,
} from '@open-mercato/core/helpers/integration/timesheetFixtures'
import { createTestCustomer, type TestCustomerFixture } from './fixtures'

/**
 * TC-STAFF-040: concurrent preference writes never surface a unique violation
 *
 * The preference row carries a *partial* unique index
 * (`WHERE deleted_at IS NULL`). A load-then-create upsert races on the first
 * write for a member: both requests miss on the read, both insert, and the index
 * turns the loser into a 500. Two timer starts fired from two tabs, or one
 * double-click, is enough — and the timer start itself has already succeeded by
 * then, so the failure is pure noise in the error budget.
 *
 * The write is therefore a single atomic statement whose conflict target repeats
 * the index predicate, because Postgres only infers a partial unique index when
 * the statement restates it. The SQL shape is pinned by
 * `lib/timesheets/__tests__/timesheetPreferenceService.test.ts`; this spec
 * exercises the real database, which is the only place the inference either
 * works or does not.
 *
 * API-level rather than browser-driven: two genuinely simultaneous writes are
 * not reliably orchestrated through a UI harness, and the endpoint is the unit
 * of concurrency here.
 */
test.describe('TC-STAFF-040: preference upsert survives concurrent writes', () => {
  test('should answer two simultaneous writes with 200s and one consistent row', async ({ request }) => {
    test.setTimeout(90_000)

    const stamp = Date.now()
    const adminToken = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')
    const staffMemberId = await getSelfStaffMemberId(request, employeeToken)

    const previousPreference = await readTimesheetPreference(request, employeeToken)
    let projectId: string | null = null
    let customer: TestCustomerFixture | null = null

    try {
      customer = await createTestCustomer(request, adminToken)
      projectId = await createTimeProjectFixture(request, adminToken, {
        customerId: customer.id,
        name: `QA Upsert Race ${stamp}`,
        code: `QUR-${stamp}`,
      })
      await assignEmployeeToProjectFixture(request, adminToken, projectId, staffMemberId)

      const writes = await Promise.all([
        setTimesheetPreference(request, employeeToken, projectId),
        setTimesheetPreference(request, employeeToken, projectId),
      ])

      // The regression gate: neither request may be the "loser" of a race.
      for (const [index, response] of writes.entries()) {
        expect(
          response.status(),
          `Concurrent write #${index + 1} must succeed, not raise a unique violation`,
        ).toBe(200)
      }

      const bodies = await Promise.all(writes.map((response) => response.json()))
      for (const body of bodies) {
        expect((body as { lastProjectId?: string }).lastProjectId).toBe(projectId)
      }

      // Exactly one row survives, and it holds the written value.
      const settled = await readTimesheetPreference(request, employeeToken)
      expect(settled.lastProjectId).toBe(projectId)
      expect(settled.updatedAt, 'A persisted preference must expose its version').toBeTruthy()

      // A second concurrent burst hits the DO UPDATE branch rather than the
      // insert branch, which is the other half of the statement.
      const updates = await Promise.all([
        setTimesheetPreference(request, employeeToken, null),
        setTimesheetPreference(request, employeeToken, null),
      ])
      for (const response of updates) {
        expect(response.status(), 'Concurrent updates must succeed too').toBe(200)
      }
      expect((await readTimesheetPreference(request, employeeToken)).lastProjectId).toBeNull()
    } finally {
      await setTimesheetPreference(request, employeeToken, previousPreference.lastProjectId).catch(() => {})
      await deleteStaffEntityIfExists(request, adminToken, '/api/staff/timesheets/time-projects', projectId)
      await customer?.cleanup()
    }
  })

  test('should reject a project the caller is not assigned to', async ({ request }) => {
    const stamp = Date.now()
    const adminToken = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')

    const previousPreference = await readTimesheetPreference(request, employeeToken)
    let projectId: string | null = null
    let customer: TestCustomerFixture | null = null

    try {
      // Created but deliberately never assigned: a buggy or hostile client must
      // not be able to park an arbitrary project in the member's row.
      customer = await createTestCustomer(request, adminToken)
      projectId = await createTimeProjectFixture(request, adminToken, {
        customerId: customer.id,
        name: `QA Unassigned Pref ${stamp}`,
        code: `QUP-${stamp}`,
      })

      const response = await setTimesheetPreference(request, employeeToken, projectId)
      expect(response.status(), 'An unassigned project must be rejected').toBe(400)
      expect((await readTimesheetPreference(request, employeeToken)).lastProjectId).not.toBe(projectId)
    } finally {
      await setTimesheetPreference(request, employeeToken, previousPreference.lastProjectId).catch(() => {})
      await deleteStaffEntityIfExists(request, adminToken, '/api/staff/timesheets/time-projects', projectId)
      await customer?.cleanup()
    }
  })

  test('should refuse an unauthenticated caller', async ({ request }) => {
    const response = await apiRequest(request, 'GET', '/api/staff/timesheets/my-preferences', { token: '' })
    expect([401, 403]).toContain(response.status())
  })
})
