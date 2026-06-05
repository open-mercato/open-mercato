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
 * TC-WF-015: a FORK with a USER_TASK branch pauses that branch independently
 * while the sibling proceeds; completing the task resumes the branch and the
 * JOIN fires (wait-all) once both branches are done.
 */
test.describe('TC-WF-015: parallel branch with a user task', () => {
  test('one branch pauses on a user task; completing it resumes and joins', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const timestamp = Date.now()
    const workflowId = `qa-wf-015-${timestamp}`

    const definitionPayload = {
      workflowId,
      workflowName: `QA TC-WF-015 ${timestamp}`,
      version: 1,
      enabled: true,
      definition: {
        steps: [
          { stepId: 'start', stepName: 'Start', stepType: 'START' },
          { stepId: 'fork', stepName: 'Fork', stepType: 'PARALLEL_FORK', config: { joinStepId: 'join' } },
          { stepId: 'auto_branch', stepName: 'Auto', stepType: 'AUTOMATED' },
          {
            stepId: 'task_branch',
            stepName: 'Approve',
            stepType: 'USER_TASK',
            userTaskConfig: { assignedTo: 'admin' },
          },
          { stepId: 'join', stepName: 'Join', stepType: 'PARALLEL_JOIN', config: { forkStepId: 'fork' } },
          { stepId: 'end', stepName: 'End', stepType: 'END' },
        ],
        transitions: [
          { transitionId: 'start-to-fork', fromStepId: 'start', toStepId: 'fork', trigger: 'auto' },
          { transitionId: 'fork-to-auto', fromStepId: 'fork', toStepId: 'auto_branch', trigger: 'auto' },
          { transitionId: 'fork-to-task', fromStepId: 'fork', toStepId: 'task_branch', trigger: 'auto' },
          { transitionId: 'auto-to-join', fromStepId: 'auto_branch', toStepId: 'join', trigger: 'auto' },
          { transitionId: 'task-to-join', fromStepId: 'task_branch', toStepId: 'join', trigger: 'auto' },
          { transitionId: 'join-to-end', fromStepId: 'join', toStepId: 'end', trigger: 'auto' },
        ],
      },
    }

    let definitionId: string | null = null
    let instanceId: string | null = null
    try {
      definitionId = await createWorkflowDefinitionFixture(request, token, definitionPayload)
      instanceId = await startWorkflowInstanceFixture(request, token, { workflowId, initialContext: {} })

      // The task branch pauses; the instance is FORKED and idle. Find the task.
      let taskId: string | undefined
      const taskDeadline = Date.now() + 10_000
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
      expect(taskId, 'A pending user task should be created for the task branch').toBeTruthy()

      // Complete the task → branch resumes → wait-all join fires.
      const completeResponse = await apiRequest(
        request,
        'POST',
        `/api/workflows/tasks/${encodeURIComponent(taskId!)}/complete`,
        { token, data: { formData: { approved: true } } },
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
      expect(status, `Workflow should complete after the branch task is done (status=${status})`).toBe('COMPLETED')
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })
})
