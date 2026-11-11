import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  buildDecisionUserTaskDefinitionPayload,
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  findInstanceUserTask,
  listWorkflowInstanceEvents,
  pollWorkflowInstance,
  startWorkflowInstanceFixture,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'

/**
 * TC-WF-075 [P1]: a double-submitted task completion completes the task once
 *
 * Surface under test: POST /api/workflows/tasks/[id]/complete
 *
 * Several completions of the same open task are sent at once, the way a double
 * click or a retried request sends them. Exactly one may complete the task and
 * advance the run; every other one is refused (404 once the task is closed, or
 * 409 once the run has already finished), and the run logs a single
 * USER_TASK_COMPLETED event.
 */
test.describe('TC-WF-075: double-submitted task completion', () => {
  test('completes the task and advances the run exactly once', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const definitionPayload = buildDecisionUserTaskDefinitionPayload(Date.now(), '-double-submit')
    let definitionId: string | null = null
    let instanceId: string | null = null

    try {
      definitionId = await createWorkflowDefinitionFixture(request, token, definitionPayload)
      instanceId = await startWorkflowInstanceFixture(request, token, { workflowId: definitionPayload.workflowId })
      const task = await findInstanceUserTask(request, token, instanceId, { statuses: ['PENDING'] })
      expect(task?.id, 'the instance should park on a task').toBeTruthy()

      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          apiRequest(request, 'POST', `/api/workflows/tasks/${encodeURIComponent(task!.id!)}/complete`, {
            token,
            data: { formData: { comments: 'approved' }, decisionId: 'approve' },
          }),
        ),
      )
      const statuses = responses.map((response) => response.status())
      expect(statuses.filter((status) => status === 200), 'one submission completes the task').toHaveLength(1)
      expect(
        statuses.filter((status) => status !== 200).every((status) => status === 404 || status === 409),
        `the rest are refused as already completed (got ${statuses.join(', ')})`,
      ).toBe(true)

      const runId = instanceId
      const finished = await pollWorkflowInstance(request, token, runId, (instance) => instance.status === 'COMPLETED')
      expect(finished?.status).toBe('COMPLETED')
      expect(finished?.currentStepId).toBe('approved')
      instanceId = null

      const completedEvents = await listWorkflowInstanceEvents(request, token, runId, {
        eventType: 'USER_TASK_COMPLETED',
      })
      expect(completedEvents, 'the completion is logged once').toHaveLength(1)
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })
})
