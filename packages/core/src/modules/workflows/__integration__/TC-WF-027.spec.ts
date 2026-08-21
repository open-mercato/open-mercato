import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  buildManualAdvanceDefinitionPayload,
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  pollWorkflowInstance,
  startWorkflowInstanceFixture,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'

/**
 * TC-WF-027 (issue #2462 scenario TC-WF-018) [P2]: Instance advance API for manual progression
 *
 * Surface under test: POST /api/workflows/instances/[id]/advance
 *
 * The definition (START -> mid -> END, all manual transitions) never auto-advances, so each
 * `/advance` call drives exactly one step. The advance response reports `currentStepId` from a
 * pre-auto-progress snapshot, so terminal completion is confirmed by polling.
 */
type AdvanceBody = {
  data?: {
    instance?: {
      status?: string
      currentStepId?: string
      previousStepId?: string
      transitionFired?: string
      context?: Record<string, unknown>
    }
  }
}

test.describe('TC-WF-027: instance advance API (#2462)', () => {
  test('advances a manual workflow step by step and rejects advancing a completed instance', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const timestamp = Date.now()
    const defPayload = buildManualAdvanceDefinitionPayload(timestamp)
    let definitionId: string | null = null
    let instanceId: string | null = null

    try {
      definitionId = await createWorkflowDefinitionFixture(request, token, defPayload)
      instanceId = await startWorkflowInstanceFixture(request, token, { workflowId: defPayload.workflowId })

      // Manual transitions never auto-fire, so the instance rests at START.
      const atStart = await pollWorkflowInstance(
        request,
        token,
        instanceId,
        (i) => i.status === 'RUNNING' && i.currentStepId === 'start',
      )
      expect(atStart?.currentStepId, 'instance rests at START awaiting manual advance').toBe('start')

      // Advancing to a non-existent step is rejected; the instance stays at START.
      const badTargetResponse = await apiRequest(
        request,
        'POST',
        `/api/workflows/instances/${encodeURIComponent(instanceId)}/advance`,
        { token, data: { toStepId: 'does-not-exist' } },
      )
      expect(badTargetResponse.status(), 'advancing to an invalid step returns 400').toBe(400)

      // Advance with an explicit target + context updates.
      const toMidResponse = await apiRequest(
        request,
        'POST',
        `/api/workflows/instances/${encodeURIComponent(instanceId)}/advance`,
        { token, data: { toStepId: 'mid', contextUpdates: { advancedBy: 'qa' } } },
      )
      expect(toMidResponse.status(), `advance to mid should return 200 (got ${toMidResponse.status()})`).toBe(200)
      const toMidBody = await readJsonSafe<AdvanceBody>(toMidResponse)
      expect(toMidBody?.data?.instance?.currentStepId).toBe('mid')
      expect(toMidBody?.data?.instance?.previousStepId).toBe('start')
      expect(toMidBody?.data?.instance?.transitionFired).toBe('start-to-mid')
      expect(toMidBody?.data?.instance?.context?.advancedBy, 'contextUpdates merge into the workflow context').toBe('qa')

      // Advance without a target auto-selects the only valid transition (mid -> end).
      const toEndResponse = await apiRequest(
        request,
        'POST',
        `/api/workflows/instances/${encodeURIComponent(instanceId)}/advance`,
        { token, data: {} },
      )
      expect(toEndResponse.status(), `advance to end should return 200 (got ${toEndResponse.status()})`).toBe(200)
      const toEndBody = await readJsonSafe<AdvanceBody>(toEndResponse)
      expect(toEndBody?.data?.instance?.currentStepId).toBe('end')
      expect(toEndBody?.data?.instance?.transitionFired).toBe('mid-to-end')

      // Reaching END auto-completes the instance.
      const completed = await pollWorkflowInstance(request, token, instanceId, (i) => i.status === 'COMPLETED')
      expect(completed?.status, 'instance completes after reaching END').toBe('COMPLETED')

      // Advancing a completed instance is rejected.
      const afterCompleteResponse = await apiRequest(
        request,
        'POST',
        `/api/workflows/instances/${encodeURIComponent(instanceId)}/advance`,
        { token, data: {} },
      )
      expect(afterCompleteResponse.status(), 'advancing a COMPLETED instance returns 400').toBe(400)
      instanceId = null
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })
})
