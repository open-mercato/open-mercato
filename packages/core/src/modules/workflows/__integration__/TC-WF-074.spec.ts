import { randomInt } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  findInstanceUserTask,
  pollWorkInbox,
  startWorkflowInstanceFixture,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'

/**
 * TC-WF-074 [P1]: a host-owned task offers no generic completion and links to its host.
 *
 * Issue #7179. A step that declares `userTaskConfig.completion.surface: 'host'` is finished
 * in a host module's own UI flow. Core must then offer no notification quick action, no Work
 * Inbox complete action and no generic Complete form, and every deep link must resolve to the
 * declared `href`, interpolated once from the run context.
 *
 * Surfaces under test:
 * - GET /api/workflows/tasks/[id]   (`completion` on the detail payload)
 * - GET /api/workflows/work-inbox   (`detailHref` points at the host)
 * - GET /api/notifications          (no `complete` action, link and button at the host)
 * - /backend/tasks/[id]             (host notice instead of the Complete form)
 *
 * The control definition is identical except that it omits the key; it must behave exactly as
 * before (task-page links, the one-click action still offered).
 */

type NotificationRow = {
  sourceEntityId?: string | null
  linkHref?: string | null
  actions?: Array<{ id?: string; href?: string; commandId?: string }>
}

function buildDefinitionPayload(stamp: number, assignedUserId: string, host: boolean) {
  const suffix = host ? 'host' : 'core'
  const id = `qa-wf-074-${suffix}-${stamp}`
  return {
    workflowId: id,
    workflowName: `QA Completion Surface ${suffix} ${stamp}`,
    description: `Integration test definition ${id}`,
    version: 1,
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        {
          stepId: 'review',
          stepName: 'Review',
          stepType: 'USER_TASK',
          userTaskConfig: {
            assignedTo: assignedUserId,
            // One decision and no form: a task core would otherwise finish in one click.
            decisions: [{ id: 'approve', label: 'Approve', transitionId: 'review-to-end' }],
            ...(host
              ? { completion: { surface: 'host', href: '/backend/qa-host/{{context.reference}}/approve' } }
              : {}),
          },
        },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: [
        { transitionId: 'start-to-review', fromStepId: 'start', toStepId: 'review', trigger: 'auto' },
        { transitionId: 'review-to-end', fromStepId: 'review', toStepId: 'end', trigger: 'manual' },
      ],
    },
    enabled: true,
  }
}

async function pollTaskNotification(
  request: APIRequestContext,
  token: string,
  taskId: string,
): Promise<NotificationRow | null> {
  const deadline = Date.now() + 20_000
  for (;;) {
    const response = await apiRequest(
      request,
      'GET',
      `/api/notifications?sourceEntityId=${encodeURIComponent(taskId)}&pageSize=10`,
      { token },
    )
    expect(response.status()).toBe(200)
    const body = await readJsonSafe<{ items?: NotificationRow[] }>(response)
    const match = (body?.items ?? []).find((row) => row.sourceEntityId === taskId)
    if (match) return match
    if (Date.now() >= deadline) return null
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

test.describe('TC-WF-074: completion-surface declaration (host-owned completion)', () => {
  test('a host task drops core completion affordances and deep-links to the host', async ({ page, request }) => {
    test.setTimeout(120_000)

    const token = await getAuthToken(request, 'admin')
    const { userId } = getTokenScope(token)
    const stamp = Date.now() + randomInt(1_000)
    const reference = `ref${stamp}`
    const hostHref = `/backend/qa-host/${reference}/approve`

    const definitionIds: string[] = []
    const instanceIds: string[] = []

    try {
      for (const host of [true, false]) {
        definitionIds.push(
          await createWorkflowDefinitionFixture(request, token, buildDefinitionPayload(stamp, userId, host)),
        )
      }
      const [hostInstanceId, coreInstanceId] = [
        await startWorkflowInstanceFixture(request, token, {
          workflowId: `qa-wf-074-host-${stamp}`,
          initialContext: { reference },
        }),
        await startWorkflowInstanceFixture(request, token, {
          workflowId: `qa-wf-074-core-${stamp}`,
          initialContext: { reference },
        }),
      ]
      instanceIds.push(hostInstanceId, coreInstanceId)

      const hostTask = await findInstanceUserTask(request, token, hostInstanceId)
      const coreTask = await findInstanceUserTask(request, token, coreInstanceId)
      expect(hostTask?.id, 'the host task is created').toBeTruthy()
      expect(coreTask?.id, 'the control task is created').toBeTruthy()
      const hostTaskId = hostTask!.id!
      const coreTaskId = coreTask!.id!

      // (1) The detail payload carries the resolved declaration; the control carries none.
      const hostDetail = await apiRequest(request, 'GET', `/api/workflows/tasks/${hostTaskId}`, { token })
      expect(hostDetail.status()).toBe(200)
      const hostBody = await readJsonSafe<{ data?: { completion?: unknown; canComplete?: boolean } }>(hostDetail)
      expect(hostBody?.data?.completion).toEqual({ surface: 'host', href: hostHref })
      expect(hostBody?.data?.canComplete, 'who may act is unchanged by the surface').toBe(true)

      const coreDetail = await apiRequest(request, 'GET', `/api/workflows/tasks/${coreTaskId}`, { token })
      expect(coreDetail.status()).toBe(200)
      const coreBody = await readJsonSafe<{ data?: { completion?: unknown } }>(coreDetail)
      expect(coreBody?.data?.completion ?? null).toBeNull()

      // (2) The Work Inbox deep-links the host task to its host, the control to the task page.
      for (const [instanceId, taskId, expectedHref] of [
        [hostInstanceId, hostTaskId, hostHref],
        [coreInstanceId, coreTaskId, `/backend/tasks/${coreTaskId}`],
      ] as const) {
        const inbox = await pollWorkInbox(
          request,
          token,
          `?workflowInstanceId=${encodeURIComponent(instanceId)}`,
          (body) => (body.data ?? []).some((row) => row.id === taskId),
        )
        const row = (inbox?.data ?? []).find((candidate) => candidate.id === taskId)
        expect(row?.detailHref).toBe(expectedHref)
      }

      // (3) Notifications: no one-click completion for the host task, links point at the host.
      const hostNotification = await pollTaskNotification(request, token, hostTaskId)
      expect(hostNotification, 'the assignment notification is delivered').toBeTruthy()
      expect(hostNotification?.linkHref).toBe(hostHref)
      expect((hostNotification?.actions ?? []).some((action) => action.id === 'complete')).toBe(false)
      expect((hostNotification?.actions ?? []).find((action) => action.id === 'view')?.href).toBe(hostHref)

      const coreNotification = await pollTaskNotification(request, token, coreTaskId)
      expect(coreNotification, 'the control notification is delivered').toBeTruthy()
      expect(coreNotification?.linkHref).toBe(`/backend/tasks/${coreTaskId}`)

      // (4) The task page offers the host link instead of the generic Complete form.
      await login(page, 'admin')
      await page.goto(`/backend/tasks/${hostTaskId}`)
      await expect(page.getByTestId('task-host-completion')).toBeVisible()
      await expect(page.getByTestId('task-host-completion-link')).toHaveAttribute('href', hostHref)
      await expect(page.getByTestId('task-decisions')).toHaveCount(0)
      await expect(page.getByTestId('task-complete')).toHaveCount(0)

      await page.goto(`/backend/tasks/${coreTaskId}`)
      await expect(page.getByTestId('task-decisions')).toBeVisible()
      await expect(page.getByTestId('task-host-completion')).toHaveCount(0)
    } finally {
      for (const instanceId of instanceIds) {
        await cancelWorkflowInstanceIfExists(request, token, instanceId)
      }
      for (const definitionId of definitionIds) {
        await deleteWorkflowDefinitionIfExists(request, token, definitionId)
      }
    }
  })
})
