import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  deleteWorkflowDefinitionIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/workflowsFixtures'

/**
 * TC-WF-009: Code-Based Workflow Definitions
 *
 * Covers: code definitions in list API, code definition detail via code:<id>,
 *         customization via PUT code:<id>, reset-to-code, and source field.
 *
 * Prerequisites: The app must have code-based workflow definitions registered
 * at bootstrap (e.g., workflows.simple-approval from the workflows module).
 */

// A code workflow registered by the workflows module in workflows.ts
const CODE_WORKFLOW_ID = 'workflows.simple-approval'
const CODE_WORKFLOW_API_ID = `code:${CODE_WORKFLOW_ID}`

type DefinitionRecord = {
  id: string
  workflowId: string
  workflowName: string
  description?: string | null
  version: number
  definition: Record<string, unknown>
  enabled: boolean
  source?: string
  isCodeBased?: boolean
  codeModuleId?: string
}

type ListResponse = {
  data?: DefinitionRecord[]
  pagination?: { total?: number }
}

type DetailResponse = {
  data?: DefinitionRecord
  message?: string
}

async function findCodeDefinitionInList(
  request: APIRequestContext,
  token: string,
  workflowId: string,
): Promise<DefinitionRecord | undefined> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/workflows/definitions?workflowId=${encodeURIComponent(workflowId)}`,
    { token },
  )
  expect(response.status()).toBe(200)
  const body = await readJsonSafe<ListResponse>(response)
  return body?.data?.find((d) => d.workflowId === workflowId)
}

test.describe('TC-WF-009: Code-Based Workflow Definitions', () => {
  test('GET list should include code-based definitions with source field', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const response = await apiRequest(
      request,
      'GET',
      '/api/workflows/definitions',
      { token },
    )
    expect(response.status()).toBe(200)
    const body = await readJsonSafe<ListResponse>(response)
    expect(body?.data).toBeDefined()

    // Find the code-based definition
    const codeDef = body?.data?.find((d) => d.workflowId === CODE_WORKFLOW_ID)
    expect(codeDef, `Code definition "${CODE_WORKFLOW_ID}" should appear in list`).toBeDefined()
    expect(codeDef?.source).toBe('code')
    expect(codeDef?.isCodeBased).toBe(true)
    expect(codeDef?.id).toBe(CODE_WORKFLOW_API_ID)
  })

  test('GET code:<workflowId> should return the code-based definition', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const response = await apiRequest(
      request,
      'GET',
      `/api/workflows/definitions/${encodeURIComponent(CODE_WORKFLOW_API_ID)}`,
      { token },
    )
    expect(response.status()).toBe(200)
    const body = await readJsonSafe<DetailResponse>(response)
    expect(body?.data?.workflowId).toBe(CODE_WORKFLOW_ID)
    expect(body?.data?.source).toBe('code')
    expect(body?.data?.isCodeBased).toBe(true)
    expect(body?.data?.id).toBe(CODE_WORKFLOW_API_ID)
    expect(body?.data?.definition).toBeDefined()
    expect(body?.data?.workflowName).toBeTruthy()
  })

  test('GET code:<unknown> should return 404', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const response = await apiRequest(
      request,
      'GET',
      `/api/workflows/definitions/${encodeURIComponent('code:nonexistent.workflow')}`,
      { token },
    )
    expect(response.status()).toBe(404)
  })

  test('PUT code:<workflowId> should create a DB override (customize)', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let overrideId: string | null = null

    try {
      // Fetch original code definition
      const originalResponse = await apiRequest(
        request,
        'GET',
        `/api/workflows/definitions/${encodeURIComponent(CODE_WORKFLOW_API_ID)}`,
        { token },
      )
      expect(originalResponse.status()).toBe(200)
      const original = await readJsonSafe<DetailResponse>(originalResponse)
      expect(original?.data?.source).toBe('code')

      // Customize: PUT with enabled=false
      const customizeResponse = await apiRequest(
        request,
        'PUT',
        `/api/workflows/definitions/${encodeURIComponent(CODE_WORKFLOW_API_ID)}`,
        {
          token,
          data: { enabled: false },
        },
      )
      expect(customizeResponse.status(), 'PUT code:<id> should return 200').toBe(200)
      const customized = await readJsonSafe<DetailResponse>(customizeResponse)
      expect(customized?.data?.source).toBe('code_override')
      expect(customized?.data?.isCodeBased).toBe(true)
      expect(customized?.data?.workflowId).toBe(CODE_WORKFLOW_ID)
      expect(customized?.data?.enabled).toBe(false)
      expect(customized?.data?.id).toBeTruthy()
      // The override gets a real UUID, not a code: prefixed ID
      expect(customized?.data?.id).not.toContain('code:')
      overrideId = customized?.data?.id ?? null

      // Verify: list shows the DB override, not the code version
      const listed = await findCodeDefinitionInList(request, token, CODE_WORKFLOW_ID)
      expect(listed, 'Override should appear in list').toBeDefined()
      expect(listed?.source).toBe('code_override')
      expect(listed?.id).toBe(overrideId)
    } finally {
      await deleteWorkflowDefinitionIfExists(request, token, overrideId)
    }
  })

  test('POST reset-to-code should delete DB override and restore code version', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let overrideId: string | null = null

    try {
      // Step 1: create an override
      const customizeResponse = await apiRequest(
        request,
        'PUT',
        `/api/workflows/definitions/${encodeURIComponent(CODE_WORKFLOW_API_ID)}`,
        {
          token,
          data: { enabled: false },
        },
      )
      expect(customizeResponse.status()).toBe(200)
      const customized = await readJsonSafe<DetailResponse>(customizeResponse)
      overrideId = customized?.data?.id ?? null
      expect(overrideId).toBeTruthy()

      // Step 2: reset to code
      const resetResponse = await apiRequest(
        request,
        'POST',
        `/api/workflows/definitions/${encodeURIComponent(overrideId!)}/reset-to-code`,
        { token },
      )
      expect(resetResponse.status(), 'POST reset-to-code should return 200').toBe(200)
      const resetBody = await readJsonSafe<DetailResponse>(resetResponse)
      expect(resetBody?.data?.source).toBe('code')
      expect(resetBody?.data?.isCodeBased).toBe(true)
      expect(resetBody?.data?.workflowId).toBe(CODE_WORKFLOW_ID)

      // Override was deleted, no need to clean up
      overrideId = null

      // Step 3: verify list shows code version again
      const listed = await findCodeDefinitionInList(request, token, CODE_WORKFLOW_ID)
      expect(listed, 'Code definition should reappear in list after reset').toBeDefined()
      expect(listed?.source).toBe('code')
    } finally {
      await deleteWorkflowDefinitionIfExists(request, token, overrideId)
    }
  })

  test('POST reset-to-code should return 400 for non-code-based definitions', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const timestamp = Date.now()
    let definitionId: string | null = null

    try {
      // Create a plain user-defined workflow
      const createResponse = await apiRequest(
        request,
        'POST',
        '/api/workflows/definitions',
        {
          token,
          data: {
            workflowId: `qa-wf-reset-${timestamp}`,
            workflowName: `QA Reset Test ${timestamp}`,
            version: 1,
            definition: {
              steps: [
                { stepId: 'start', stepName: 'Start', stepType: 'START' },
                { stepId: 'end', stepName: 'End', stepType: 'END' },
              ],
              transitions: [
                { transitionId: 'start-to-end', fromStepId: 'start', toStepId: 'end', trigger: 'auto' },
              ],
            },
            enabled: true,
          },
        },
      )
      expect(createResponse.status()).toBe(201)
      const created = await readJsonSafe<DetailResponse>(createResponse)
      definitionId = created?.data?.id ?? null

      // Try to reset — should fail
      const resetResponse = await apiRequest(
        request,
        'POST',
        `/api/workflows/definitions/${encodeURIComponent(definitionId!)}/reset-to-code`,
        { token },
      )
      expect(resetResponse.status(), 'Reset on user-created def should return 400').toBe(400)
    } finally {
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })

  test('GET list search should match code-based definitions', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    // Search by partial workflow name — "Simple Approval" is the name in the code def
    const response = await apiRequest(
      request,
      'GET',
      `/api/workflows/definitions?search=${encodeURIComponent('Simple Approval')}`,
      { token },
    )
    expect(response.status()).toBe(200)
    const body = await readJsonSafe<ListResponse>(response)
    const match = body?.data?.find((d) => d.workflowId === CODE_WORKFLOW_ID)
    expect(match, 'Code definition should be found via search').toBeDefined()
    expect(match?.source).toBe('code')
  })
})
