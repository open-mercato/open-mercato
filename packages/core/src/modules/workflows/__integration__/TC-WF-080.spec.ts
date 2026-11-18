import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  pollWorkflowInstance,
  startWorkflowInstanceFixture,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'

/**
 * TC-WF-080 [P1]: a met WAIT_FOR_CONDITION resumes the run to completion (#9296)
 *
 * Surface under test: PATCH /api/workflows/instances/[id]/context
 *
 * The run parks on a WAIT_FOR_CONDITION step (instance PAUSED). A context write
 * that satisfies the predicate wakes the waiter, which must flip the instance
 * back to RUNNING before running the auto transition. An AUTOMATED step sits
 * between the wait and END on purpose: without the flip the executor sees a
 * PAUSED instance after the first traversed step and the run stays parked there
 * instead of reaching END.
 */
function buildConditionWaitDefinitionPayload(timestamp: number) {
  const id = `qa-wf-condition-resume-${timestamp}`
  return {
    workflowId: id,
    workflowName: `QA Condition Resume Workflow ${timestamp}`,
    description: `Integration test definition ${id}`,
    version: 1,
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        {
          stepId: 'wait_for_flag',
          stepName: 'Wait for flag',
          stepType: 'WAIT_FOR_CONDITION',
          config: {
            condition: { operator: 'AND', rules: [{ field: 'qaFlag', operator: '==', value: true }] },
            timeout: 'PT10M',
            onTimeout: 'FAIL',
          },
        },
        { stepId: 'after_wait', stepName: 'After wait', stepType: 'AUTOMATED' },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: [
        { transitionId: 'start-to-wait', fromStepId: 'start', toStepId: 'wait_for_flag', trigger: 'auto' },
        { transitionId: 'wait-to-after', fromStepId: 'wait_for_flag', toStepId: 'after_wait', trigger: 'auto' },
        { transitionId: 'after-to-end', fromStepId: 'after_wait', toStepId: 'end', trigger: 'auto' },
      ],
    },
    enabled: true,
  }
}

test.describe('TC-WF-080: WAIT_FOR_CONDITION met path resumes the run', () => {
  test('a context write that satisfies the condition drives the run to END', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const definitionPayload = buildConditionWaitDefinitionPayload(Date.now())
    let definitionId: string | null = null
    let instanceId: string | null = null

    try {
      definitionId = await createWorkflowDefinitionFixture(request, token, definitionPayload)
      instanceId = await startWorkflowInstanceFixture(request, token, {
        workflowId: definitionPayload.workflowId,
        initialContext: { qaFlag: false },
      })

      const parked = await pollWorkflowInstance(
        request,
        token,
        instanceId,
        (instance) => instance.status === 'PAUSED' && instance.currentStepId === 'wait_for_flag',
      )
      expect(parked?.status).toBe('PAUSED')

      const response = await apiRequest(
        request,
        'PATCH',
        `/api/workflows/instances/${encodeURIComponent(instanceId)}/context`,
        { token, data: { context: { qaFlag: true } } },
      )
      const body = await readJsonSafe<{ woken?: string[] }>(response)
      expect(response.status(), `PATCH context should return 200 (got ${response.status()}: ${JSON.stringify(body)})`).toBe(200)
      expect(body?.woken).toEqual(['wait_for_flag'])

      const runId = instanceId
      const finished = await pollWorkflowInstance(request, token, runId, (instance) => instance.status === 'COMPLETED')
      expect(finished?.status).toBe('COMPLETED')
      expect(finished?.currentStepId).toBe('end')
      instanceId = null
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })
})
