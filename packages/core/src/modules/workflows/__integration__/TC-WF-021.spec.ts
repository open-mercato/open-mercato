import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  startWorkflowInstanceFixture,
} from '@open-mercato/core/modules/core/__integration__/helpers/workflowsFixtures'

/**
 * TC-WF-021: the step AFTER a PARALLEL_JOIN must run through the normal
 * step-entry path. Here the JOIN is followed by a USER_TASK: once both auto
 * branches reach the JOIN (wait-all), the join must enter the post-join
 * USER_TASK step (creating its task) rather than skipping it. Regression guard
 * for fireJoin jumping the root token straight past the JOIN's successor, which
 * left a post-join USER_TASK/WAIT_FOR_TIMER/WAIT_FOR_SIGNAL un-entered and hung
 * the instance.
 */
test.describe('TC-WF-021: user task after the join', () => {
  test('a USER_TASK following the JOIN is created, then completes the workflow', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const timestamp = Date.now()
    const workflowId = `qa-wf-021-${timestamp}`

    const definitionPayload = {
      workflowId,
      workflowName: `QA TC-WF-021 ${timestamp}`,
      version: 1,
      enabled: true,
      definition: {
        steps: [
          { stepId: 'start', stepName: 'Start', stepType: 'START' },
          { stepId: 'fork', stepName: 'Fork', stepType: 'PARALLEL_FORK', config: { joinStepId: 'join' } },
          { stepId: 'branch_a', stepName: 'A', stepType: 'AUTOMATED' },
          { stepId: 'branch_b', stepName: 'B', stepType: 'AUTOMATED' },
          { stepId: 'join', stepName: 'Join', stepType: 'PARALLEL_JOIN', config: { forkStepId: 'fork' } },
          {
            stepId: 'review',
            stepName: 'Review',
            stepType: 'USER_TASK',
            userTaskConfig: { assignedTo: 'admin' },
          },
          { stepId: 'end', stepName: 'End', stepType: 'END' },
        ],
        transitions: [
          { transitionId: 'start-to-fork', fromStepId: 'start', toStepId: 'fork', trigger: 'auto' },
          { transitionId: 'fork-to-a', fromStepId: 'fork', toStepId: 'branch_a', trigger: 'auto' },
          { transitionId: 'fork-to-b', fromStepId: 'fork', toStepId: 'branch_b', trigger: 'auto' },
          { transitionId: 'a-to-join', fromStepId: 'branch_a', toStepId: 'join', trigger: 'auto' },
          { transitionId: 'b-to-join', fromStepId: 'branch_b', toStepId: 'join', trigger: 'auto' },
          { transitionId: 'join-to-review', fromStepId: 'join', toStepId: 'review', trigger: 'auto' },
          { transitionId: 'review-to-end', fromStepId: 'review', toStepId: 'end', trigger: 'auto' },
        ],
      },
    }

    let definitionId: string | null = null
    let instanceId: string | null = null
    try {
      definitionId = await createWorkflowDefinitionFixture(request, token, definitionPayload)
      instanceId = await startWorkflowInstanceFixture(request, token, { workflowId, initialContext: {} })

      // Both branches join (wait-all); the JOIN must enter the post-join
      // USER_TASK, which creates a pending task. Pre-fix this never appeared.
      let taskId: string | undefined
      const taskDeadline = Date.now() + 15_000
      while (Date.now() < taskDeadline) {
        const response = await apiRequest(
          request,
          'GET',
          `/api/workflows/tasks?workflowInstanceId=${encodeURIComponent(instanceId)}`,
          { token },
        )
        expect(response.status()).toBe(200)
        const body = await readJsonSafe<{ data?: Array<{ id?: string; status?: string }> }>(response)
        const pending = (body?.data ?? []).find((t) => t.status === 'PENDING' || t.status === 'IN_PROGRESS')
        if (pending?.id) {
          taskId = pending.id
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
      expect(taskId, 'A pending user task should be created for the post-join step').toBeTruthy()

      const completeResponse = await apiRequest(
        request,
        'POST',
        `/api/workflows/tasks/${encodeURIComponent(taskId!)}/complete`,
        { token, data: { formData: { reviewed: true } } },
      )
      expect([200, 201]).toContain(completeResponse.status())

      const deadline = Date.now() + 30_000
      let status: string | undefined
      while (Date.now() < deadline) {
        const response = await apiRequest(request, 'GET', `/api/workflows/instances/${encodeURIComponent(instanceId)}`, { token })
        expect(response.status()).toBe(200)
        const body = await readJsonSafe<{ data?: { status?: string } }>(response)
        status = body?.data?.status
        if (status === 'COMPLETED' || status === 'FAILED') break
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
      expect(status, `Workflow should complete after the post-join task is done (status=${status})`).toBe('COMPLETED')
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })
})
