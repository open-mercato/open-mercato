import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'
import { putWithLock } from '@open-mercato/core/helpers/integration/optimisticLockUi'

const DEFINITIONS_BASE = '/api/workflows/definitions'

type WorkflowDefinitionRecord = {
  id: string
  workflowId: string
  workflowName: string
  updatedAt: string
  definition: {
    steps: Array<{
      stepId: string
      stepType: string
      userTaskConfig?: Record<string, unknown>
    }>
    transitions: Array<Record<string, unknown>>
  }
}

function buildDefinition(role: string, formKey: string, placeholder: string) {
  return {
    steps: [
      { stepId: 'start', stepName: 'Start', stepType: 'START' },
      {
        stepId: 'initial_contact',
        stepName: 'Initial contact',
        stepType: 'USER_TASK',
        userTaskConfig: {
          assignedToRoles: [role],
          formKey,
          allowedActions: ['complete', 'cancel'],
          formSchema: {
            fields: [
              {
                name: 'conversation_summary',
                type: 'textarea',
                label: 'Conversation summary',
                required: true,
                placeholder,
                defaultValue: 'N/A',
              },
            ],
          },
        },
      },
      { stepId: 'end', stepName: 'End', stepType: 'END' },
    ],
    transitions: [
      {
        transitionId: 'start_to_initial_contact',
        fromStepId: 'start',
        toStepId: 'initial_contact',
        trigger: 'auto',
        priority: 10,
      },
      {
        transitionId: 'initial_contact_to_end',
        fromStepId: 'initial_contact',
        toStepId: 'end',
        trigger: 'manual',
        priority: 20,
      },
    ],
  }
}

async function readDefinition(
  request: APIRequestContext,
  token: string,
  definitionId: string,
): Promise<WorkflowDefinitionRecord> {
  const response = await apiRequest(request, 'GET', `${DEFINITIONS_BASE}/${encodeURIComponent(definitionId)}`, { token })
  const body = await readJsonSafe<{ data?: WorkflowDefinitionRecord; error?: unknown }>(response)
  expect(
    response.status(),
    `GET ${DEFINITIONS_BASE}/${definitionId} failed (${response.status()}): ${JSON.stringify(body)}`,
  ).toBe(200)
  const data = body?.data
  expect(data?.id, 'definition detail should include an id').toBe(definitionId)
  expect(typeof data?.updatedAt, 'definition detail should include updatedAt').toBe('string')
  return data as WorkflowDefinitionRecord
}

function expectUserTaskConfig(record: WorkflowDefinitionRecord, role: string, formKey: string, placeholder: string) {
  const userTask = record.definition.steps.find((step) => step.stepId === 'initial_contact')
  const config = userTask?.userTaskConfig
  expect(userTask?.stepType).toBe('USER_TASK')
  expect(config).toMatchObject({
    assignedToRoles: [role],
    formKey,
    allowedActions: ['complete', 'cancel'],
    formSchema: {
      fields: [
        expect.objectContaining({
          name: 'conversation_summary',
          type: 'textarea',
          label: 'Conversation summary',
          required: true,
          placeholder,
          defaultValue: 'N/A',
        }),
      ],
    },
  })
}

test.describe('TC-WF-030: workflow user task form config round-trip', () => {
  test('preserves userTaskConfig assignment, form key, actions, and field metadata on create and update', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const workflowId = `qa-wf-user-task-config-${stamp}`
    let definitionId: string | null = null

    try {
      definitionId = await createWorkflowDefinitionFixture(request, token, {
        workflowId,
        workflowName: `QA User Task Config ${stamp}`,
        version: 1,
        enabled: true,
        definition: buildDefinition(
          'Sales Representative',
          'initial_contact_form',
          'Please fill in the details of the conversation',
        ),
      })

      const afterCreate = await readDefinition(request, token, definitionId)
      expectUserTaskConfig(
        afterCreate,
        'Sales Representative',
        'initial_contact_form',
        'Please fill in the details of the conversation',
      )

      const updateResponse = await putWithLock(
        request,
        token,
        `${DEFINITIONS_BASE}/${definitionId}`,
        {
          workflowId,
          workflowName: `QA User Task Config ${stamp} updated`,
          version: 1,
          enabled: true,
          definition: buildDefinition(
            'Account Executive',
            'updated_initial_contact_form',
            'Capture the updated conversation summary',
          ),
        },
        afterCreate.updatedAt,
      )
      const updateBody = await readJsonSafe<{ data?: WorkflowDefinitionRecord; error?: unknown }>(updateResponse)
      expect(
        updateResponse.status(),
        `PUT ${DEFINITIONS_BASE}/${definitionId} failed (${updateResponse.status()}): ${JSON.stringify(updateBody)}`,
      ).toBe(200)

      const afterUpdate = await readDefinition(request, token, definitionId)
      expectUserTaskConfig(
        afterUpdate,
        'Account Executive',
        'updated_initial_contact_form',
        'Capture the updated conversation summary',
      )
    } finally {
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })
})
