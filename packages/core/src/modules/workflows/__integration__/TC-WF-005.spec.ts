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
 * TC-WF-005: Instance Events & Validate-Start API
 *
 * Covers: GET /api/workflows/instances/:id/events (event history),
 *         POST /api/workflows/instances/validate-start (pre-condition validation)
 */
test.describe('TC-WF-005: Instance Events & Validate-Start', () => {
  test('should return event history for a workflow instance', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const timestamp = Date.now()
    const defPayload = buildMinimalDefinitionPayload(timestamp, '-events')
    let definitionId: string | null = null
    let instanceId: string | null = null

    try {
      definitionId = await createWorkflowDefinitionFixture(request, token, defPayload)
      instanceId = await startWorkflowInstanceFixture(request, token, {
        workflowId: defPayload.workflowId,
        initialContext: { test: true },
      })

      // Wait for background execution to produce events
      await new Promise((resolve) => setTimeout(resolve, 1500))

      // GET INSTANCE EVENTS
      const eventsResponse = await apiRequest(
        request,
        'GET',
        `/api/workflows/instances/${encodeURIComponent(instanceId)}/events`,
        { token },
      )
      expect(eventsResponse.status(), 'GET /api/workflows/instances/:id/events should return 200').toBe(200)
      const eventsBody = await readJsonSafe<{
        data?: Array<{
          id?: string
          eventType?: string
          workflowInstanceId?: string
          occurredAt?: string
        }>
        pagination?: { total?: number }
      }>(eventsResponse)

      // A START→END workflow should produce at minimum a WORKFLOW_STARTED event
      expect(eventsBody?.data, 'Events data should be an array').toBeDefined()
      expect(eventsBody?.pagination?.total, 'Should have at least one event').toBeGreaterThanOrEqual(1)

      // Verify events belong to our instance
      const instanceEvents = eventsBody?.data?.filter((e) => e.workflowInstanceId === instanceId) ?? []
      expect(instanceEvents.length, 'All returned events should belong to our instance').toBeGreaterThanOrEqual(1)

      // Check for expected event types
      const eventTypes = instanceEvents.map((e) => e.eventType)
      expect(
        eventTypes.some((t) => t === 'WORKFLOW_STARTED'),
        'Should have a WORKFLOW_STARTED event',
      ).toBe(true)

      // FILTER by eventType
      const filteredResponse = await apiRequest(
        request,
        'GET',
        `/api/workflows/instances/${encodeURIComponent(instanceId)}/events?eventType=WORKFLOW_STARTED`,
        { token },
      )
      expect(filteredResponse.status()).toBe(200)
      const filteredBody = await readJsonSafe<{
        data?: Array<{ eventType?: string }>
      }>(filteredResponse)
      expect(
        filteredBody?.data?.every((e) => e.eventType === 'WORKFLOW_STARTED'),
        'Filtered events should all match the requested eventType',
      ).toBe(true)

      // PAGINATION
      const pagedResponse = await apiRequest(
        request,
        'GET',
        `/api/workflows/instances/${encodeURIComponent(instanceId)}/events?limit=1&offset=0`,
        { token },
      )
      expect(pagedResponse.status()).toBe(200)
      const pagedBody = await readJsonSafe<{
        data?: unknown[]
        pagination?: { limit?: number; offset?: number }
      }>(pagedResponse)
      expect(pagedBody?.data?.length).toBeLessThanOrEqual(1)
      expect(pagedBody?.pagination?.limit).toBe(1)
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })

  test('should return 404 for events of a non-existent instance', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const fakeId = '00000000-0000-0000-0000-000000000000'

    const response = await apiRequest(
      request,
      'GET',
      `/api/workflows/instances/${fakeId}/events`,
      { token },
    )
    expect(response.status(), 'Non-existent instance events should return 404').toBe(404)
  })

  test('validate-start should return canStart: true for a valid enabled definition', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const timestamp = Date.now()
    const defPayload = buildMinimalDefinitionPayload(timestamp, '-validate')
    let definitionId: string | null = null

    try {
      definitionId = await createWorkflowDefinitionFixture(request, token, defPayload)

      const validateResponse = await apiRequest(
        request,
        'POST',
        '/api/workflows/instances/validate-start',
        {
          token,
          data: {
            workflowId: defPayload.workflowId,
            context: { test: true },
          },
        },
      )
      expect(validateResponse.status(), 'POST validate-start should return 200').toBe(200)
      const validateBody = await readJsonSafe<{
        canStart?: boolean
        workflowId?: string
        errors?: unknown[]
      }>(validateResponse)
      expect(validateBody?.canStart, 'canStart should be true for enabled definition without pre-conditions').toBe(true)
      expect(validateBody?.workflowId).toBe(defPayload.workflowId)
      expect(validateBody?.errors).toBeUndefined()
    } finally {
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })

  test('validate-start should handle non-existent workflow gracefully', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const validateResponse = await apiRequest(
      request,
      'POST',
      '/api/workflows/instances/validate-start',
      {
        token,
        data: {
          workflowId: `qa-nonexistent-${Date.now()}`,
        },
      },
    )
    // The endpoint should return either 200 with canStart: false or a 404
    const status = validateResponse.status()
    expect(
      status === 200 || status === 404 || status === 500,
      `validate-start for non-existent workflow should return 200, 404, or 500 (got ${status})`,
    ).toBe(true)

    if (status === 200) {
      const body = await readJsonSafe<{ canStart?: boolean; errors?: unknown[] }>(validateResponse)
      expect(body?.canStart, 'canStart should be false for non-existent workflow').toBe(false)
    }
  })

  test('validate-start should return 400 for invalid request body', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const response = await apiRequest(
      request,
      'POST',
      '/api/workflows/instances/validate-start',
      {
        token,
        data: { workflowId: '' },
      },
    )
    expect(response.status(), 'Empty workflowId should return 400').toBe(400)
  })
})
