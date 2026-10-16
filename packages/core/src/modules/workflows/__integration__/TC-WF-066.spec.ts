import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  buildSignalDefinitionPayload,
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  listWorkflowInstanceEvents,
  pollWorkflowInstance,
  startWorkflowInstanceFixture,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'

/**
 * TC-WF-066 (issue #7185) [P1]: concurrent delivery of the same signal
 *
 * Surfaces under test:
 * - POST /api/workflows/instances/[id]/signal
 * - POST /api/workflows/signals
 *
 * A paused instance is advanced by exactly one delivery of a signal. Duplicates fired at the
 * same time are refused (409 on the instance route, `WORKFLOW_NOT_PAUSED` under `failures` on
 * the correlation route), and a correlation-key delivery never consumes a later wait an
 * instance was moved onto by a concurrent delivery — even one waiting for the same signal.
 * A duplicate that loses the race also never consumes a LATER occurrence of the same wait,
 * when a loop brings the instance back to it before the duplicate's claim runs.
 */
const SIGNAL_NAME = 'approval'

function buildTwoWaitSignalDefinitionPayload(timestamp: number) {
  const id = `qa-wf-signal-two-wait-${timestamp}`
  return {
    workflowId: id,
    workflowName: `QA Two-Wait Signal Workflow ${timestamp}`,
    description: `Integration test definition ${id}`,
    version: 1,
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        { stepId: 'wait1', stepName: 'First Wait', stepType: 'WAIT_FOR_SIGNAL', signalConfig: { signalName: SIGNAL_NAME } },
        { stepId: 'wait2', stepName: 'Second Wait', stepType: 'WAIT_FOR_SIGNAL', signalConfig: { signalName: SIGNAL_NAME } },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: [
        { transitionId: 'start-to-wait1', fromStepId: 'start', toStepId: 'wait1', trigger: 'auto' },
        { transitionId: 'wait1-to-wait2', fromStepId: 'wait1', toStepId: 'wait2', trigger: 'auto' },
        { transitionId: 'wait2-to-end', fromStepId: 'wait2', toStepId: 'end', trigger: 'auto' },
      ],
    },
    enabled: true,
  }
}

function buildLoopingSignalDefinitionPayload(timestamp: number) {
  const id = `qa-wf-signal-loop-${timestamp}`
  return {
    workflowId: id,
    workflowName: `QA Looping Signal Workflow ${timestamp}`,
    description: `Integration test definition ${id}`,
    version: 1,
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        { stepId: 'wait', stepName: 'Wait', stepType: 'WAIT_FOR_SIGNAL', signalConfig: { signalName: SIGNAL_NAME } },
        { stepId: 'process', stepName: 'Process', stepType: 'AUTOMATED' },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: [
        { transitionId: 'start-to-wait', fromStepId: 'start', toStepId: 'wait', trigger: 'auto' },
        { transitionId: 'wait-to-process', fromStepId: 'wait', toStepId: 'process', trigger: 'auto' },
        { transitionId: 'process-to-wait', fromStepId: 'process', toStepId: 'wait', trigger: 'auto', priority: 10 },
        { transitionId: 'process-to-end', fromStepId: 'process', toStepId: 'end', trigger: 'manual' },
      ],
    },
    enabled: true,
  }
}

async function countSignalReceived(request: APIRequestContext, token: string, instanceId: string): Promise<number> {
  const events = await listWorkflowInstanceEvents(request, token, instanceId, { eventType: 'SIGNAL_RECEIVED' })
  return events.length
}

test.describe('TC-WF-066: concurrent signal delivery (#7185)', () => {
  test('ten concurrent direct signals advance a paused instance exactly once', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const timestamp = Date.now()
    const defPayload = buildSignalDefinitionPayload(timestamp, SIGNAL_NAME, '-concurrent')
    let definitionId: string | null = null
    let instanceId: string | null = null

    try {
      definitionId = await createWorkflowDefinitionFixture(request, token, defPayload)
      instanceId = await startWorkflowInstanceFixture(request, token, {
        workflowId: defPayload.workflowId,
        correlationKey: `qa-concurrent-direct-${timestamp}`,
      })
      const paused = await pollWorkflowInstance(request, token, instanceId, (i) => i.status === 'PAUSED')
      expect(paused?.currentStepId).toBe('wait')

      const targetId = instanceId
      const responses = await Promise.all(
        Array.from({ length: 10 }, () =>
          apiRequest(request, 'POST', `/api/workflows/instances/${encodeURIComponent(targetId)}/signal`, {
            token,
            data: { signalName: SIGNAL_NAME, payload: { decidedBy: 'qa' } },
          }),
        ),
      )
      const statuses = responses.map((response) => response.status())
      expect(statuses.filter((status) => status === 200), `exactly one delivery wins (got ${statuses.join(',')})`).toHaveLength(1)
      expect(statuses.filter((status) => status === 409), `every duplicate is refused with 409 (got ${statuses.join(',')})`).toHaveLength(9)

      const completed = await pollWorkflowInstance(request, token, instanceId, (i) => i.status === 'COMPLETED')
      expect(completed?.status).toBe('COMPLETED')
      expect(await countSignalReceived(request, token, instanceId), 'one SIGNAL_RECEIVED event').toBe(1)
      instanceId = null
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })

  test('three concurrent correlation fan-outs advance each instance past one same-signal wait only', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const timestamp = Date.now()
    const defPayload = buildTwoWaitSignalDefinitionPayload(timestamp)
    const correlationKey = `qa-concurrent-fanout-${timestamp}`
    let definitionId: string | null = null
    const instanceIds: string[] = []

    try {
      definitionId = await createWorkflowDefinitionFixture(request, token, defPayload)
      for (let index = 0; index < 2; index += 1) {
        instanceIds.push(await startWorkflowInstanceFixture(request, token, { workflowId: defPayload.workflowId, correlationKey }))
      }
      for (const id of instanceIds) {
        const paused = await pollWorkflowInstance(request, token, id, (i) => i.status === 'PAUSED' && i.currentStepId === 'wait1')
        expect(paused?.currentStepId).toBe('wait1')
      }

      const responses = await Promise.all(
        Array.from({ length: 3 }, () =>
          apiRequest(request, 'POST', '/api/workflows/signals', {
            token,
            data: { correlationKey, signalName: SIGNAL_NAME },
          }),
        ),
      )
      const bodies: Array<{ count?: number; failures?: Array<{ instanceId?: string; code?: string }> } | null> = []
      for (const response of responses) {
        expect(response.status(), `correlation signal should return 200 (got ${response.status()})`).toBe(200)
        bodies.push(await readJsonSafe(response))
      }

      const advanced = bodies.reduce((sum, body) => sum + (body?.count ?? 0), 0)
      expect(advanced, 'each instance is advanced by exactly one fan-out').toBe(2)
      const failures = bodies.flatMap((body) => body?.failures ?? [])
      for (const failure of failures) {
        expect(failure.code, 'duplicate deliveries are reported as WORKFLOW_NOT_PAUSED').toBe('WORKFLOW_NOT_PAUSED')
        expect(instanceIds).toContain(failure.instanceId)
      }

      for (const id of instanceIds) {
        const parked = await pollWorkflowInstance(request, token, id, (i) => i.status === 'PAUSED' && i.currentStepId === 'wait2')
        expect(parked?.currentStepId, 'the instance parks on the second wait, not past it').toBe('wait2')
        expect(await countSignalReceived(request, token, id), `instance ${id} received the signal once`).toBe(1)
      }
    } finally {
      for (const id of instanceIds) await cancelWorkflowInstanceIfExists(request, token, id)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })

  test('concurrent duplicates never consume the next occurrence of a same-step loop wait', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const timestamp = Date.now()
    const defPayload = buildLoopingSignalDefinitionPayload(timestamp)
    let definitionId: string | null = null
    let instanceId: string | null = null

    try {
      definitionId = await createWorkflowDefinitionFixture(request, token, defPayload)
      instanceId = await startWorkflowInstanceFixture(request, token, {
        workflowId: defPayload.workflowId,
        correlationKey: `qa-concurrent-loop-${timestamp}`,
      })
      const paused = await pollWorkflowInstance(request, token, instanceId, (i) => i.status === 'PAUSED' && i.currentStepId === 'wait')
      expect(paused?.currentStepId).toBe('wait')

      const targetId = instanceId
      const responses = await Promise.all(
        Array.from({ length: 10 }, () =>
          apiRequest(request, 'POST', `/api/workflows/instances/${encodeURIComponent(targetId)}/signal`, {
            token,
            data: { signalName: SIGNAL_NAME, payload: { decidedBy: 'qa' } },
          }),
        ),
      )
      const statuses = responses.map((response) => response.status())
      expect(statuses.filter((status) => status === 200), `exactly one delivery wins (got ${statuses.join(',')})`).toHaveLength(1)
      expect(statuses.filter((status) => status === 409), `every duplicate is refused with 409 (got ${statuses.join(',')})`).toHaveLength(9)

      const reparked = await pollWorkflowInstance(request, token, instanceId, (i) => i.status === 'PAUSED' && i.currentStepId === 'wait')
      expect(reparked?.currentStepId, 'the loop parks the instance on the same wait again').toBe('wait')
      expect(await countSignalReceived(request, token, instanceId), 'the new occurrence of the wait is still open').toBe(1)
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })
})
