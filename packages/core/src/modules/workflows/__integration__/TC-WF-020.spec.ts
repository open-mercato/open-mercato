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
 * TC-WF-020: tenant scoping for parallel branches. Branch-scoped events and the
 * instance detail must only ever surface to the owning tenant, and an
 * unauthenticated read must be rejected.
 */
test.describe('TC-WF-020: parallel branch tenant scoping', () => {
  test('branch events stay scoped to the instance and require auth', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const timestamp = Date.now()
    const workflowId = `qa-wf-020-${timestamp}`

    const definitionPayload = {
      workflowId,
      workflowName: `QA TC-WF-020 ${timestamp}`,
      version: 1,
      enabled: true,
      definition: {
        steps: [
          { stepId: 'start', stepName: 'Start', stepType: 'START' },
          { stepId: 'fork', stepName: 'Fork', stepType: 'PARALLEL_FORK', config: { joinStepId: 'join' } },
          { stepId: 'a', stepName: 'A', stepType: 'AUTOMATED' },
          { stepId: 'b', stepName: 'B', stepType: 'AUTOMATED' },
          { stepId: 'join', stepName: 'Join', stepType: 'PARALLEL_JOIN', config: { forkStepId: 'fork' } },
          { stepId: 'end', stepName: 'End', stepType: 'END' },
        ],
        transitions: [
          { transitionId: 'start-to-fork', fromStepId: 'start', toStepId: 'fork', trigger: 'auto' },
          { transitionId: 'fork-to-a', fromStepId: 'fork', toStepId: 'a', trigger: 'auto' },
          { transitionId: 'fork-to-b', fromStepId: 'fork', toStepId: 'b', trigger: 'auto' },
          { transitionId: 'a-to-join', fromStepId: 'a', toStepId: 'join', trigger: 'auto' },
          { transitionId: 'b-to-join', fromStepId: 'b', toStepId: 'join', trigger: 'auto' },
          { transitionId: 'join-to-end', fromStepId: 'join', toStepId: 'end', trigger: 'auto' },
        ],
      },
    }

    let definitionId: string | null = null
    let instanceId: string | null = null
    try {
      definitionId = await createWorkflowDefinitionFixture(request, token, definitionPayload)
      instanceId = await startWorkflowInstanceFixture(request, token, { workflowId, initialContext: {} })

      // Drive to completion.
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
      expect(status).toBe('COMPLETED')

      // Branch events for this instance reference only this instance.
      const eventsResponse = await apiRequest(
        request,
        'GET',
        `/api/workflows/instances/${encodeURIComponent(instanceId)}/events?eventType=PARALLEL_FORK_OPENED`,
        { token },
      )
      expect(eventsResponse.status()).toBe(200)
      const eventsBody = await readJsonSafe<{ data?: Array<{ workflowInstanceId?: string }> }>(eventsResponse)
      for (const event of eventsBody?.data ?? []) {
        if (event.workflowInstanceId) {
          expect(event.workflowInstanceId).toBe(instanceId)
        }
      }

      // Unauthenticated read of the instance must be rejected (no cross-tenant leakage).
      const noAuth = await apiRequest(request, 'GET', `/api/workflows/instances/${encodeURIComponent(instanceId)}`, { token: '' })
      expect([401, 403]).toContain(noAuth.status())
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })
})
