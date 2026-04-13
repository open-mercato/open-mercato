import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  buildMinimalDefinitionPayload,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  startWorkflowInstanceFixture,
  cancelWorkflowInstanceIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/workflowsFixtures'

/**
 * TC-WF-004: Workflow Instance Lifecycle API
 *
 * Covers: start instance, get instance, list instances, cancel instance,
 *         retry (status guard), instance status filters
 * Routes: /api/workflows/instances, /api/workflows/instances/:id,
 *         /api/workflows/instances/:id/cancel, /api/workflows/instances/:id/retry
 */
test.describe('TC-WF-004: Workflow Instance Lifecycle', () => {
  test('should start an instance, retrieve it, list it, and cancel it', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const timestamp = Date.now()
    const defPayload = buildMinimalDefinitionPayload(timestamp, '-inst')
    let definitionId: string | null = null
    let instanceId: string | null = null

    try {
      definitionId = await createWorkflowDefinitionFixture(request, token, defPayload)

      // START INSTANCE
      instanceId = await startWorkflowInstanceFixture(request, token, {
        workflowId: defPayload.workflowId,
        initialContext: { orderId: `order-${timestamp}` },
        correlationKey: `qa-corr-${timestamp}`,
        metadata: { entityType: 'order', entityId: `order-${timestamp}` },
      })

      // GET INSTANCE DETAIL
      const detailResponse = await apiRequest(
        request,
        'GET',
        `/api/workflows/instances/${encodeURIComponent(instanceId)}`,
        { token },
      )
      expect(detailResponse.status(), 'GET /api/workflows/instances/:id should return 200').toBe(200)
      const detailBody = await readJsonSafe<{
        data?: {
          id?: string
          workflowId?: string
          status?: string
          correlationKey?: string
          context?: Record<string, unknown>
        }
      }>(detailResponse)
      expect(detailBody?.data?.id).toBe(instanceId)
      expect(detailBody?.data?.workflowId).toBe(defPayload.workflowId)
      expect(detailBody?.data?.correlationKey).toBe(`qa-corr-${timestamp}`)

      // LIST INSTANCES — filter by workflowId
      const listResponse = await apiRequest(
        request,
        'GET',
        `/api/workflows/instances?workflowId=${encodeURIComponent(defPayload.workflowId)}`,
        { token },
      )
      expect(listResponse.status(), 'GET /api/workflows/instances should return 200').toBe(200)
      const listBody = await readJsonSafe<{
        data?: Array<{ id?: string }>
        pagination?: { total?: number }
      }>(listResponse)
      expect(
        listBody?.data?.some((i) => i.id === instanceId),
        'Started instance should appear in list',
      ).toBe(true)

      // LIST — filter by correlationKey
      const corrListResponse = await apiRequest(
        request,
        'GET',
        `/api/workflows/instances?correlationKey=${encodeURIComponent(`qa-corr-${timestamp}`)}`,
        { token },
      )
      expect(corrListResponse.status()).toBe(200)
      const corrListBody = await readJsonSafe<{ data?: Array<{ id?: string }> }>(corrListResponse)
      expect(corrListBody?.data?.some((i) => i.id === instanceId)).toBe(true)

      // Check the status — a minimal START→END auto workflow may already be COMPLETED
      // since execution runs in background via setImmediate
      // Allow a small poll window for the background execution to finish
      let currentStatus = detailBody?.data?.status
      if (currentStatus === 'RUNNING') {
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const pollResponse = await apiRequest(
            request,
            'GET',
            `/api/workflows/instances/${encodeURIComponent(instanceId)}`,
            { token },
          )
          const pollBody = await readJsonSafe<{ data?: { status?: string } }>(pollResponse)
          currentStatus = pollBody?.data?.status
          if (currentStatus !== 'RUNNING') break
          await new Promise((resolve) => setTimeout(resolve, 500))
        }
      }

      // CANCEL — only possible if RUNNING or PAUSED
      if (currentStatus === 'RUNNING' || currentStatus === 'PAUSED') {
        const cancelResponse = await apiRequest(
          request,
          'POST',
          `/api/workflows/instances/${encodeURIComponent(instanceId)}/cancel`,
          { token },
        )
        expect(cancelResponse.status(), 'POST cancel should return 200').toBe(200)
        const cancelBody = await readJsonSafe<{ data?: { status?: string } }>(cancelResponse)
        expect(cancelBody?.data?.status).toBe('CANCELLED')
        instanceId = null
      } else if (currentStatus === 'COMPLETED') {
        // Already completed — cancel should fail with 400
        const cancelResponse = await apiRequest(
          request,
          'POST',
          `/api/workflows/instances/${encodeURIComponent(instanceId)}/cancel`,
          { token },
        )
        expect(cancelResponse.status(), 'Cancel on COMPLETED should return 400').toBe(400)
        instanceId = null
      }
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })

  test('should return 404 when starting an instance for a non-existent definition', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const response = await apiRequest(request, 'POST', '/api/workflows/instances', {
      token,
      data: {
        workflowId: `qa-nonexistent-${Date.now()}`,
      },
    })
    expect(response.status(), 'Non-existent workflowId should return 404').toBe(404)
  })

  test('should return 400 when starting an instance for a disabled definition', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const timestamp = Date.now()
    const defPayload = { ...buildMinimalDefinitionPayload(timestamp, '-disabled'), enabled: true }
    let definitionId: string | null = null

    try {
      definitionId = await createWorkflowDefinitionFixture(request, token, defPayload)

      // Disable the definition
      const updateResponse = await apiRequest(
        request,
        'PUT',
        `/api/workflows/definitions/${encodeURIComponent(definitionId)}`,
        { token, data: { enabled: false } },
      )
      expect(updateResponse.status()).toBe(200)

      // Try to start — should fail (server returns 404 because disabled definitions
      // are excluded from the lookup, matching DEFINITION_NOT_FOUND error code)
      const startResponse = await apiRequest(request, 'POST', '/api/workflows/instances', {
        token,
        data: { workflowId: defPayload.workflowId },
      })
      expect(
        startResponse.status() === 400 || startResponse.status() === 404,
        `Disabled definition should return 400 or 404 (got ${startResponse.status()})`,
      ).toBe(true)
    } finally {
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })

  test('retry should reject non-FAILED instances', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const timestamp = Date.now()
    const defPayload = buildMinimalDefinitionPayload(timestamp, '-retry')
    let definitionId: string | null = null
    let instanceId: string | null = null

    try {
      definitionId = await createWorkflowDefinitionFixture(request, token, defPayload)
      instanceId = await startWorkflowInstanceFixture(request, token, {
        workflowId: defPayload.workflowId,
      })

      // Wait briefly for background execution
      await new Promise((resolve) => setTimeout(resolve, 1000))

      // Retry should fail because the instance is not in FAILED status
      const retryResponse = await apiRequest(
        request,
        'POST',
        `/api/workflows/instances/${encodeURIComponent(instanceId)}/retry`,
        { token },
      )
      expect(retryResponse.status(), 'Retry on non-FAILED instance should return 400').toBe(400)
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })
})
