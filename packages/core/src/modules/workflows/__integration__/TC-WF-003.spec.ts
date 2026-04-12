import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  buildMinimalDefinitionPayload,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/workflowsFixtures'

/**
 * TC-WF-003: Workflow Definition CRUD API
 *
 * Covers: POST, GET list, GET detail, PUT update, DELETE soft-delete
 * Routes: /api/workflows/definitions, /api/workflows/definitions/:id
 */
test.describe('TC-WF-003: Workflow Definition CRUD', () => {
  test('should create, list, get, update, and soft-delete a workflow definition', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const timestamp = Date.now()
    const payload = buildMinimalDefinitionPayload(timestamp)
    let definitionId: string | null = null

    try {
      // CREATE
      definitionId = await createWorkflowDefinitionFixture(request, token, payload)

      // LIST — filter by workflowId
      const listResponse = await apiRequest(
        request,
        'GET',
        `/api/workflows/definitions?workflowId=${encodeURIComponent(payload.workflowId)}`,
        { token },
      )
      expect(listResponse.status(), 'GET /api/workflows/definitions should return 200').toBe(200)
      const listBody = await readJsonSafe<{
        data?: Array<{ id?: string; workflowId?: string }>
        pagination?: { total?: number }
      }>(listResponse)
      expect(listBody?.data?.some((d) => d.id === definitionId), 'Created definition should appear in list').toBe(true)
      expect(listBody?.pagination?.total).toBeGreaterThanOrEqual(1)

      // GET DETAIL
      const detailResponse = await apiRequest(
        request,
        'GET',
        `/api/workflows/definitions/${encodeURIComponent(definitionId)}`,
        { token },
      )
      expect(detailResponse.status(), 'GET /api/workflows/definitions/:id should return 200').toBe(200)
      const detailBody = await readJsonSafe<{
        data?: {
          id?: string
          workflowId?: string
          workflowName?: string
          enabled?: boolean
          definition?: { steps?: unknown[]; transitions?: unknown[] }
        }
      }>(detailResponse)
      expect(detailBody?.data?.id).toBe(definitionId)
      expect(detailBody?.data?.workflowId).toBe(payload.workflowId)
      expect(detailBody?.data?.workflowName).toBe(payload.workflowName)
      expect(detailBody?.data?.enabled).toBe(true)
      expect(detailBody?.data?.definition?.steps).toHaveLength(2)
      expect(detailBody?.data?.definition?.transitions).toHaveLength(1)

      // UPDATE — disable and add a step
      const updatedDefinition = {
        ...payload.definition,
        steps: [
          ...payload.definition.steps.slice(0, 1),
          { stepId: 'middle', stepName: 'Middle Step', stepType: 'AUTOMATED' },
          ...payload.definition.steps.slice(1),
        ],
        transitions: [
          { transitionId: 'start-to-middle', fromStepId: 'start', toStepId: 'middle', trigger: 'auto' as const },
          { transitionId: 'middle-to-end', fromStepId: 'middle', toStepId: 'end', trigger: 'auto' as const },
        ],
      }
      const updateResponse = await apiRequest(
        request,
        'PUT',
        `/api/workflows/definitions/${encodeURIComponent(definitionId)}`,
        {
          token,
          data: {
            definition: updatedDefinition,
            enabled: false,
          },
        },
      )
      expect(updateResponse.status(), 'PUT /api/workflows/definitions/:id should return 200').toBe(200)
      const updateBody = await readJsonSafe<{
        data?: { enabled?: boolean; definition?: { steps?: unknown[] } }
      }>(updateResponse)
      expect(updateBody?.data?.enabled).toBe(false)
      expect(updateBody?.data?.definition?.steps).toHaveLength(3)

      // DELETE (soft)
      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/workflows/definitions/${encodeURIComponent(definitionId)}`,
        { token },
      )
      expect(deleteResponse.status(), 'DELETE /api/workflows/definitions/:id should return 200').toBe(200)

      // VERIFY — deleted definition no longer in list
      const afterDeleteList = await apiRequest(
        request,
        'GET',
        `/api/workflows/definitions?workflowId=${encodeURIComponent(payload.workflowId)}`,
        { token },
      )
      const afterDeleteBody = await readJsonSafe<{ data?: Array<{ id?: string }> }>(afterDeleteList)
      expect(
        afterDeleteBody?.data?.some((d) => d.id === definitionId),
        'Deleted definition should not appear in list',
      ).toBe(false)

      // VERIFY — deleted definition returns 404 on detail
      const afterDeleteDetail = await apiRequest(
        request,
        'GET',
        `/api/workflows/definitions/${encodeURIComponent(definitionId)}`,
        { token },
      )
      expect(afterDeleteDetail.status(), 'Deleted definition should return 404').toBe(404)

      definitionId = null
    } finally {
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })

  test('should return 409 when creating a definition with duplicate workflowId', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const timestamp = Date.now()
    const payload = buildMinimalDefinitionPayload(timestamp, '-dup')
    let definitionId: string | null = null

    try {
      definitionId = await createWorkflowDefinitionFixture(request, token, payload)

      const duplicateResponse = await apiRequest(request, 'POST', '/api/workflows/definitions', {
        token,
        data: payload,
      })
      expect(duplicateResponse.status(), 'Duplicate workflowId should return 409').toBe(409)
    } finally {
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })

  test('should return 400 for invalid definition payload', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const invalidResponse = await apiRequest(request, 'POST', '/api/workflows/definitions', {
      token,
      data: {
        workflowId: 'qa-invalid',
        workflowName: 'Invalid',
        version: 1,
        definition: {
          steps: [{ stepId: 'start', stepName: 'Start', stepType: 'START' }],
          transitions: [],
        },
      },
    })
    expect(invalidResponse.status(), 'Missing END step should return 400').toBe(400)
  })

  test('should support search filter on definitions list', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const timestamp = Date.now()
    const uniqueName = `QA-SearchTest-${timestamp}`
    const payload = {
      ...buildMinimalDefinitionPayload(timestamp, '-search'),
      workflowName: uniqueName,
    }
    let definitionId: string | null = null

    try {
      definitionId = await createWorkflowDefinitionFixture(request, token, payload)

      const searchResponse = await apiRequest(
        request,
        'GET',
        `/api/workflows/definitions?search=${encodeURIComponent('SearchTest')}`,
        { token },
      )
      expect(searchResponse.status()).toBe(200)
      const searchBody = await readJsonSafe<{ data?: Array<{ id?: string; workflowName?: string }> }>(searchResponse)
      expect(
        searchBody?.data?.some((d) => d.id === definitionId),
        'Definition should appear when searching by partial name',
      ).toBe(true)
    } finally {
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })
})
