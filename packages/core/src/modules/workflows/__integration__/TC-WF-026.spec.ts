import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import {
  buildMinimalDefinitionPayload,
  buildSignalDefinitionPayload,
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  pollWorkflowInstance,
  startWorkflowInstanceFixture,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'

/**
 * TC-WF-026 (issue #2462 scenario TC-WF-017) [P1]: Instance retry API for failed workflows
 *
 * Surface under test: POST /api/workflows/instances/[id]/retry
 *
 * There is no API to fail a workflow deterministically, so the happy path completes a minimal
 * workflow and then forces the row into FAILED before retrying — the same approach the issue
 * sanctions ("manually set to FAILED via fixture"). The forced instance still points at its END
 * step, so the retry proves the FAILED -> RUNNING recovery and retryCount increment (re-detecting
 * END to completion), not mid-flow step re-execution. The guards confirm only FAILED instances
 * may be retried.
 */
test.describe('TC-WF-026: instance retry API (#2462)', () => {
  test('retries a failed instance, incrementing retryCount and clearing the failure', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const timestamp = Date.now()
    const defPayload = buildMinimalDefinitionPayload(timestamp, '-retry')
    let definitionId: string | null = null
    let instanceId: string | null = null

    try {
      definitionId = await createWorkflowDefinitionFixture(request, token, defPayload)
      instanceId = await startWorkflowInstanceFixture(request, token, { workflowId: defPayload.workflowId })

      // Let the minimal workflow finish, then force a FAILED state to retry from.
      await pollWorkflowInstance(request, token, instanceId, (i) => i.status === 'COMPLETED')
      await withClient(async (client) => {
        await client.query(
          "update workflow_instances set status = 'FAILED', retry_count = 0, error_message = '[qa] forced failure', error_details = null, completed_at = null, updated_at = now() where id = $1",
          [instanceId],
        )
      })

      const retryResponse = await apiRequest(
        request,
        'POST',
        `/api/workflows/instances/${encodeURIComponent(instanceId)}/retry`,
        { token },
      )
      expect(retryResponse.status(), `retry should return 200 (got ${retryResponse.status()})`).toBe(200)
      const retryBody = await readJsonSafe<{ data?: { instance?: { status?: string; retryCount?: number } } }>(retryResponse)
      expect(retryBody?.data?.instance?.retryCount, 'retryCount is incremented to 1').toBe(1)
      expect(retryBody?.data?.instance?.status, 'instance is no longer FAILED after retry').not.toBe('FAILED')

      const recovered = await pollWorkflowInstance(request, token, instanceId, (i) => i.status === 'COMPLETED')
      expect(recovered?.status, 'retried instance resumes and completes').toBe('COMPLETED')
      instanceId = null
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })

  test('rejects retry of a completed instance with 400', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const timestamp = Date.now()
    const defPayload = buildMinimalDefinitionPayload(timestamp, '-retry-completed')
    let definitionId: string | null = null
    let instanceId: string | null = null

    try {
      definitionId = await createWorkflowDefinitionFixture(request, token, defPayload)
      instanceId = await startWorkflowInstanceFixture(request, token, { workflowId: defPayload.workflowId })
      const completed = await pollWorkflowInstance(request, token, instanceId, (i) => i.status === 'COMPLETED')
      expect(completed?.status).toBe('COMPLETED')

      const retryResponse = await apiRequest(
        request,
        'POST',
        `/api/workflows/instances/${encodeURIComponent(instanceId)}/retry`,
        { token },
      )
      expect(retryResponse.status(), 'retrying a COMPLETED instance returns 400').toBe(400)
      instanceId = null
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })

  test('rejects retry of a cancelled instance with 400', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const timestamp = Date.now()
    const defPayload = buildSignalDefinitionPayload(timestamp, 'approval', '-retry-cancelled')
    let definitionId: string | null = null
    let instanceId: string | null = null

    try {
      definitionId = await createWorkflowDefinitionFixture(request, token, defPayload)
      instanceId = await startWorkflowInstanceFixture(request, token, { workflowId: defPayload.workflowId })

      // Pause at the signal step, then cancel so the instance is in a terminal CANCELLED state.
      const paused = await pollWorkflowInstance(request, token, instanceId, (i) => i.status === 'PAUSED')
      expect(paused?.status).toBe('PAUSED')
      const cancelResponse = await apiRequest(
        request,
        'POST',
        `/api/workflows/instances/${encodeURIComponent(instanceId)}/cancel`,
        { token },
      )
      expect(cancelResponse.status(), 'cancel should return 200').toBe(200)

      const retryResponse = await apiRequest(
        request,
        'POST',
        `/api/workflows/instances/${encodeURIComponent(instanceId)}/retry`,
        { token },
      )
      expect(retryResponse.status(), 'retrying a CANCELLED instance returns 400').toBe(400)
      instanceId = null
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })
})
