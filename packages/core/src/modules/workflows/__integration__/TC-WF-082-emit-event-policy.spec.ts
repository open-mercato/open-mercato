import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  listWorkflowInstanceEvents,
  pollWorkflowInstance,
  startWorkflowInstanceFixture,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'

test('TC-WF-082: a workflow cannot emit an event without permission', async ({ request }) => {
  const token = await getAuthToken(request, 'admin')
  const workflowId = `qa-wf-082-${randomUUID()}`
  const activityName = 'Emit test signal'
  let definitionId: string | null = null
  let instanceId: string | null = null

  try {
    definitionId = await createWorkflowDefinitionFixture(request, token, {
      workflowId,
      workflowName: 'QA workflow event permission',
      version: 1,
      enabled: true,
      definition: {
        steps: [
          { stepId: 'start', stepName: 'Start', stepType: 'START' },
          { stepId: 'end', stepName: 'End', stepType: 'END' },
        ],
        transitions: [{
          transitionId: 'start-to-end',
          fromStepId: 'start',
          toStepId: 'end',
          trigger: 'auto',
          activities: [{
            activityId: 'emit-signal',
            activityName,
            activityType: 'EMIT_EVENT',
            config: { eventName: 'qa.workflow.unregistered_signal', payload: {} },
          }],
        }],
      },
    })
    instanceId = await startWorkflowInstanceFixture(request, token, { workflowId, initialContext: {} })

    const finished = await pollWorkflowInstance(request, token, instanceId, (instance) =>
      instance.status === 'FAILED' || instance.status === 'COMPLETED',
    )
    expect(finished?.status).toBe('FAILED')

    const failures = await listWorkflowInstanceEvents(request, token, instanceId, { eventType: 'ACTIVITY_FAILED' })
    expect(failures.flatMap((event) => event.eventData?.failedActivities ?? [])).toContainEqual(
      expect.objectContaining({
        activityName,
        activityType: 'EMIT_EVENT',
        error: expect.stringContaining('cannot emit event'),
      }),
    )
  } finally {
    await cancelWorkflowInstanceIfExists(request, token, instanceId)
    await deleteWorkflowDefinitionIfExists(request, token, definitionId)
  }
})
