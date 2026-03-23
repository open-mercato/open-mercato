import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'

type WorkflowDefinitionRecord = {
  id: string
  workflowId: string
  version: number
  definition: Record<string, unknown>
  metadata?: Record<string, unknown> | null
}

function buildDefinitionPayload(timestamp: number) {
  return {
    workflowId: `qa-wf-dup-${timestamp}`,
    workflowName: `QA Duplicate Workflow ${timestamp}`,
    description: 'Workflow used to validate duplicate action integration',
    version: 1,
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        {
          stepId: 'review',
          stepName: 'Review',
          stepType: 'USER_TASK',
          userTaskConfig: {
            assignedTo: 'approver',
            slaDuration: 'PT1H',
          },
          activities: [
            {
              activityId: 'review_notify',
              activityName: 'Notify reviewer',
              activityType: 'SEND_EMAIL',
              config: {
                to: '{{context.reviewer.email}}',
                subject: 'Review needed',
                template: 'workflow_review',
              },
              async: true,
            },
          ],
        },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: [
        {
          transitionId: 'start_to_review',
          fromStepId: 'start',
          toStepId: 'review',
          trigger: 'auto',
          activities: [
            {
              activityId: 'emit_review_requested',
              activityName: 'Emit review requested',
              activityType: 'EMIT_EVENT',
              config: {
                eventType: 'qa.workflow.review.requested',
                payload: { workflow: '{{workflow.instanceId}}' },
              },
              async: true,
            },
          ],
          continueOnActivityFailure: true,
          priority: 10,
        },
        {
          transitionId: 'review_to_end',
          fromStepId: 'review',
          toStepId: 'end',
          trigger: 'manual',
          continueOnActivityFailure: true,
          priority: 20,
        },
      ],
    },
    metadata: {
      tags: ['qa', 'duplicate'],
      category: 'QA',
      icon: 'copy',
    },
    enabled: true,
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

test.describe('TC-WF-002: Duplicate Workflow Definition API flow', () => {
  test('should create copied workflowId and preserve steps/transitions/activities payload', async ({
    request,
  }) => {
    const timestamp = Date.now()
    const sourcePayload = buildDefinitionPayload(timestamp)
    const duplicatePayload = {
      ...sourcePayload,
      workflowId: `${sourcePayload.workflowId}_copy`,
    }

    let token: string | null = null
    let sourceDefinitionId: string | null = null
    let duplicateDefinitionId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')

      const sourceResponse = await apiRequest(request, 'POST', '/api/workflows/definitions', {
        token,
        data: sourcePayload,
      })
      const sourceBody = await readJsonSafe<{ data?: WorkflowDefinitionRecord; error?: string }>(sourceResponse)
      expect(
        sourceResponse.status(),
        `Source definition creation failed: ${JSON.stringify(sourceBody)}`,
      ).toBe(201)
      sourceDefinitionId = sourceBody?.data?.id ?? null
      expect(sourceDefinitionId).toBeTruthy()

      const duplicateResponse = await apiRequest(request, 'POST', '/api/workflows/definitions', {
        token,
        data: duplicatePayload,
      })
      const duplicateBody = await readJsonSafe<{ data?: WorkflowDefinitionRecord; error?: string }>(duplicateResponse)
      expect(
        duplicateResponse.status(),
        `Duplicate definition creation failed: ${JSON.stringify(duplicateBody)}`,
      ).toBe(201)

      const duplicateDefinition = duplicateBody?.data
      duplicateDefinitionId = duplicateDefinition?.id ?? null
      expect(duplicateDefinitionId).toBeTruthy()
      expect(duplicateDefinition?.workflowId).toBe(duplicatePayload.workflowId)
      expect(duplicateDefinition?.workflowId).not.toBe(sourcePayload.workflowId)
      expect(duplicateDefinition?.version).toBe(sourcePayload.version)
      expect(duplicateDefinition?.definition).toEqual(sourcePayload.definition)
      expect(duplicateDefinition?.metadata).toEqual(sourcePayload.metadata)

      const duplicateListResponse = await apiRequest(
        request,
        'GET',
        `/api/workflows/definitions?workflowId=${encodeURIComponent(duplicatePayload.workflowId)}`,
        { token },
      )
      const duplicateListBody = await readJsonSafe<{ data?: WorkflowDefinitionRecord[] }>(duplicateListResponse)
      expect(duplicateListResponse.status()).toBe(200)
      const foundDuplicate = duplicateListBody?.data?.find(
        (item) => item.id === duplicateDefinitionId,
      )
      expect(foundDuplicate).toBeTruthy()
      expect(foundDuplicate?.definition).toEqual(sourcePayload.definition)

      const duplicateAgainResponse = await apiRequest(request, 'POST', '/api/workflows/definitions', {
        token,
        data: duplicatePayload,
      })
      expect(duplicateAgainResponse.status()).toBe(409)
    } finally {
      await deleteWorkflowDefinitionIfExists(request, token, duplicateDefinitionId)
      await deleteWorkflowDefinitionIfExists(request, token, sourceDefinitionId)
    }
  })
})
