import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  assertScalarFieldsPersisted,
  skipIfCrudFormExtensionTestsDisabled,
  type CrudRecord,
} from '@open-mercato/core/helpers/integration/crudFormPersistence'

/**
 * TC-WF-CRUDFORM-001: Workflow Definition CrudForm persists scalars + metadata.* (#2466).
 *
 * Workflows' editable CrudForm surface (#2503) is the Definition form. Unlike the
 * makeCrud surfaces in this sweep, definitions are served by a hand-written route, so
 * the contract diverges from the `?id=` collection shape `runCrudFormRoundTrip` assumes:
 *   - POST   /api/workflows/definitions        → 201 { data }
 *   - GET    /api/workflows/definitions/:id     → 200 { data }   (read-back; no ?id=/?ids= list filter)
 *   - PUT    /api/workflows/definitions/:id     → 200 { data }   (detail path, body is .strict())
 *   - DELETE /api/workflows/definitions/:id     → 200            (soft delete)
 * Responses are camelCase and the metadata.* fields round-trip nested under `metadata`:
 * `category`/`icon` (strings) plus `tags` (the multiselect array). The workflows entity
 * declares no custom fields (ce.ts is empty), so the field surface is scalars + metadata.*.
 *
 * This spec drives the canonical create → read-back → assert ALL fields → update →
 * read-back → assert → delete cycle inline against the real route, while reusing the
 * shared sweep gate (`skipIfCrudFormExtensionTestsDisabled`) and `assertScalarFieldsPersisted`.
 * It complements TC-WF-014 (the #2503 form-helper regression) by asserting the full
 * editable field set at the API contract and mutating EVERY field — including the tags
 * multiselect — on update (the PUT handler replaces `metadata` wholesale).
 *
 * Self-contained: creates its own definition and soft-deletes it in `finally`.
 * Gated by `OM_INTEGRATION_CRUDFORM_EXTENSION_TESTS_DISABLED` (default off → runs).
 */
const DEFINITIONS_PATH = '/api/workflows/definitions'

// Minimal valid graph: every definition needs a START + END step and a transition.
const MINIMAL_DEFINITION = {
  steps: [
    { stepId: 'start', stepName: 'Start', stepType: 'START' },
    { stepId: 'end', stepName: 'End', stepType: 'END' },
  ],
  transitions: [
    { transitionId: 'start_to_end', fromStepId: 'start', toStepId: 'end', trigger: 'auto', priority: 10 },
  ],
}

async function readDefinitionById(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<CrudRecord | null> {
  const response = await apiRequest(request, 'GET', `${DEFINITIONS_PATH}/${encodeURIComponent(id)}`, { token })
  expect(response.status(), `read-back workflow definition failed: ${response.status()}`).toBe(200)
  const body = await readJsonSafe<{ data?: CrudRecord }>(response)
  return body?.data ?? null
}

async function deleteDefinitionIfExists(
  request: APIRequestContext,
  token: string | null,
  id: string | null,
): Promise<void> {
  if (!token || !id) return
  await apiRequest(request, 'DELETE', `${DEFINITIONS_PATH}/${encodeURIComponent(id)}`, { token }).catch(() => undefined)
}

test.describe('TC-WF-CRUDFORM-001: Workflow Definition CrudForm persists scalars + metadata.*', () => {
  test.beforeAll(() => {
    skipIfCrudFormExtensionTestsDisabled()
  })

  test('round-trips scalars + metadata.* (category/icon strings + tags multiselect) on create and update', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const workflowId = `qa-wf-crudform-${stamp}`
    let definitionId: string | null = null

    try {
      const createPayload: CrudRecord = {
        workflowId,
        workflowName: `QA CRUDFORM Workflow ${stamp}`,
        description: 'Original workflow description',
        version: 1,
        enabled: true,
        metadata: {
          category: 'QA Sales',
          tags: ['alpha', 'beta', 'gamma'],
          icon: 'workflow',
        },
        definition: MINIMAL_DEFINITION,
      }

      const createResponse = await apiRequest(request, 'POST', DEFINITIONS_PATH, { token, data: createPayload })
      const createBody = await readJsonSafe<{ data?: CrudRecord; error?: unknown }>(createResponse)
      expect(
        createResponse.status(),
        `create workflow definition failed (${createResponse.status()}): ${JSON.stringify(createBody)}`,
      ).toBe(201)
      definitionId = expectId(createBody?.data?.id, 'create response should include a definition id')

      const afterCreate = await readDefinitionById(request, token, definitionId)
      expect(afterCreate, `created definition ${definitionId} should be readable`).toBeTruthy()
      assertScalarFieldsPersisted(
        afterCreate as CrudRecord,
        {
          workflowId,
          workflowName: `QA CRUDFORM Workflow ${stamp}`,
          description: 'Original workflow description',
          version: 1,
          enabled: true,
          metadata: { category: 'QA Sales', tags: ['alpha', 'beta', 'gamma'], icon: 'workflow' },
        },
        'after-create',
      )

      // PUT is .strict() — only schema keys allowed; the id lives in the URL, not the body.
      // workflowId is accepted but ignored (it identifies the row); metadata is replaced wholesale.
      const updatePayload: CrudRecord = {
        workflowId,
        workflowName: `QA CRUDFORM Workflow ${stamp} EDITED`,
        description: 'Updated workflow description',
        version: 1,
        enabled: false,
        metadata: {
          category: 'QA Fulfilment',
          tags: ['delta'],
          icon: 'workflow-edited',
        },
        definition: MINIMAL_DEFINITION,
      }

      const updateResponse = await apiRequest(request, 'PUT', `${DEFINITIONS_PATH}/${definitionId}`, {
        token,
        data: updatePayload,
      })
      const updateBody = await readJsonSafe<{ data?: CrudRecord; error?: unknown }>(updateResponse)
      expect(
        updateResponse.status(),
        `update workflow definition failed (${updateResponse.status()}): ${JSON.stringify(updateBody)}`,
      ).toBe(200)

      const afterUpdate = await readDefinitionById(request, token, definitionId)
      expect(afterUpdate, `updated definition ${definitionId} should be readable`).toBeTruthy()
      assertScalarFieldsPersisted(
        afterUpdate as CrudRecord,
        {
          workflowId,
          workflowName: `QA CRUDFORM Workflow ${stamp} EDITED`,
          description: 'Updated workflow description',
          version: 1,
          enabled: false,
          metadata: { category: 'QA Fulfilment', tags: ['delta'], icon: 'workflow-edited' },
        },
        'after-update',
      )
    } finally {
      await deleteDefinitionIfExists(request, token, definitionId)
    }
  })
})
