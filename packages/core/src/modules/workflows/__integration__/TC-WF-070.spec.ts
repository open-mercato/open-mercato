import { expect, test, type APIRequestContext } from '@playwright/test'
import { randomInt } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createCustomerCompanyFixture,
  createCustomerRoleFixture,
  createCustomerUserFixture,
  deleteCustomerCompanyFixture,
  deleteCustomerRoleFixture,
  deleteCustomerUserFixture,
  portalCookieHeaders,
  portalLogin,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import {
  dismissNotificationIfExists,
  listNotifications,
} from '@open-mercato/core/helpers/integration/notificationsFixtures'
import {
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  findInstanceUserTask,
  startWorkflowInstanceFixture,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'

/**
 * TC-WF-070 [P0]: task completion guards veto, allow and fail closed on every
 * completion surface (issue #7178).
 *
 * Spec `.ai/specs/2026-10-11-workflows-task-completion-guards.md`.
 *
 * Surfaces under test:
 * - GET  /api/workflows/tasks/[id]                 (canComplete · actBlockedReason · completionGuard)
 * - POST /api/workflows/tasks/[id]/complete
 * - GET  /api/workflows/portal/tasks/[id]          (canComplete · completionGuard)
 * - POST /api/workflows/portal/tasks/[id]/complete
 * - POST /api/notifications/[id]/action            (`complete` → command `workflows.tasks.complete`)
 * - /backend/tasks/[id]                            (the guard notice and the Reassign control)
 *
 * The guards are the test-only fixture in `apps/mercato/src/modules/example/workflows.ts`,
 * registered only under `OM_INTEGRATION_TEST=true` and selected by a `formKey` that
 * only this spec authors, so no other task in the shared database is affected:
 * `veto` refuses with its own code and message key, `pass` allows, `throw` throws
 * and MUST fail closed as `COMPLETION_GUARD_FAILED` without leaking its message.
 *
 * Every definition authors NO form fields and a single route, so the task is
 * one-click and its assignment notification carries the `complete` quick action.
 */

type GuardCase = 'veto' | 'pass' | 'throw'

const FORM_KEYS: Record<GuardCase, string> = {
  veto: 'example.tc_wf_070.veto',
  pass: 'example.tc_wf_070.pass',
  throw: 'example.tc_wf_070.throw',
}

const VETO_BODY = {
  error: 'The example precondition is not met',
  code: 'EXAMPLE_PRECONDITION_NOT_MET',
  guardId: 'example.tc_wf_070.veto',
  messageKey: 'example.workflows.completionGuard.vetoed',
}

const FAILED_BODY = {
  error: 'Task completion is blocked by a precondition',
  code: 'COMPLETION_GUARD_FAILED',
  guardId: 'example.tc_wf_070.throw',
  messageKey: null,
}

const THROWN_MESSAGE = 'example completion guard failure'

const PORTAL_TASK_FEATURES = ['portal.tasks.view', 'portal.tasks.complete']

type Assignee = { kind: 'user'; userId: string } | { kind: 'customer' }

function buildGuardedTaskDefinition(stamp: string, guardCase: GuardCase, surface: string, assignee: Assignee) {
  const workflowId = `qa-wf-070-${surface}-${guardCase}-${stamp}`
  return {
    workflowId,
    workflowName: `QA TC-WF-070 ${surface} ${guardCase} ${stamp}`,
    description: `Integration test definition ${workflowId}`,
    version: 1,
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        {
          stepId: 'review',
          stepName: `Guarded review ${guardCase}`,
          stepType: 'USER_TASK',
          userTaskConfig:
            assignee.kind === 'user'
              ? { assignedTo: assignee.userId, formKey: FORM_KEYS[guardCase] }
              : {
                  assigneeKind: 'customer',
                  assignedTo: '{{context.portalUserId}}',
                  entityBindings: [{ entityType: 'customers:company', idPath: 'context.companyId' }],
                  formKey: FORM_KEYS[guardCase],
                },
        },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: [
        { transitionId: 'start-to-review', fromStepId: 'start', toStepId: 'review', trigger: 'auto' },
        { transitionId: 'review-to-end', fromStepId: 'review', toStepId: 'end', trigger: 'auto' },
      ],
    },
    enabled: true,
  }
}

type Cleanup = { definitionIds: string[]; instanceIds: string[] }

async function startGuardedTask(
  request: APIRequestContext,
  token: string,
  cleanup: Cleanup,
  payload: ReturnType<typeof buildGuardedTaskDefinition>,
  initialContext: Record<string, unknown>,
): Promise<string> {
  cleanup.definitionIds.push(await createWorkflowDefinitionFixture(request, token, payload))
  const instanceId = await startWorkflowInstanceFixture(request, token, {
    workflowId: payload.workflowId,
    initialContext,
  })
  cleanup.instanceIds.push(instanceId)
  const task = await findInstanceUserTask(request, token, instanceId, { statuses: ['PENDING'] })
  expect(task?.id, `the ${payload.workflowId} USER_TASK step creates a PENDING task`).toBeTruthy()
  return task!.id!
}

async function cleanUp(request: APIRequestContext, token: string, cleanup: Cleanup): Promise<void> {
  for (const instanceId of cleanup.instanceIds) {
    await cancelWorkflowInstanceIfExists(request, token, instanceId)
  }
  for (const definitionId of cleanup.definitionIds) {
    await deleteWorkflowDefinitionIfExists(request, token, definitionId)
  }
}

type BackofficeTaskDetail = {
  status?: string
  canComplete?: boolean
  canReassign?: boolean
  actBlockedReason?: string | null
  completionGuard?: { guardId?: string; code?: string; messageKey?: string | null } | null
}

async function readBackofficeDetail(
  request: APIRequestContext,
  token: string,
  taskId: string,
): Promise<BackofficeTaskDetail> {
  const response = await apiRequest(request, 'GET', `/api/workflows/tasks/${encodeURIComponent(taskId)}`, { token })
  expect(response.status(), 'the assignee reads the task detail').toBe(200)
  const body = await readJsonSafe<{ data?: BackofficeTaskDetail }>(response)
  return body?.data ?? {}
}

async function waitForTaskNotification(
  request: APIRequestContext,
  token: string,
  taskId: string,
): Promise<{ id: string; actionIds: string[] }> {
  const deadline = Date.now() + 15_000
  for (;;) {
    const { items } = await listNotifications(request, token, { type: 'workflows.task.assigned', pageSize: 100 })
    const match = items.find((item) => item.sourceEntityId === taskId)
    if (match && typeof match.id === 'string') {
      const actions = Array.isArray(match.actions) ? (match.actions as Array<{ id?: string }>) : []
      return { id: match.id, actionIds: actions.map((action) => action.id ?? '') }
    }
    if (Date.now() >= deadline) throw new Error(`[internal] no workflows.task.assigned notification for task ${taskId}`)
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

test.describe('TC-WF-070: task completion guards', () => {
  test('backoffice: a veto closes the form and 409s, a pass completes, a throw fails closed', async ({
    page,
    request,
  }) => {
    test.setTimeout(150_000)

    const token = await getAuthToken(request, 'admin')
    const { userId } = getTokenScope(token)
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    const cleanup: Cleanup = { definitionIds: [], instanceIds: [] }

    try {
      const assignee: Assignee = { kind: 'user', userId }
      const vetoTaskId = await startGuardedTask(
        request,
        token,
        cleanup,
        buildGuardedTaskDefinition(stamp, 'veto', 'backoffice', assignee),
        { stamp },
      )
      const passTaskId = await startGuardedTask(
        request,
        token,
        cleanup,
        buildGuardedTaskDefinition(stamp, 'pass', 'backoffice', assignee),
        { stamp },
      )
      const throwTaskId = await startGuardedTask(
        request,
        token,
        cleanup,
        buildGuardedTaskDefinition(stamp, 'throw', 'backoffice', assignee),
        { stamp },
      )

      // --- Veto: the read mirrors what the act route would answer.
      const vetoDetail = await readBackofficeDetail(request, token, vetoTaskId)
      expect(vetoDetail.canComplete, 'a vetoed task never offers Complete').toBe(false)
      expect(vetoDetail.actBlockedReason).toBe('completion-guard')
      expect(vetoDetail.completionGuard).toEqual({
        guardId: VETO_BODY.guardId,
        code: VETO_BODY.code,
        messageKey: VETO_BODY.messageKey,
      })
      expect(vetoDetail.canReassign, 'a veto blocks finishing the task, never handing it on').toBe(true)

      const vetoComplete = await apiRequest(
        request,
        'POST',
        `/api/workflows/tasks/${encodeURIComponent(vetoTaskId)}/complete`,
        { token, data: { formData: {} } },
      )
      expect(vetoComplete.status(), 'the complete route refuses a vetoed task').toBe(409)
      expect(await readJsonSafe(vetoComplete)).toEqual(VETO_BODY)
      expect((await readBackofficeDetail(request, token, vetoTaskId)).status, 'a veto mutates nothing').toBe('PENDING')

      // --- UI: the notice names the guard's reason and Reassign stays reachable.
      await login(page, 'admin')
      await page.goto(`/backend/tasks/${encodeURIComponent(vetoTaskId)}`)
      const notice = page.getByTestId('task-act-blocked')
      await expect(notice, 'the completion-guard notice is shown').toBeVisible({ timeout: 30_000 })
      await expect(notice).toHaveAttribute('data-block-reason', VETO_BODY.messageKey)
      await expect(page.getByTestId('task-reassign'), 'Reassign stays available under a veto').toBeVisible()

      // --- Pass: nothing changes for a guard that allows.
      const passDetail = await readBackofficeDetail(request, token, passTaskId)
      expect(passDetail.canComplete).toBe(true)
      expect(passDetail.actBlockedReason ?? null).toBeNull()
      expect(passDetail.completionGuard ?? null).toBeNull()

      const passComplete = await apiRequest(
        request,
        'POST',
        `/api/workflows/tasks/${encodeURIComponent(passTaskId)}/complete`,
        { token, data: { formData: {} } },
      )
      expect(passComplete.status(), 'a passing guard lets the completion through').toBe(200)
      const passBody = await readJsonSafe<{ data?: { status?: string; completedBy?: string } }>(passComplete)
      expect(passBody?.data?.status).toBe('COMPLETED')
      expect(passBody?.data?.completedBy).toBe(userId)

      // --- Throw: fail closed, never leak the guard's own message.
      const throwDetail = await readBackofficeDetail(request, token, throwTaskId)
      expect(throwDetail.canComplete, 'a throwing guard closes the form').toBe(false)
      expect(throwDetail.actBlockedReason).toBe('completion-guard')
      expect(throwDetail.completionGuard).toEqual({
        guardId: FAILED_BODY.guardId,
        code: FAILED_BODY.code,
        messageKey: null,
      })

      const throwComplete = await apiRequest(
        request,
        'POST',
        `/api/workflows/tasks/${encodeURIComponent(throwTaskId)}/complete`,
        { token, data: { formData: {} } },
      )
      expect(throwComplete.status(), 'a throwing guard blocks with 409').toBe(409)
      const throwText = await throwComplete.text()
      expect(JSON.parse(throwText)).toEqual(FAILED_BODY)
      expect(throwText, 'the thrown message stays server-side').not.toContain(THROWN_MESSAGE)
      expect((await readBackofficeDetail(request, token, throwTaskId)).status).toBe('PENDING')
    } finally {
      await cleanUp(request, token, cleanup)
    }
  })

  test('portal: the assignee sees the veto on the detail and the complete route answers it', async ({ request }) => {
    test.setTimeout(150_000)

    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenScope(adminToken)
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    const cleanup: Cleanup = { definitionIds: [], instanceIds: [] }

    let companyId: string | null = null
    let roleId: string | null = null
    let portalUserId: string | null = null

    try {
      companyId = await createCustomerCompanyFixture(request, adminToken, `QA WF-070 ${stamp}`)
      const role = await createCustomerRoleFixture(request, adminToken, { features: PORTAL_TASK_FEATURES })
      roleId = role.id
      const portalUser = await createCustomerUserFixture(request, adminToken, {
        roleIds: [role.id],
        customerEntityId: companyId,
      })
      portalUserId = portalUser.id
      const session = await portalLogin(request, {
        email: portalUser.email,
        password: portalUser.password,
        tenantId,
      })
      const headers = portalCookieHeaders(session)
      const context = { portalUserId: portalUser.id, companyId }

      const taskIds = {} as Record<GuardCase, string>
      for (const guardCase of ['veto', 'pass', 'throw'] as const) {
        taskIds[guardCase] = await startGuardedTask(
          request,
          adminToken,
          cleanup,
          buildGuardedTaskDefinition(stamp, guardCase, 'portal', { kind: 'customer' }),
          context,
        )
      }

      const readPortalDetail = async (taskId: string) => {
        const response = await request.get(`/api/workflows/portal/tasks/${encodeURIComponent(taskId)}`, { headers })
        expect(response.status(), 'the portal assignee reads their own bound task').toBe(200)
        return readJsonSafe<{
          task?: { status?: string }
          canComplete?: boolean
          completionGuard?: { guardId?: string; code?: string; messageKey?: string | null } | null
        }>(response)
      }
      const completeOnPortal = (taskId: string) =>
        request.post(`/api/workflows/portal/tasks/${encodeURIComponent(taskId)}/complete`, {
          headers: { ...headers, 'Content-Type': 'application/json' },
          data: { formData: {} },
        })

      // --- Veto.
      const vetoDetail = await readPortalDetail(taskIds.veto)
      expect(vetoDetail?.canComplete, 'the portal form is closed under a veto').toBe(false)
      expect(vetoDetail?.completionGuard).toEqual({
        guardId: VETO_BODY.guardId,
        code: VETO_BODY.code,
        messageKey: VETO_BODY.messageKey,
      })
      const vetoComplete = await completeOnPortal(taskIds.veto)
      expect(vetoComplete.status(), 'the portal complete route refuses a vetoed task').toBe(409)
      expect(await readJsonSafe(vetoComplete)).toEqual({ ok: false, ...VETO_BODY })
      expect((await readPortalDetail(taskIds.veto))?.task?.status).toBe('PENDING')

      // --- Pass.
      const passDetail = await readPortalDetail(taskIds.pass)
      expect(passDetail?.canComplete).toBe(true)
      expect(passDetail?.completionGuard ?? null).toBeNull()
      const passComplete = await completeOnPortal(taskIds.pass)
      expect(passComplete.status(), 'a passing guard lets the portal completion through').toBe(200)
      const passBody = await readJsonSafe<{ ok?: boolean; task?: { status?: string; completedBy?: string } }>(passComplete)
      expect(passBody?.ok).toBe(true)
      expect(passBody?.task?.status).toBe('COMPLETED')
      expect(passBody?.task?.completedBy).toBe(portalUser.id)

      // --- Throw.
      const throwDetail = await readPortalDetail(taskIds.throw)
      expect(throwDetail?.canComplete).toBe(false)
      expect(throwDetail?.completionGuard).toEqual({
        guardId: FAILED_BODY.guardId,
        code: FAILED_BODY.code,
        messageKey: null,
      })
      const throwComplete = await completeOnPortal(taskIds.throw)
      expect(throwComplete.status()).toBe(409)
      const throwText = await throwComplete.text()
      expect(JSON.parse(throwText)).toEqual({ ok: false, ...FAILED_BODY })
      expect(throwText).not.toContain(THROWN_MESSAGE)
      expect((await readPortalDetail(taskIds.throw))?.task?.status).toBe('PENDING')
    } finally {
      await cleanUp(request, adminToken, cleanup)
      await deleteCustomerUserFixture(request, adminToken, portalUserId)
      await deleteCustomerRoleFixture(request, adminToken, roleId)
      await deleteCustomerCompanyFixture(request, adminToken, companyId)
    }
  })

  test('notification quick action: workflows.tasks.complete answers the same veto, pass and failure', async ({
    request,
  }) => {
    test.setTimeout(150_000)

    const token = await getAuthToken(request, 'admin')
    const { userId } = getTokenScope(token)
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    const cleanup: Cleanup = { definitionIds: [], instanceIds: [] }
    const notificationIds: string[] = []

    try {
      const runQuickAction = async (guardCase: GuardCase) => {
        const taskId = await startGuardedTask(
          request,
          token,
          cleanup,
          buildGuardedTaskDefinition(stamp, guardCase, 'notification', { kind: 'user', userId }),
          { stamp },
        )
        const notification = await waitForTaskNotification(request, token, taskId)
        notificationIds.push(notification.id)
        expect(notification.actionIds, 'a one-click task offers the complete quick action').toContain('complete')
        const response = await apiRequest(
          request,
          'POST',
          `/api/notifications/${encodeURIComponent(notification.id)}/action`,
          { token, data: { actionId: 'complete' } },
        )
        return { taskId, notificationId: notification.id, response }
      }

      const readNotificationStatus = async (notificationId: string) => {
        const { items } = await listNotifications(request, token, { type: 'workflows.task.assigned', pageSize: 100 })
        return items.find((item) => item.id === notificationId)?.status
      }

      // --- Veto: the command rethrows the guard's 409 body, and the claim on the
      //     notification is released so the action can be retried later.
      const veto = await runQuickAction('veto')
      expect(veto.response.status(), 'the quick action is refused with the guard veto').toBe(409)
      expect(await readJsonSafe(veto.response)).toEqual(VETO_BODY)
      expect((await readBackofficeDetail(request, token, veto.taskId)).status).toBe('PENDING')
      expect(await readNotificationStatus(veto.notificationId), 'a vetoed action is not marked actioned').not.toBe(
        'actioned',
      )

      // --- Pass.
      const pass = await runQuickAction('pass')
      expect(pass.response.status(), 'a passing guard lets the quick action complete the task').toBe(200)
      expect((await readBackofficeDetail(request, token, pass.taskId)).status).toBe('COMPLETED')

      // --- Throw.
      const thrown = await runQuickAction('throw')
      expect(thrown.response.status()).toBe(409)
      const throwText = await thrown.response.text()
      expect(JSON.parse(throwText)).toEqual(FAILED_BODY)
      expect(throwText).not.toContain(THROWN_MESSAGE)
      expect((await readBackofficeDetail(request, token, thrown.taskId)).status).toBe('PENDING')
    } finally {
      for (const notificationId of notificationIds) {
        await dismissNotificationIfExists(request, token, notificationId)
      }
      await cleanUp(request, token, cleanup)
    }
  })
})
