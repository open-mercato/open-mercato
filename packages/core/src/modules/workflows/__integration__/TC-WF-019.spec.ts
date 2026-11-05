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
 * TC-WF-019: Regression — a FORK-less definition executes identically (root
 * token). The token abstraction must not change single-token behaviour.
 */
test.describe('TC-WF-019: fork-less regression', () => {
  test('a simple START → AUTOMATED → END workflow still completes', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const timestamp = Date.now()
    const workflowId = `qa-wf-019-${timestamp}`

    const definitionPayload = {
      workflowId,
      workflowName: `QA TC-WF-019 ${timestamp}`,
      version: 1,
      enabled: true,
      definition: {
        steps: [
          { stepId: 'start', stepName: 'Start', stepType: 'START' },
          { stepId: 'work', stepName: 'Work', stepType: 'AUTOMATED' },
          { stepId: 'end', stepName: 'End', stepType: 'END' },
        ],
        transitions: [
          { transitionId: 'start-to-work', fromStepId: 'start', toStepId: 'work', trigger: 'auto' },
          { transitionId: 'work-to-end', fromStepId: 'work', toStepId: 'end', trigger: 'auto' },
        ],
      },
    }

    let definitionId: string | null = null
    let instanceId: string | null = null
    try {
      definitionId = await createWorkflowDefinitionFixture(request, token, definitionPayload)
      instanceId = await startWorkflowInstanceFixture(request, token, { workflowId, initialContext: {} })

      const deadline = Date.now() + 20_000
      let status: string | undefined
      let context: Record<string, any> | undefined
      while (Date.now() < deadline) {
        const response = await apiRequest(request, 'GET', `/api/workflows/instances/${encodeURIComponent(instanceId)}`, { token })
        expect(response.status()).toBe(200)
        const body = await readJsonSafe<{ data?: { status?: string; context?: Record<string, any> } }>(response)
        status = body?.data?.status
        context = body?.data?.context
        if (status === 'COMPLETED' || status === 'FAILED') break
        await new Promise((resolve) => setTimeout(resolve, 150))
      }

      expect(status).toBe('COMPLETED')
      // No fork ran → no branches key was introduced into the context.
      expect(context?.branches).toBeUndefined()
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })
})
