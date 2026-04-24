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
 * TC-WF-009: Sync WAIT activity executes end-to-end
 *
 * Starts an instance of a definition whose sole transition carries a
 * synchronous WAIT activity (`duration: PT1S`). Polls the instance until it
 * reaches COMPLETED and asserts the completion was delayed by at least ~1s,
 * proving the WAIT activity actually paused execution rather than being
 * skipped.
 */
test.describe('TC-WF-009: Sync WAIT activity delays and completes', () => {
  test('workflow with sync WAIT reaches COMPLETED after the configured duration', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const timestamp = Date.now()
    const workflowId = `qa-wf-009-${timestamp}`

    const definitionPayload = {
      workflowId,
      workflowName: `QA TC-WF-009 ${timestamp}`,
      description: 'Integration test: sync WAIT activity delays transition',
      version: 1,
      enabled: true,
      definition: {
        steps: [
          { stepId: 'start', stepName: 'Start', stepType: 'START' },
          { stepId: 'end', stepName: 'End', stepType: 'END' },
        ],
        transitions: [
          {
            transitionId: 'start-to-end',
            fromStepId: 'start',
            toStepId: 'end',
            trigger: 'auto',
            activities: [
              {
                activityId: 'pause-briefly',
                activityName: 'Pause briefly',
                activityType: 'WAIT',
                async: false,
                config: { duration: 'PT1S' },
              },
            ],
          },
        ],
      },
    }

    let definitionId: string | null = null
    let instanceId: string | null = null

    try {
      definitionId = await createWorkflowDefinitionFixture(request, token, definitionPayload)

      const startedAt = Date.now()
      instanceId = await startWorkflowInstanceFixture(request, token, {
        workflowId,
        initialContext: { test: true },
      })

      const timeoutAt = startedAt + 8_000
      let finalStatus: string | undefined
      let finalBody: { data?: { status?: string } } | null = null
      while (Date.now() < timeoutAt) {
        const response = await apiRequest(
          request,
          'GET',
          `/api/workflows/instances/${encodeURIComponent(instanceId)}`,
          { token },
        )
        expect(response.status()).toBe(200)
        finalBody = await readJsonSafe<{ data?: { status?: string } }>(response)
        finalStatus = finalBody?.data?.status
        if (finalStatus === 'COMPLETED' || finalStatus === 'FAILED') break
        await new Promise((resolve) => setTimeout(resolve, 250))
      }

      expect(
        finalStatus,
        `Workflow should complete after sync WAIT (status=${finalStatus}, body=${JSON.stringify(finalBody)})`,
      ).toBe('COMPLETED')

      const elapsed = Date.now() - startedAt
      expect(
        elapsed,
        `Workflow completion should be delayed by at least ~1s due to WAIT (took ${elapsed}ms)`,
      ).toBeGreaterThanOrEqual(900)
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })
})
