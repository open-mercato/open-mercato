import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-STAFF-023: Time entries self-scope enforcement on GET
 *
 * Regression guard for the cross-employee leak documented in PR #1111 review #1.
 * Confirms that a caller without `staff.timesheets.manage_all` cannot read
 * another staff member's entries by passing `staffMemberId` in the query —
 * the staff/api/interceptors interceptor must rewrite the filter to the
 * caller's own staff member id.
 */
test.describe('TC-STAFF-023: Time entries self-scope enforcement', () => {
  test('non-manage_all callers cannot read other staff member entries via staffMemberId param', async ({ request }) => {
    const stamp = Date.now()
    const projectName = `QA SelfScope Project ${stamp}`
    const projectCode = `QASS-${stamp}`
    const entryDate = '2026-04-16'

    let adminToken: string | null = null
    let employeeToken: string | null = null
    let adminStaffMemberId: string | null = null
    let employeeStaffMemberId: string | null = null
    let projectId: string | null = null
    let entryId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')

      const adminSelf = await apiRequest(request, 'GET', '/api/staff/team-members/self', { token: adminToken })
      expect(adminSelf.ok(), 'GET /api/staff/team-members/self (admin) should succeed').toBeTruthy()
      const adminSelfBody = (await adminSelf.json()) as { member?: { id?: string } }
      adminStaffMemberId = adminSelfBody.member?.id ?? null
      expect(adminStaffMemberId, 'Admin should have a staff member linked').toBeTruthy()

      employeeToken = await getAuthToken(request, 'employee')

      const employeeSelf = await apiRequest(request, 'GET', '/api/staff/team-members/self', { token: employeeToken })
      expect(employeeSelf.ok(), 'GET /api/staff/team-members/self (employee) should succeed').toBeTruthy()
      const employeeSelfBody = (await employeeSelf.json()) as { member?: { id?: string } }
      employeeStaffMemberId = employeeSelfBody.member?.id ?? null
      expect(employeeStaffMemberId, 'Employee should have a staff member linked').toBeTruthy()
      expect(employeeStaffMemberId).not.toBe(adminStaffMemberId)

      const createProjectResponse = await apiRequest(request, 'POST', '/api/staff/timesheets/time-projects', {
        token: adminToken,
        data: { name: projectName, code: projectCode, projectType: 'internal', status: 'active' },
      })
      expect(createProjectResponse.ok(), 'POST /api/staff/timesheets/time-projects should succeed').toBeTruthy()
      const createProjectBody = (await createProjectResponse.json()) as { id?: string | null }

      if (typeof createProjectBody.id === 'string' && createProjectBody.id.length > 0) {
        projectId = createProjectBody.id
      } else {
        const listProjects = await apiRequest(
          request,
          'GET',
          '/api/staff/timesheets/time-projects?pageSize=100',
          { token: adminToken },
        )
        const listBody = (await listProjects.json()) as { items?: Array<Record<string, unknown>> }
        const match = listBody.items?.find((item) => item.name === projectName)
        projectId = (match?.id as string) ?? null
      }
      expect(projectId, 'Project id should be resolved').toBeTruthy()

      const assignAdmin = await apiRequest(request, 'POST', `/api/staff/timesheets/time-projects/${projectId}/employees`, {
        token: adminToken,
        data: { staffMemberId: adminStaffMemberId, status: 'active', assignedStartDate: entryDate },
      })
      expect(assignAdmin.ok(), 'Admin assignment should succeed').toBeTruthy()

      const createEntryResponse = await apiRequest(request, 'POST', '/api/staff/timesheets/time-entries', {
        token: adminToken,
        data: {
          staffMemberId: adminStaffMemberId,
          timeProjectId: projectId,
          date: entryDate,
          durationMinutes: 90,
          source: 'manual',
          notes: 'tc-staff-023 admin-owned entry',
        },
      })
      expect(createEntryResponse.status(), 'POST time-entry (admin) should return 201').toBe(201)
      const createEntryBody = (await createEntryResponse.json()) as { id?: string }
      entryId = createEntryBody.id ?? null
      expect(entryId, 'Created entry should expose its id').toBeTruthy()

      const leakAttempt = await apiRequest(
        request,
        'GET',
        `/api/staff/timesheets/time-entries?staffMemberId=${encodeURIComponent(adminStaffMemberId!)}&from=${entryDate}&to=${entryDate}&pageSize=50`,
        { token: employeeToken },
      )
      expect(leakAttempt.ok(), 'Employee GET should not be rejected outright').toBeTruthy()
      const leakBody = (await leakAttempt.json()) as { items?: Array<Record<string, unknown>> }
      const items = Array.isArray(leakBody.items) ? leakBody.items : []

      const leakedEntry = items.find((item) => item.id === entryId)
      expect(leakedEntry, 'Admin-owned entry must not leak through staffMemberId param').toBeUndefined()

      for (const item of items) {
        expect(
          item.staff_member_id,
          'Every returned entry must belong to the caller (interceptor self-scope)',
        ).toBe(employeeStaffMemberId)
      }
    } finally {
      if (adminToken && entryId) {
        await apiRequest(
          request,
          'DELETE',
          `/api/staff/timesheets/time-entries?id=${encodeURIComponent(entryId)}`,
          { token: adminToken },
        ).catch(() => {})
      }
      if (adminToken && projectId) {
        await apiRequest(
          request,
          'DELETE',
          `/api/staff/timesheets/time-projects?id=${encodeURIComponent(projectId)}`,
          { token: adminToken },
        ).catch(() => {})
      }
    }
  })
})
