import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  buildSignalDefinitionPayload,
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  pollWorkflowInstance,
  startWorkflowInstanceFixture,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'

/**
 * TC-WF-025 (issue #2462 scenario TC-WF-016) [P0]: Instance signal send (direct + correlation)
 *
 * Surfaces under test:
 * - POST /api/workflows/instances/[id]/signal
 * - POST /api/workflows/signals
 *
 * The definition pauses at a WAIT_FOR_SIGNAL("approval") step; a matching signal resumes it
 * via the auto `wait -> end` transition. Instances must be polled to PAUSED before signalling
 * (they are briefly RUNNING at START while the background executor advances to the wait step).
 */
const SIGNAL_NAME = 'approval'

test.describe('TC-WF-025: instance signal send (#2462)', () => {
  test('sends a direct signal to a paused instance and rejects invalid signal states', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const timestamp = Date.now()
    const defPayload = buildSignalDefinitionPayload(timestamp, SIGNAL_NAME, '-direct')
    let definitionId: string | null = null
    let instanceId: string | null = null

    try {
      definitionId = await createWorkflowDefinitionFixture(request, token, defPayload)
      instanceId = await startWorkflowInstanceFixture(request, token, {
        workflowId: defPayload.workflowId,
        correlationKey: `qa-direct-${timestamp}`,
      })

      const paused = await pollWorkflowInstance(request, token, instanceId, (i) => i.status === 'PAUSED')
      expect(paused?.status, 'instance should pause waiting for the signal').toBe('PAUSED')
      expect(paused?.currentStepId).toBe('wait')

      // Wrong signal name → 400 (SIGNAL_NAME_MISMATCH); the instance stays paused.
      const mismatchResponse = await apiRequest(
        request,
        'POST',
        `/api/workflows/instances/${encodeURIComponent(instanceId)}/signal`,
        { token, data: { signalName: 'not-the-expected-signal' } },
      )
      expect(mismatchResponse.status(), 'a mismatched signal name returns 400').toBe(400)

      // Correct signal → 200 and the instance resumes to COMPLETED.
      const signalResponse = await apiRequest(
        request,
        'POST',
        `/api/workflows/instances/${encodeURIComponent(instanceId)}/signal`,
        { token, data: { signalName: SIGNAL_NAME, payload: { decidedBy: 'qa' } } },
      )
      expect(signalResponse.status(), `signal should return 200 (got ${signalResponse.status()})`).toBe(200)
      const signalBody = await readJsonSafe<{ success?: boolean }>(signalResponse)
      expect(signalBody?.success).toBe(true)

      const completed = await pollWorkflowInstance(request, token, instanceId, (i) => i.status === 'COMPLETED')
      expect(completed?.status, 'instance should resume past the WAIT_FOR_SIGNAL step').toBe('COMPLETED')

      // Signalling a now-terminal (non-paused) instance → 409 (WORKFLOW_NOT_PAUSED).
      const notPausedResponse = await apiRequest(
        request,
        'POST',
        `/api/workflows/instances/${encodeURIComponent(instanceId)}/signal`,
        { token, data: { signalName: SIGNAL_NAME } },
      )
      expect(notPausedResponse.status(), 'signalling a non-paused instance returns 409').toBe(409)
      instanceId = null // completed — nothing to cancel

      // Signalling a non-existent instance → 404 (INSTANCE_NOT_FOUND).
      const missingResponse = await apiRequest(
        request,
        'POST',
        `/api/workflows/instances/${encodeURIComponent('00000000-0000-4000-8000-000000000000')}/signal`,
        { token, data: { signalName: SIGNAL_NAME } },
      )
      expect(missingResponse.status(), 'signalling a missing instance returns 404').toBe(404)
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })

  test('sends a signal to all instances matching a correlation key', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const timestamp = Date.now()
    const defPayload = buildSignalDefinitionPayload(timestamp, SIGNAL_NAME, '-corr')
    const correlationKey = `qa-corr-${timestamp}`
    let definitionId: string | null = null
    let firstInstanceId: string | null = null
    let secondInstanceId: string | null = null

    try {
      definitionId = await createWorkflowDefinitionFixture(request, token, defPayload)
      firstInstanceId = await startWorkflowInstanceFixture(request, token, {
        workflowId: defPayload.workflowId,
        correlationKey,
      })
      secondInstanceId = await startWorkflowInstanceFixture(request, token, {
        workflowId: defPayload.workflowId,
        correlationKey,
      })

      const firstPaused = await pollWorkflowInstance(request, token, firstInstanceId, (i) => i.status === 'PAUSED')
      const secondPaused = await pollWorkflowInstance(request, token, secondInstanceId, (i) => i.status === 'PAUSED')
      expect(firstPaused?.status).toBe('PAUSED')
      expect(secondPaused?.status).toBe('PAUSED')

      // A correlation-key signal with no matching paused instance returns count=0 (no throw).
      const noMatchResponse = await apiRequest(request, 'POST', '/api/workflows/signals', {
        token,
        data: { correlationKey: `qa-no-match-${timestamp}`, signalName: SIGNAL_NAME },
      })
      expect(noMatchResponse.status(), 'no-match correlation signal returns 200').toBe(200)
      const noMatchBody = await readJsonSafe<{ count?: number }>(noMatchResponse)
      expect(noMatchBody?.count, 'no instances match the unused correlation key').toBe(0)

      // The real correlation signal fans out to both paused instances.
      const fanOutResponse = await apiRequest(request, 'POST', '/api/workflows/signals', {
        token,
        data: { correlationKey, signalName: SIGNAL_NAME },
      })
      expect(fanOutResponse.status(), `correlation signal should return 200 (got ${fanOutResponse.status()})`).toBe(200)
      const fanOutBody = await readJsonSafe<{ count?: number }>(fanOutResponse)
      expect(fanOutBody?.count, 'both correlated instances receive the signal').toBe(2)

      const firstCompleted = await pollWorkflowInstance(request, token, firstInstanceId, (i) => i.status === 'COMPLETED')
      const secondCompleted = await pollWorkflowInstance(request, token, secondInstanceId, (i) => i.status === 'COMPLETED')
      expect(firstCompleted?.status).toBe('COMPLETED')
      expect(secondCompleted?.status).toBe('COMPLETED')
      firstInstanceId = null
      secondInstanceId = null
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, firstInstanceId)
      await cancelWorkflowInstanceIfExists(request, token, secondInstanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })
})
