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
 * TC-WF-022: PARALLEL_FORK → 2 AUTOMATED branches → PARALLEL_JOIN (wait-all)
 *
 * Both branches are fully automated (no async activities), so the start call
 * drives execution synchronously: fork → both branches run → wait-all join →
 * post-join step → END. Verifies the instance completes and the JOIN merged the
 * per-branch namespaces under context.branches[branchKey].
 */
test.describe('TC-WF-022: parallel fork/join wait-all happy path', () => {
  test('two automated branches fork, run, and join to completion', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const timestamp = Date.now()
    const workflowId = `qa-wf-022-${timestamp}`

    const definitionPayload = {
      workflowId,
      workflowName: `QA TC-WF-022 ${timestamp}`,
      description: 'Integration test: parallel fork/join wait-all',
      version: 1,
      enabled: true,
      definition: {
        steps: [
          { stepId: 'start', stepName: 'Start', stepType: 'START' },
          { stepId: 'fork', stepName: 'Fork', stepType: 'PARALLEL_FORK', config: { joinStepId: 'join' } },
          { stepId: 'branch_a', stepName: 'Branch A', stepType: 'AUTOMATED' },
          { stepId: 'branch_b', stepName: 'Branch B', stepType: 'AUTOMATED' },
          { stepId: 'join', stepName: 'Join', stepType: 'PARALLEL_JOIN', config: { forkStepId: 'fork' } },
          { stepId: 'end', stepName: 'End', stepType: 'END' },
        ],
        transitions: [
          { transitionId: 'start-to-fork', fromStepId: 'start', toStepId: 'fork', trigger: 'auto' },
          { transitionId: 'fork-to-a', fromStepId: 'fork', toStepId: 'branch_a', trigger: 'auto' },
          { transitionId: 'fork-to-b', fromStepId: 'fork', toStepId: 'branch_b', trigger: 'auto' },
          { transitionId: 'a-to-join', fromStepId: 'branch_a', toStepId: 'join', trigger: 'auto' },
          { transitionId: 'b-to-join', fromStepId: 'branch_b', toStepId: 'join', trigger: 'auto' },
          { transitionId: 'join-to-end', fromStepId: 'join', toStepId: 'end', trigger: 'auto' },
        ],
      },
    }

    let definitionId: string | null = null
    let instanceId: string | null = null

    try {
      definitionId = await createWorkflowDefinitionFixture(request, token, definitionPayload)
      instanceId = await startWorkflowInstanceFixture(request, token, {
        workflowId,
        initialContext: { test: true },
      })

      const deadline = Date.now() + 30_000
      let status: string | undefined
      let context: Record<string, any> | undefined
      while (Date.now() < deadline) {
        const response = await apiRequest(
          request,
          'GET',
          `/api/workflows/instances/${encodeURIComponent(instanceId)}`,
          { token },
        )
        expect(response.status()).toBe(200)
        const body = await readJsonSafe<{ data?: { status?: string; context?: Record<string, any> } }>(response)
        status = body?.data?.status
        context = body?.data?.context
        if (status === 'COMPLETED' || status === 'FAILED') break
        await new Promise((resolve) => setTimeout(resolve, 200))
      }

      expect(status, `Parallel workflow should complete (status=${status})`).toBe('COMPLETED')
      // JOIN merged both branch namespaces deterministically.
      expect(context?.branches, 'JOIN should merge branch namespaces under context.branches').toBeTruthy()
      expect(Object.keys(context?.branches ?? {}).sort()).toEqual(['fork-to-a', 'fork-to-b'])

      // PARALLEL_JOIN_COMPLETED event recorded.
      const eventsResponse = await apiRequest(
        request,
        'GET',
        `/api/workflows/instances/${encodeURIComponent(instanceId)}/events?eventType=PARALLEL_JOIN_COMPLETED`,
        { token },
      )
      expect(eventsResponse.status()).toBe(200)
      const eventsBody = await readJsonSafe<{ data?: Array<{ eventType?: string }> }>(eventsResponse)
      expect((eventsBody?.data ?? []).length).toBeGreaterThanOrEqual(1)
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })
})
