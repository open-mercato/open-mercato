import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import {
  expectOperation,
  skipIfUndoTestsDisabled,
  undoByToken,
  undoOk,
  type Operation,
} from '@open-mercato/core/helpers/integration/undoHarness'

/**
 * TC-STAFF-LEAVE-UNDO-DECIDED: a decided (approved or rejected) leave request is final.
 * The submitter's create-undo and edit-undo are refused with 409 while the decision stands,
 * and succeed again once the deciding admin has undone the decision.
 *
 * Request A: employee creates -> admin approves -> employee create-undo is 409, the request
 * stays approved and its planner unavailability rules stay present -> admin undoes the approval
 * (rules removed) -> employee create-undo now succeeds and the request is gone.
 *
 * Request B: employee creates -> employee edits the note -> admin rejects -> employee edit-undo
 * is 409 and the rejection stays intact -> admin undoes the rejection -> employee edit-undo now
 * succeeds and the original note is restored.
 *
 * The employee's own staff profile is reused via GET /api/staff/team-members/self and never
 * created or deleted. Every request uses unique far-future dates.
 *
 * Endpoints:
 *   - GET /api/staff/team-members/self
 *   - POST/PUT/GET/DELETE /api/staff/leave-requests
 *   - POST /api/staff/leave-requests/accept, POST /api/staff/leave-requests/reject
 *   - planner_availability_rules rows are counted in Postgres (the planner list API is cached)
 *   - POST /api/audit_logs/audit-logs/actions/undo  { undoToken }
 */

const LEAVE_REQUESTS_API = '/api/staff/leave-requests'

type LeaveRequestRow = Record<string, unknown>

function uniqueFarFutureRange(): { startDate: string; endDate: string; dayKeys: string[] } {
  const year = 2200 + Math.floor(Math.random() * 700)
  const month = 1 + Math.floor(Math.random() * 12)
  const day = 1 + Math.floor(Math.random() * 26)
  const pad = (value: number) => String(value).padStart(2, '0')
  const startDate = `${year}-${pad(month)}-${pad(day)}`
  const endDate = `${year}-${pad(month)}-${pad(day + 1)}`
  const dayKeys = [`${year}${pad(month)}${pad(day)}`, `${year}${pad(month)}${pad(day + 1)}`]
  return { startDate, endDate, dayKeys }
}

async function resolveEmployeeMemberId(request: APIRequestContext, employeeToken: string): Promise<string> {
  const response = await apiRequest(request, 'GET', '/api/staff/team-members/self', { token: employeeToken })
  expect(response.status(), 'GET /api/staff/team-members/self should return 200').toBe(200)
  const body = await readJsonSafe<{ member?: { id?: string } | null }>(response)
  const memberId = body?.member?.id ?? ''
  expect(memberId.length > 0, 'Employee must have a staff member profile').toBeTruthy()
  return memberId
}

async function createLeaveRequest(
  request: APIRequestContext,
  employeeToken: string,
  memberId: string,
  range: { startDate: string; endDate: string },
  note: string,
): Promise<{ id: string; op: Operation }> {
  const response = await apiRequest(request, 'POST', LEAVE_REQUESTS_API, {
    token: employeeToken,
    data: { memberId, timezone: 'UTC', startDate: range.startDate, endDate: range.endDate, note },
  })
  expect(response.status(), 'employee create leave request should return 201').toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  const id = body?.id ?? ''
  expect(id.length > 0, 'leave request id returned').toBeTruthy()
  return { id, op: expectOperation(response, 'leave request create') }
}

async function decideLeaveRequest(
  request: APIRequestContext,
  adminToken: string,
  id: string,
  decision: 'accept' | 'reject',
  decisionComment: string,
): Promise<Operation> {
  const response = await apiRequest(request, 'POST', `${LEAVE_REQUESTS_API}/${decision}`, {
    token: adminToken,
    data: { id, decisionComment },
  })
  expect(response.status(), `admin ${decision} should return 200`).toBe(200)
  return expectOperation(response, `leave request ${decision}`)
}

async function findLeaveRequest(
  request: APIRequestContext,
  adminToken: string,
  id: string,
): Promise<LeaveRequestRow | undefined> {
  const response = await apiRequest(request, 'GET', `${LEAVE_REQUESTS_API}?ids=${encodeURIComponent(id)}`, {
    token: adminToken,
  })
  expect(response.status(), 'list leave requests should return 200').toBe(200)
  const body = await readJsonSafe<{ items?: LeaveRequestRow[] }>(response)
  return (body?.items ?? []).find((row) => row.id === id)
}

function decisionCommentOf(row: LeaveRequestRow | undefined): unknown {
  return row?.decision_comment ?? row?.decisionComment ?? null
}

async function countUnavailabilityRules(memberId: string, dayKeys: string[]): Promise<number> {
  const patterns = dayKeys.map((dayKey) => `%DTSTART:${dayKey}T000000Z%`)
  return withClient(async (client) => {
    const result = await client.query<{ count: string }>(
      `select count(*)::text as count
         from planner_availability_rules
        where subject_type = 'member'
          and subject_id = $1
          and kind = 'unavailability'
          and deleted_at is null
          and rrule like any($2::text[])`,
      [memberId, patterns],
    )
    return Number(result.rows[0]?.count ?? 0)
  })
}

async function expectUndoRefused(
  request: APIRequestContext,
  token: string,
  undoToken: string,
  context: string,
): Promise<void> {
  const response = await undoByToken(request, token, undoToken)
  const body = await readJsonSafe<{ error?: unknown; ok?: unknown }>(response)
  expect(response.status(), `${context} should be refused with 409, body ${JSON.stringify(body)}`).toBe(409)
  expect(typeof body?.error, `${context} should explain the refusal`).toBe('string')
  expect(body?.ok, `${context} must not report success`).not.toBe(true)
}

async function bestEffortUndo(request: APIRequestContext, token: string | null, op: Operation | null): Promise<void> {
  if (!token || !op) return
  try {
    await undoByToken(request, token, op.undoToken)
  } catch {
    return
  }
}

async function bestEffortDelete(request: APIRequestContext, token: string | null, id: string | null): Promise<void> {
  if (!token || !id) return
  try {
    await apiRequest(request, 'DELETE', `${LEAVE_REQUESTS_API}?id=${encodeURIComponent(id)}`, { token })
  } catch {
    return
  }
}

test.describe('TC-STAFF-LEAVE-UNDO-DECIDED: leave request undo is refused after a decision', () => {
  test.beforeEach(() => {
    skipIfUndoTestsDisabled()
  })

  test('create-undo of an approved request is refused until the approval is undone', async ({ request }) => {
    test.setTimeout(60_000)
    let adminToken: string | null = null
    let requestId: string | null = null
    let createOp: Operation | null = null
    let acceptOp: Operation | null = null
    let acceptUndone = false
    let createUndone = false
    try {
      const employeeToken = await getAuthToken(request, 'employee')
      adminToken = await getAuthToken(request, 'admin')
      const memberId = await resolveEmployeeMemberId(request, employeeToken)
      const range = uniqueFarFutureRange()

      const created = await createLeaveRequest(request, employeeToken, memberId, range, `QA undo decided A ${Date.now()}`)
      requestId = created.id
      createOp = created.op

      acceptOp = await decideLeaveRequest(request, adminToken, requestId, 'accept', 'QA approved')
      expect(await countUnavailabilityRules(memberId, range.dayKeys), 'approval created one rule per day').toBe(2)

      await expectUndoRefused(request, employeeToken, createOp.undoToken, 'employee create-undo after approval')

      const stillApproved = await findLeaveRequest(request, adminToken, requestId)
      expect(stillApproved, 'approved request is still listed').toBeTruthy()
      expect(stillApproved?.status).toBe('approved')
      expect(decisionCommentOf(stillApproved)).toBe('QA approved')
      expect(await countUnavailabilityRules(memberId, range.dayKeys), 'approval rules are still present after the refused undo').toBe(2)

      await undoOk(request, adminToken, acceptOp.undoToken, 'admin accept-undo')
      acceptUndone = true
      expect(await countUnavailabilityRules(memberId, range.dayKeys), 'accept-undo removed the approval rules').toBe(0)
      const reopened = await findLeaveRequest(request, adminToken, requestId)
      expect(reopened?.status, 'accept-undo reopened the request').toBe('pending')

      await undoOk(request, employeeToken, createOp.undoToken, 'employee create-undo after the approval was undone')
      createUndone = true
      expect(await findLeaveRequest(request, adminToken, requestId), 'request is gone after create-undo').toBeFalsy()
    } finally {
      if (!acceptUndone) await bestEffortUndo(request, adminToken, acceptOp)
      if (!createUndone) await bestEffortDelete(request, adminToken, requestId)
    }
  })

  test('edit-undo of a rejected request is refused until the rejection is undone', async ({ request }) => {
    test.setTimeout(60_000)
    let adminToken: string | null = null
    let employeeToken: string | null = null
    let requestId: string | null = null
    let editOp: Operation | null = null
    let rejectOp: Operation | null = null
    let rejectUndone = false
    let editUndone = false
    try {
      employeeToken = await getAuthToken(request, 'employee')
      adminToken = await getAuthToken(request, 'admin')
      const memberId = await resolveEmployeeMemberId(request, employeeToken)
      const range = uniqueFarFutureRange()
      const stamp = Date.now()
      const originalNote = `QA undo decided B original ${stamp}`
      const editedNote = `QA undo decided B edited ${stamp}`

      const created = await createLeaveRequest(request, employeeToken, memberId, range, originalNote)
      requestId = created.id

      const editResponse = await apiRequest(request, 'PUT', LEAVE_REQUESTS_API, {
        token: employeeToken,
        data: { id: requestId, note: editedNote },
      })
      expect(editResponse.status(), 'employee edit should return 200').toBe(200)
      editOp = expectOperation(editResponse, 'leave request update')

      rejectOp = await decideLeaveRequest(request, adminToken, requestId, 'reject', 'QA rejected')

      await expectUndoRefused(request, employeeToken, editOp.undoToken, 'employee edit-undo after rejection')

      const stillRejected = await findLeaveRequest(request, adminToken, requestId)
      expect(stillRejected, 'rejected request is still listed').toBeTruthy()
      expect(stillRejected?.status).toBe('rejected')
      expect(decisionCommentOf(stillRejected)).toBe('QA rejected')
      expect(stillRejected?.note, 'refused edit-undo did not restore the note').toBe(editedNote)

      await undoOk(request, adminToken, rejectOp.undoToken, 'admin reject-undo')
      rejectUndone = true

      await undoOk(request, employeeToken, editOp.undoToken, 'employee edit-undo after the rejection was undone')
      editUndone = true
      const restored = await findLeaveRequest(request, adminToken, requestId)
      expect(restored?.status, 'request is pending again').toBe('pending')
      expect(restored?.note, 'edit-undo restored the original note').toBe(originalNote)
    } finally {
      if (!rejectUndone) await bestEffortUndo(request, adminToken, rejectOp)
      if (!editUndone) await bestEffortUndo(request, employeeToken, editOp)
      await bestEffortDelete(request, adminToken, requestId)
    }
  })
})
