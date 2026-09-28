import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  dependsOnModules: ['hr_management'],
}

/**
 * TC-HR-004: a recorded lateness is excused through the approval engine.
 *
 * This is the only flow where approving something changes an attendance record, and it is the one the
 * list's row action and the record's own screen both start — so the assertions cover the two ends that
 * matter: the request is created against the *attendance* entity type (not a leave request), and
 * approving it clears the lateness. A workflow declared for leave requests must not appear in the
 * picker at all, which is what the `entityType` filter below guarantees.
 *
 * The fixtures are created here and removed in `finally`.
 */

const DEPARTMENTS = '/api/hr_management/departments'
const EMPLOYEES = '/api/hr_management/employees'
const ATTENDANCE = '/api/hr_management/attendance'
const WORKFLOWS = '/api/hr_management/approval-workflows'
const STEPS = '/api/hr_management/approval-steps'
const APPROVAL_REQUESTS = '/api/hr_management/approval-requests'
const APPROVAL_LOGS = '/api/hr_management/approval-logs'
const SUBMIT = '/api/hr_management/approvals/submit'
const APPROVE = '/api/hr_management/approvals/approve'

type ListResponse<T> = { items?: T[] }

let fixtureCounter = 0
function uniqueSuffix(): string {
  fixtureCounter += 1
  return `${Date.now()}-${fixtureCounter}`
}

async function createEntity(
  request: APIRequestContext,
  token: string,
  path: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequest(request, 'POST', path, { token, data })
  const body = await readJsonSafe<{ id?: string }>(response)
  expect(response.ok(), `POST ${path} failed with ${response.status()}: ${JSON.stringify(body)}`).toBeTruthy()
  const id = body?.id
  expect(typeof id === 'string' && id.length > 0, `POST ${path} returned no id`).toBe(true)
  return id as string
}

async function listIds(request: APIRequestContext, token: string, path: string): Promise<string[]> {
  const response = await apiRequest(request, 'GET', path, { token })
  const body = await readJsonSafe<ListResponse<{ id?: string }>>(response)
  expect(response.ok(), `GET ${path} failed with ${response.status()}`).toBeTruthy()
  return (body?.items ?? []).map((row) => row.id as string)
}

async function deleteEntity(request: APIRequestContext, token: string, path: string, id: string | null): Promise<void> {
  if (!id) return
  try {
    await apiRequest(request, 'DELETE', `${path}?id=${encodeURIComponent(id)}`, { token })
  } catch {
    // Cleanup must not mask the assertion that failed first.
  }
}

test.describe('TC-HR-004: lateness permission', () => {
  test('a permission is submitted against the attendance record and approving it clears the lateness', async ({ request }) => {
    const token = await getAuthToken(request)
    const scope = await readJsonSafe<{ userId?: string }>(await apiRequest(request, 'GET', '/api/auth/profile', { token }))
    const suffix = uniqueSuffix()

    const created = {
      departmentId: null as string | null,
      employeeId: null as string | null,
      attendanceId: null as string | null,
      attendanceWorkflowId: null as string | null,
      leaveWorkflowId: null as string | null,
      stepId: null as string | null,
      approvalRequestId: null as string | null,
    }

    try {
      created.departmentId = await createEntity(request, token, DEPARTMENTS, {
        name: `TC HR 004 Department ${suffix}`,
        code: `TCHR004-${suffix}`,
      })
      created.employeeId = await createEntity(request, token, EMPLOYEES, {
        employeeNumber: `TCHR004-${suffix}`,
        firstName: 'TC',
        lastName: `HR004 ${suffix}`,
        nationalId: `1200000${suffix.slice(-4)}`,
        jobTitle: 'Driver',
        hireDate: '2026-01-05',
        status: 'active',
        departmentId: created.departmentId,
      })

      created.attendanceWorkflowId = await createEntity(request, token, WORKFLOWS, {
        name: `TC HR 004 Attendance ${suffix}`,
        code: `TCHR004AW-${suffix}`,
        entityType: 'hr_attendance_record',
        isActive: true,
      })
      created.leaveWorkflowId = await createEntity(request, token, WORKFLOWS, {
        name: `TC HR 004 Leave ${suffix}`,
        code: `TCHR004LW-${suffix}`,
        entityType: 'hr_leave_request',
        isActive: true,
      })

      // The picker's own query: only active workflows declared for attendance records.
      const pickerIds = await listIds(request, token, `${WORKFLOWS}?isActive=true&entityType=hr_attendance_record&pageSize=100`)
      expect(pickerIds).toContain(created.attendanceWorkflowId)
      expect(pickerIds).not.toContain(created.leaveWorkflowId)

      created.stepId = await createEntity(request, token, STEPS, {
        workflowId: created.attendanceWorkflowId,
        stepOrder: 1,
        name: 'Manager',
        approverType: 'user',
        approverUserId: scope?.userId ?? '00000000-0000-4000-8000-000000000000',
        requiredApprovals: 1,
        isFinal: true,
      })

      created.attendanceId = await createEntity(request, token, ATTENDANCE, {
        employeeId: created.employeeId,
        date: '2026-09-20',
        status: 'late',
        checkInAt: '2026-09-20T09:45:00.000Z',
        notes: `TC HR 004 late ${suffix}`,
      })

      const pendingBefore = await listIds(
        request,
        token,
        `${APPROVAL_REQUESTS}?entityType=hr_attendance_record&entityId=${created.attendanceId}&status=pending&pageSize=5`,
      )
      expect(pendingBefore).toEqual([])

      const submitResponse = await apiRequest(request, 'POST', SUBMIT, {
        token,
        data: {
          workflowId: created.attendanceWorkflowId,
          entityType: 'hr_attendance_record',
          entityId: created.attendanceId,
        },
      })
      const submitted = await readJsonSafe<{ approvalRequestId?: string; status?: string }>(submitResponse)
      expect(submitResponse.ok(), `submit failed with ${submitResponse.status()}`).toBeTruthy()
      expect(submitted?.status).toBe('pending')
      created.approvalRequestId = expectId(submitted?.approvalRequestId, 'submit returned no request id')

      const approveResponse = await apiRequest(request, 'POST', APPROVE, {
        token,
        data: { id: created.approvalRequestId, comment: `TC HR 004 grant ${suffix}` },
      })
      expect(approveResponse.ok(), `approve failed with ${approveResponse.status()}`).toBeTruthy()

      const attendanceResponse = await apiRequest(
        request,
        'GET',
        `${ATTENDANCE}?ids=${encodeURIComponent(created.attendanceId)}&pageSize=1`,
        { token },
      )
      const attendance = await readJsonSafe<ListResponse<{ status?: string }>>(attendanceResponse)
      expect(attendance?.items?.[0]?.status).toBe('present')

      const logs = await listIds(
        request,
        token,
        `${APPROVAL_LOGS}?approvalRequestId=${encodeURIComponent(created.approvalRequestId)}&pageSize=50`,
      )
      expect(logs.length).toBeGreaterThan(0)
    } finally {
      await deleteEntity(request, token, ATTENDANCE, created.attendanceId)
      await deleteEntity(request, token, APPROVAL_REQUESTS, created.approvalRequestId)
      await deleteEntity(request, token, STEPS, created.stepId)
      await deleteEntity(request, token, WORKFLOWS, created.attendanceWorkflowId)
      await deleteEntity(request, token, WORKFLOWS, created.leaveWorkflowId)
      await deleteEntity(request, token, EMPLOYEES, created.employeeId)
      await deleteEntity(request, token, DEPARTMENTS, created.departmentId)
    }
  })
})
