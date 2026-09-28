import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { expectId, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  dependsOnModules: ['hr_management'],
}

/**
 * TC-HR-001: the HR approval engine, end to end, over HTTP.
 *
 * The engine's value is entirely in what it does *across* entities: submitting a leave request creates
 * a request row, approving the final step flips the leave request to approved with a decision trail,
 * and the audit log records who decided what. The state machine is unit-tested in isolation, but no
 * unit test can prove that wiring — and until the screens and the URL fixes landed, none of it was
 * reachable at all.
 *
 * The fixture chain doubles as the module's entity-creation coverage: department → employee → workflow
 * → step → leave request, all through the public API.
 */

const DEPARTMENTS = '/api/hr_management/departments'
const EMPLOYEES = '/api/hr_management/employees'
const WORKFLOWS = '/api/hr_management/approval-workflows'
const STEPS = '/api/hr_management/approval-steps'
const LEAVE_REQUESTS = '/api/hr_management/leave-requests'
const APPROVAL_REQUESTS = '/api/hr_management/approval-requests'
const APPROVAL_LOGS = '/api/hr_management/approval-logs'
const SUBMIT = '/api/hr_management/approvals/submit'
const APPROVE = '/api/hr_management/approvals/approve'

type CreatedByApi = { id?: string | null; updatedAt?: string | null }
type ListResponse<T> = { items?: T[]; total?: number }

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
  const body = await readJsonSafe<CreatedByApi>(response)
  expect(response.ok(), `POST ${path} failed with ${response.status()}: ${JSON.stringify(body)}`).toBeTruthy()
  const id = body?.id
  expect(typeof id === 'string' && id.length > 0, `POST ${path} returned no id`).toBe(true)
  return id as string
}

/** Soft-deletes through the CRUD route, which resolves the id from the query string. */
async function deleteEntity(
  request: APIRequestContext,
  token: string,
  path: string,
  id: string,
): Promise<void> {
  try {
    await apiRequest(request, 'DELETE', `${path}?id=${encodeURIComponent(id)}`, { token })
  } catch {
    // A failed cleanup must not mask the assertion that failed first.
  }
}

test.describe('TC-HR-001: HR approvals', () => {
  test('a submitted leave request is approved, decided and logged end to end', async ({ request }) => {
    const token = await getAuthToken(request)
    const scope = getTokenScope(token)
    const suffix = uniqueSuffix()

    const created = {
      leaveRequestId: null as string | null,
      approvalRequestId: null as string | null,
      stepId: null as string | null,
      workflowId: null as string | null,
      employeeId: null as string | null,
      departmentId: null as string | null,
    }

    try {
      created.departmentId = await createEntity(request, token, DEPARTMENTS, {
        name: `TC HR 001 Department ${suffix}`,
        code: `TCHR001-${suffix}`,
        isActive: true,
      })

      created.employeeId = await createEntity(request, token, EMPLOYEES, {
        employeeNumber: `TCHR001-${suffix}`,
        firstName: 'TC',
        lastName: `HR001 ${suffix}`,
        nationalId: `10000000${suffix.slice(-4)}`,
        departmentId: created.departmentId,
        jobTitle: 'Driver',
        hireDate: '2026-01-05',
        status: 'active',
      })

      created.workflowId = await createEntity(request, token, WORKFLOWS, {
        name: `TC HR 001 Workflow ${suffix}`,
        code: `TCHR001WF-${suffix}`,
        entityType: 'hr_leave_request',
        isActive: true,
      })

      // A single final step that names the acting user, so the decision needs no role resolution.
      created.stepId = await createEntity(request, token, STEPS, {
        workflowId: created.workflowId,
        stepOrder: 1,
        name: 'Manager',
        approverType: 'user',
        approverUserId: scope.userId,
        requiredApprovals: 1,
        isFinal: true,
      })

      created.leaveRequestId = await createEntity(request, token, LEAVE_REQUESTS, {
        employeeId: created.employeeId,
        leaveType: 'annual',
        startDate: '2026-11-02',
        endDate: '2026-11-06',
        // Required by the create schema: the API takes the day count, not a range, and the form is
        // what computes it for an operator (an empty field in the form never leaves the browser).
        totalDays: 5,
        reason: 'TC HR 001 annual leave',
        status: 'pending',
      })
      const leaveRequestId = expectId(created.leaveRequestId, 'leave request create returned no id')

      const submitResponse = await apiRequest(request, 'POST', SUBMIT, {
        token,
        data: {
          workflowId: created.workflowId,
          entityType: 'hr_leave_request',
          entityId: leaveRequestId,
          summary: `TC HR 001 leave ${suffix}`,
        },
      })
      const submitted = await readJsonSafe<{ approvalRequestId?: string; status?: string; currentStepOrder?: number }>(submitResponse)
      expect(submitResponse.ok(), `approval submit failed with ${submitResponse.status()}`).toBeTruthy()
      const approvalRequestId = expectId(submitted?.approvalRequestId, 'submit returned no request id')
      created.approvalRequestId = approvalRequestId
      expect(submitted?.status).toBe('pending')
      expect(submitted?.currentStepOrder).toBe(1)

      // The entity lookup every approval entry point uses before offering to submit a second request.
      const pendingResponse = await apiRequest(
        request,
        'GET',
        `${APPROVAL_REQUESTS}?entityType=hr_leave_request&entityId=${encodeURIComponent(leaveRequestId)}&status=pending&pageSize=5`,
        { token },
      )
      const pending = await readJsonSafe<ListResponse<{ id?: string; current_step_order?: number }>>(pendingResponse)
      expect(pendingResponse.ok(), `approval lookup failed with ${pendingResponse.status()}`).toBeTruthy()
      expect(pending?.items?.length).toBe(1)
      expect(pending?.items?.[0]?.id).toBe(approvalRequestId)
      expect(pending?.items?.[0]?.current_step_order).toBe(1)

      const decisionComment = `TC HR 001 approved ${suffix}`
      const approveResponse = await apiRequest(request, 'POST', APPROVE, {
        token,
        data: { id: approvalRequestId, comment: decisionComment },
      })
      const approved = await readJsonSafe<{ status?: string }>(approveResponse)
      expect(approveResponse.ok(), `approval approve failed with ${approveResponse.status()}`).toBeTruthy()
      expect(approved?.status).toBe('approved')

      // The side effect on the entity the request is about, which is the point of the whole engine.
      const leaveResponse = await apiRequest(
        request,
        'GET',
        `${LEAVE_REQUESTS}?ids=${encodeURIComponent(leaveRequestId)}&pageSize=1`,
        { token },
      )
      const leave = await readJsonSafe<ListResponse<{
        status?: string
        decided_at?: string | null
        decision_comment?: string | null
      }>>(leaveResponse)
      const leaveItem = leave?.items?.[0]
      expect(leaveItem?.status).toBe('approved')
      expect(typeof leaveItem?.decided_at).toBe('string')
      expect(leaveItem?.decision_comment).toBe(decisionComment)

      // The audit trail: one row per decision, written by the engine and readable only since the
      // read-only log route landed.
      const logResponse = await apiRequest(
        request,
        'GET',
        `${APPROVAL_LOGS}?approvalRequestId=${encodeURIComponent(approvalRequestId)}&sortField=created_at&sortDir=asc&pageSize=50`,
        { token },
      )
      const logs = await readJsonSafe<ListResponse<{ action?: string; step_order?: number }>>(logResponse)
      expect(logResponse.ok(), `approval log read failed with ${logResponse.status()}`).toBeTruthy()
      expect((logs?.items ?? []).map((row) => row.action)).toContain('approved')
      expect(logs?.items?.[0]?.step_order).toBe(1)
    } finally {
      if (created.leaveRequestId) await deleteEntity(request, token, LEAVE_REQUESTS, created.leaveRequestId)
      if (created.approvalRequestId) await deleteEntity(request, token, APPROVAL_REQUESTS, created.approvalRequestId)
      if (created.stepId) await deleteEntity(request, token, STEPS, created.stepId)
      if (created.workflowId) await deleteEntity(request, token, WORKFLOWS, created.workflowId)
      if (created.employeeId) await deleteEntity(request, token, EMPLOYEES, created.employeeId)
      if (created.departmentId) await deleteEntity(request, token, DEPARTMENTS, created.departmentId)
    }
  })
})
