import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  listWorkflowInstanceEvents,
  listWorkflowInstanceSteps,
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
 *
 * Resuming is a claim on the one ACTIVE occurrence of the wait: concurrent
 * deliveries resume it once (one `woken`, one CONDITION_MET, one completed wait
 * step), and a run cancelled while parked is never resumed by a later write.
 */
function buildConditionWaitDefinitionPayload(timestamp: number, suffix = '') {
  const id = `qa-wf-condition-resume-${timestamp}${suffix}`
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

  test('concurrent context writes resume the wait exactly once', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const definitionPayload = buildConditionWaitDefinitionPayload(Date.now(), '-race')
    let definitionId: string | null = null
    let instanceId: string | null = null

    try {
      definitionId = await createWorkflowDefinitionFixture(request, token, definitionPayload)
      instanceId = await startWorkflowInstanceFixture(request, token, {
        workflowId: definitionPayload.workflowId,
        initialContext: { qaFlag: false },
      })
      const runId = instanceId

      await pollWorkflowInstance(
        request,
        token,
        runId,
        (instance) => instance.status === 'PAUSED' && instance.currentStepId === 'wait_for_flag',
      )

      const contextPath = `/api/workflows/instances/${encodeURIComponent(runId)}/context`
      const responses = await Promise.all(
        Array.from({ length: 4 }, () =>
          apiRequest(request, 'PATCH', contextPath, { token, data: { context: { qaFlag: true } } }),
        ),
      )
      const wokenReports: string[] = []
      for (const response of responses) {
        const body = await readJsonSafe<{ woken?: string[] }>(response)
        if (response.status() === 200) wokenReports.push(...(body?.woken ?? []))
      }
      expect(wokenReports).toEqual(['wait_for_flag'])

      const finished = await pollWorkflowInstance(request, token, runId, (instance) => instance.status === 'COMPLETED')
      expect(finished?.status).toBe('COMPLETED')

      const conditionMet = await listWorkflowInstanceEvents(request, token, runId, { eventType: 'CONDITION_MET' })
      expect(conditionMet).toHaveLength(1)
      const waitSteps = (await listWorkflowInstanceSteps(request, token, runId)).filter(
        (step) => step.stepId === 'wait_for_flag',
      )
      expect(waitSteps).toHaveLength(1)
      expect(waitSteps[0]?.status).toBe('COMPLETED')
      instanceId = null
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })

  test('a context write after cancellation never resumes the wait', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const definitionPayload = buildConditionWaitDefinitionPayload(Date.now(), '-cancel')
    let definitionId: string | null = null
    let instanceId: string | null = null

    try {
      definitionId = await createWorkflowDefinitionFixture(request, token, definitionPayload)
      instanceId = await startWorkflowInstanceFixture(request, token, {
        workflowId: definitionPayload.workflowId,
        initialContext: { qaFlag: false },
      })
      const runId = instanceId

      await pollWorkflowInstance(
        request,
        token,
        runId,
        (instance) => instance.status === 'PAUSED' && instance.currentStepId === 'wait_for_flag',
      )

      const cancel = await apiRequest(request, 'POST', `/api/workflows/instances/${encodeURIComponent(runId)}/cancel`, {
        token,
      })
      expect(cancel.status(), `cancel should succeed (got ${cancel.status()})`).toBeLessThan(300)
      await pollWorkflowInstance(request, token, runId, (instance) => instance.status === 'CANCELLED')

      const response = await apiRequest(
        request,
        'PATCH',
        `/api/workflows/instances/${encodeURIComponent(runId)}/context`,
        { token, data: { context: { qaFlag: true } } },
      )
      const body = await readJsonSafe<{ woken?: string[] }>(response)
      if (response.status() === 200) expect(body?.woken ?? []).toEqual([])

      const after = await pollWorkflowInstance(request, token, runId, (instance) => instance.status === 'CANCELLED')
      expect(after?.status).toBe('CANCELLED')
      const conditionMet = await listWorkflowInstanceEvents(request, token, runId, { eventType: 'CONDITION_MET' })
      expect(conditionMet).toHaveLength(0)
      const waitSteps = (await listWorkflowInstanceSteps(request, token, runId)).filter(
        (step) => step.stepId === 'wait_for_flag',
      )
      expect(waitSteps.every((step) => step.status !== 'COMPLETED')).toBe(true)
      instanceId = null
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })
})
