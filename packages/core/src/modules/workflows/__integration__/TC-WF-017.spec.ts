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
 * TC-WF-017: a failure in one branch cancels its siblings and fails the whole
 * instance. The failing branch runs an EXECUTE_FUNCTION activity referencing an
 * unregistered function so it fails synchronously (continueOnActivityFailure
 * defaults to false), which fails the branch.
 */
test.describe('TC-WF-017: branch failure cancels siblings and fails the instance', () => {
  test('a failing branch cancels the sibling and the instance ends FAILED', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const timestamp = Date.now()
    const workflowId = `qa-wf-017-${timestamp}`

    const definitionPayload = {
      workflowId,
      workflowName: `QA TC-WF-017 ${timestamp}`,
      version: 1,
      enabled: true,
      definition: {
        steps: [
          { stepId: 'start', stepName: 'Start', stepType: 'START' },
          { stepId: 'fork', stepName: 'Fork', stepType: 'PARALLEL_FORK', config: { joinStepId: 'join' } },
          {
            stepId: 'task_branch',
            stepName: 'Long Task',
            stepType: 'USER_TASK',
            userTaskConfig: { assignedTo: 'admin' },
          },
          { stepId: 'failing_step', stepName: 'Failing', stepType: 'AUTOMATED' },
          { stepId: 'join', stepName: 'Join', stepType: 'PARALLEL_JOIN', config: { forkStepId: 'fork' } },
          { stepId: 'end', stepName: 'End', stepType: 'END' },
        ],
        transitions: [
          { transitionId: 'start-to-fork', fromStepId: 'start', toStepId: 'fork', trigger: 'auto' },
          { transitionId: 'fork-to-task', fromStepId: 'fork', toStepId: 'task_branch', trigger: 'auto' },
          {
            transitionId: 'fork-to-failing',
            fromStepId: 'fork',
            toStepId: 'failing_step',
            trigger: 'auto',
            activities: [
              {
                activityId: 'boom',
                activityName: 'Boom',
                activityType: 'EXECUTE_FUNCTION',
                // functionName, not functionId — with the wrong key the activity
                // failed on "requires functionName" rather than on the missing
                // registration this test is actually about.
                config: { functionName: 'qa-nonexistent-function-do-not-register' },
              },
            ],
          },
          { transitionId: 'task-to-join', fromStepId: 'task_branch', toStepId: 'join', trigger: 'auto' },
          { transitionId: 'failing-to-join', fromStepId: 'failing_step', toStepId: 'join', trigger: 'auto' },
          { transitionId: 'join-to-end', fromStepId: 'join', toStepId: 'end', trigger: 'auto' },
        ],
      },
    }

    let definitionId: string | null = null
    let instanceId: string | null = null
    try {
      definitionId = await createWorkflowDefinitionFixture(request, token, definitionPayload)
      instanceId = await startWorkflowInstanceFixture(request, token, { workflowId, initialContext: {} })

      const deadline = Date.now() + 30_000
      let status: string | undefined
      while (Date.now() < deadline) {
        const response = await apiRequest(request, 'GET', `/api/workflows/instances/${encodeURIComponent(instanceId)}`, { token })
        expect(response.status()).toBe(200)
        const body = await readJsonSafe<{ data?: { status?: string } }>(response)
        status = body?.data?.status
        if (status === 'FAILED' || status === 'COMPLETED') break
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
      expect(status, `A failing branch should fail the whole instance (status=${status})`).toBe('FAILED')

      // The sibling branch should have been cancelled.
      const eventsResponse = await apiRequest(
        request,
        'GET',
        `/api/workflows/instances/${encodeURIComponent(instanceId)}/events?eventType=PARALLEL_BRANCH_CANCELLED`,
        { token },
      )
      expect(eventsResponse.status()).toBe(200)
      const eventsBody = await readJsonSafe<{ data?: Array<{ eventType?: string }> }>(eventsResponse)
      expect(
        (eventsBody?.data ?? []).length,
        'Sibling branch should be cancelled when another branch fails',
      ).toBeGreaterThanOrEqual(1)
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })
})
