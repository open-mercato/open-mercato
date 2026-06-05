import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'
import {
  buildWorkflowPayload,
  parseWorkflowToFormValues,
  defaultFormValues,
  type WorkflowDefinitionFormValues,
} from '../components/formConfig'

// Regression for issue #2503: the Workflow Definition CrudForm declares its
// Category/Tags/Icon fields with dot-path ids (`metadata.category`, `.tags`,
// `.icon`). CrudForm only collapses dot-paths for injected/custom fields, so
// these base fields are carried as flat keys. Previously the form helpers wrote
// them into a nested `metadata` object the inputs never read, so the values
// silently failed to load and edits were stripped before reaching the API.
//
// This test exercises the real form-mapping helpers against the live API to
// prove the full round trip: form values -> POST -> GET -> hydrated form values
// (load) and edited form values -> PUT -> GET (save).

type WorkflowDefinitionRecord = {
  id: string
  workflowId: string
  workflowName: string
  version: number
  definition: Record<string, unknown>
  metadata?: { tags?: string[]; category?: string; icon?: string } | null
}

function buildFormValues(timestamp: number): WorkflowDefinitionFormValues {
  return {
    ...defaultFormValues,
    workflowId: `qa-wf-metadata-${timestamp}`,
    workflowName: `QA Metadata Workflow ${timestamp}`,
    description: 'Workflow used to validate metadata.* persistence (issue #2503)',
    version: 1,
    'metadata.category': 'Sales',
    'metadata.tags': ['sales', 'orders', 'invoicing'],
    'metadata.icon': 'shopping-cart',
    steps: [
      { stepId: 'start', stepName: 'Start', stepType: 'START' },
      { stepId: 'end', stepName: 'End', stepType: 'END' },
    ],
    transitions: [
      {
        transitionId: 'start_to_end',
        fromStepId: 'start',
        toStepId: 'end',
        trigger: 'auto',
        priority: 10,
      },
    ],
  }
}

async function deleteWorkflowDefinitionIfExists(
  request: APIRequestContext,
  token: string | null,
  id: string | null,
) {
  if (!token || !id) return
  try {
    await apiRequest(request, 'DELETE', `/api/workflows/definitions/${id}`, { token })
  } catch {
    return
  }
}

async function fetchDefinition(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<WorkflowDefinitionRecord> {
  const response = await apiRequest(request, 'GET', `/api/workflows/definitions/${id}`, { token })
  const body = await readJsonSafe<{ data?: WorkflowDefinitionRecord; error?: string }>(response)
  expect(response.status(), `Fetch definition failed: ${JSON.stringify(body)}`).toBe(200)
  expect(body?.data).toBeTruthy()
  return body!.data!
}

test.describe('TC-WF-014: Workflow Definition metadata.* load/save round trip (#2503)', () => {
  test('persists and hydrates Category/Tags/Icon through the form helpers', async ({ request }) => {
    const timestamp = Date.now()
    const formValues = buildFormValues(timestamp)

    let token: string | null = null
    let definitionId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')

      // --- Create: form values -> payload -> POST ---
      const createPayload = buildWorkflowPayload(formValues)
      // The helper must collapse the flat dot-path keys into nested metadata.
      expect(createPayload.metadata).toEqual({
        tags: ['sales', 'orders', 'invoicing'],
        category: 'Sales',
        icon: 'shopping-cart',
      })

      const createResponse = await apiRequest(request, 'POST', '/api/workflows/definitions', {
        token,
        data: createPayload,
      })
      const createBody = await readJsonSafe<{ data?: WorkflowDefinitionRecord; error?: string }>(createResponse)
      expect(
        createResponse.status(),
        `Definition creation failed: ${JSON.stringify(createBody)}`,
      ).toBe(201)
      definitionId = createBody?.data?.id ?? null
      expect(definitionId).toBeTruthy()
      // Save side on create must reach the server intact.
      expect(createBody?.data?.metadata).toEqual({
        tags: ['sales', 'orders', 'invoicing'],
        category: 'Sales',
        icon: 'shopping-cart',
      })

      // --- Load: GET -> parseWorkflowToFormValues must hydrate the flat keys ---
      const created = await fetchDefinition(request, token, definitionId!)
      const hydrated = parseWorkflowToFormValues(created)
      expect(hydrated['metadata.category']).toBe('Sales')
      expect(hydrated['metadata.tags']).toEqual(['sales', 'orders', 'invoicing'])
      expect(hydrated['metadata.icon']).toBe('shopping-cart')

      // --- Edit: change category via the flat key the input writes, then PUT ---
      const editedValues: WorkflowDefinitionFormValues = {
        ...hydrated,
        workflowName: `${formValues.workflowName} (edited)`,
        'metadata.category': 'qa-category-2503',
      }
      const updatePayload = buildWorkflowPayload(editedValues)
      const updateResponse = await apiRequest(
        request,
        'PUT',
        `/api/workflows/definitions/${definitionId}`,
        { token, data: updatePayload },
      )
      const updateBody = await readJsonSafe<{ data?: WorkflowDefinitionRecord; error?: string }>(updateResponse)
      expect(
        updateResponse.status(),
        `Definition update failed: ${JSON.stringify(updateBody)}`,
      ).toBe(200)

      // --- Verify save: GET -> edited category persisted, tags/icon preserved ---
      const updated = await fetchDefinition(request, token, definitionId!)
      expect(updated.workflowName).toBe(`${formValues.workflowName} (edited)`)
      expect(updated.metadata?.category).toBe('qa-category-2503')
      expect(updated.metadata?.tags).toEqual(['sales', 'orders', 'invoicing'])
      expect(updated.metadata?.icon).toBe('shopping-cart')

      // Re-hydrating the updated record must show the edited value (load again).
      const rehydrated = parseWorkflowToFormValues(updated)
      expect(rehydrated['metadata.category']).toBe('qa-category-2503')
    } finally {
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })
})
