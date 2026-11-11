import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import {
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  findInstanceUserTask,
  getWorkflowInstanceSnapshot,
  listWorkflowInstanceEvents,
  pollWorkflowInstance,
  startWorkflowInstanceFixture,
  type UserTaskSnapshot,
} from '@open-mercato/core/modules/core/__integration__/helpers/workflowsFixtures'

/**
 * TC-WF-064: a user task must not advance a run that has ended.
 *
 * Cancelling a run used to leave its open task listed and completable, and
 * completing it wrote the form into the cancelled run's context and drove the
 * run onward. Cancelling now closes the run's open tasks, so the task leaves
 * the open-task list and a completion finds nothing to complete.
 *
 * A FAILED run keeps its open task, because a retry resumes against it. While
 * the run is failed the completion is refused with nothing written; after the
 * retry the same task completes. No API call leaves an open task on a closed
 * run (an operator advance past the task leaves the run PAUSED), so the row is
 * forced into FAILED the way TC-WF-026 does.
 *
 * The positive control keeps the refusals honest: the same definition, left
 * alone, completes its task and finishes.
 */

const ALL_TASK_STATUSES = 'PENDING,IN_PROGRESS,COMPLETED,CANCELLED,ESCALATED'
const OPEN_TASK_STATUSES = 'PENDING,IN_PROGRESS'

function buildDefinition(workflowId: string, assignedUserId: string) {
  return {
    workflowId,
    workflowName: `QA TC-WF-064 ${workflowId}`,
    description: `Integration test definition ${workflowId}`,
    version: 1,
    enabled: true,
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        {
          stepId: 'review',
          stepName: 'Review',
          stepType: 'USER_TASK',
          userTaskConfig: { assignedTo: assignedUserId },
        },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: [
        { transitionId: 'start-to-review', fromStepId: 'start', toStepId: 'review', trigger: 'auto' },
        { transitionId: 'review-to-end', fromStepId: 'review', toStepId: 'end', trigger: 'auto' },
      ],
    },
  }
}

async function listInstanceTasks(
  request: APIRequestContext,
  token: string,
  instanceId: string,
  statuses: string,
): Promise<UserTaskSnapshot[]> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/workflows/tasks?workflowInstanceId=${encodeURIComponent(instanceId)}&status=${statuses}`,
    { token },
  )
  expect(response.status(), 'listing the tasks of the instance should return 200').toBe(200)
  const body = await readJsonSafe<{ data?: UserTaskSnapshot[] }>(response)
  return body?.data ?? []
}

async function completeTask(
  request: APIRequestContext,
  token: string,
  taskId: string,
  formData: Record<string, unknown>,
) {
  const response = await apiRequest(
    request,
    'POST',
    `/api/workflows/tasks/${encodeURIComponent(taskId)}/complete`,
    { token, data: { formData } },
  )
  const body = await readJsonSafe<{ error?: string; code?: string }>(response)
  return { status: response.status(), body }
}

test.describe('TC-WF-064: user task on a run that has ended', () => {
  test('cancelling a run closes its open task, and the task can no longer be completed', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const callerUserId = getTokenScope(token).userId
    const workflowId = `qa-wf-064-cancel-${Date.now()}`

    let definitionId: string | null = null
    let instanceId: string | null = null
    try {
      definitionId = await createWorkflowDefinitionFixture(request, token, buildDefinition(workflowId, callerUserId))
      instanceId = await startWorkflowInstanceFixture(request, token, { workflowId, initialContext: {} })

      const task = await findInstanceUserTask(request, token, instanceId)
      expect(task?.id, 'the run should park on its user task').toBeTruthy()
      const taskId = task!.id!
      await pollWorkflowInstance(request, token, instanceId, (instance) => instance.status === 'PAUSED')

      const cancelResponse = await apiRequest(
        request,
        'POST',
        `/api/workflows/instances/${encodeURIComponent(instanceId)}/cancel`,
        { token },
      )
      expect(cancelResponse.status(), 'cancel should succeed on a paused run').toBe(200)

      const cancelled = await getWorkflowInstanceSnapshot(request, token, instanceId)
      expect(cancelled?.status).toBe('CANCELLED')
      expect(cancelled?.currentStepId).toBe('review')

      const tasksAfterCancel = await listInstanceTasks(request, token, instanceId, ALL_TASK_STATUSES)
      expect(
        tasksAfterCancel.map((row) => ({ id: row.id, status: row.status })),
        'cancelling the run must close its open task',
      ).toEqual([{ id: taskId, status: 'CANCELLED' }])

      const cancelledTaskEvents = await listWorkflowInstanceEvents(request, token, instanceId, {
        eventType: 'USER_TASK_CANCELLED',
      })
      expect(cancelledTaskEvents, 'closing the task must be logged').toHaveLength(1)
      expect(cancelledTaskEvents[0]?.eventData).toMatchObject({ taskId, reason: 'workflow-cancelled' })

      const openTasks = await listInstanceTasks(request, token, instanceId, OPEN_TASK_STATUSES)
      expect(openTasks, 'a closed task must leave the open-task list').toEqual([])

      const completion = await completeTask(request, token, taskId, { staleSubmission: true })
      expect(
        completion.status,
        `completing a task of a cancelled run finds no open task (body: ${JSON.stringify(completion.body)})`,
      ).toBe(404)

      const after = await getWorkflowInstanceSnapshot(request, token, instanceId)
      expect(after?.status, 'the run must stay cancelled').toBe('CANCELLED')
      expect(after?.currentStepId, 'the cursor must not move').toBe('review')
      expect(after?.context ?? {}, 'the submitted form must not reach the run context').not.toHaveProperty(
        'staleSubmission',
      )

      const tasksAfterRefusal = await listInstanceTasks(request, token, instanceId, ALL_TASK_STATUSES)
      expect(
        tasksAfterRefusal.map((row) => ({ id: row.id, status: row.status })),
        'no task may be completed or created by the refused completion',
      ).toEqual([{ id: taskId, status: 'CANCELLED' }])

      const completedEvents = await listWorkflowInstanceEvents(request, token, instanceId, {
        eventType: 'USER_TASK_COMPLETED',
      })
      expect(completedEvents, 'a refused completion must not be logged as one').toHaveLength(0)
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })

  test('a failed run refuses the completion untouched, and accepts it again after a retry', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const callerUserId = getTokenScope(token).userId
    const workflowId = `qa-wf-064-failed-${Date.now()}`

    let definitionId: string | null = null
    let instanceId: string | null = null
    try {
      definitionId = await createWorkflowDefinitionFixture(request, token, buildDefinition(workflowId, callerUserId))
      instanceId = await startWorkflowInstanceFixture(request, token, { workflowId, initialContext: {} })

      const task = await findInstanceUserTask(request, token, instanceId)
      expect(task?.id, 'the run should park on its user task').toBeTruthy()
      const taskId = task!.id!
      await pollWorkflowInstance(request, token, instanceId, (instance) => instance.status === 'PAUSED')

      const failedInstanceId = instanceId
      await withClient(async (client) => {
        await client.query(
          "update workflow_instances set status = 'FAILED', outcome = 'failure', retry_count = 0, error_message = '[qa] forced failure', error_details = null, updated_at = now() where id = $1",
          [failedInstanceId],
        )
      })

      const refused = await completeTask(request, token, taskId, { staleSubmission: true })
      expect(
        refused.status,
        `completing a task of a failed run should be a conflict (body: ${JSON.stringify(refused.body)})`,
      ).toBe(409)
      expect(refused.body?.code).toBe('WORKFLOW_NOT_ACTIVE')

      const afterRefusal = await getWorkflowInstanceSnapshot(request, token, instanceId)
      expect(afterRefusal?.status, 'the run must stay failed').toBe('FAILED')
      expect(afterRefusal?.currentStepId, 'the cursor must not move').toBe('review')
      expect(afterRefusal?.context ?? {}, 'the submitted form must not reach the run context').not.toHaveProperty(
        'staleSubmission',
      )

      const tasksAfterRefusal = await listInstanceTasks(request, token, instanceId, ALL_TASK_STATUSES)
      expect(
        tasksAfterRefusal.map((row) => ({ id: row.id, status: row.status })),
        'the task must stay open for a retry',
      ).toEqual([{ id: taskId, status: 'PENDING' }])
      expect(tasksAfterRefusal[0]?.formData ?? null, 'the refused form must not be stored on the task').toBeNull()

      const eventsAfterRefusal = await listWorkflowInstanceEvents(request, token, instanceId, {
        eventType: 'USER_TASK_COMPLETED',
      })
      expect(eventsAfterRefusal, 'a refused completion must not be logged as one').toHaveLength(0)

      const retryResponse = await apiRequest(
        request,
        'POST',
        `/api/workflows/instances/${encodeURIComponent(instanceId)}/retry`,
        { token },
      )
      expect(retryResponse.status(), 'retry should accept the failed run').toBe(200)
      await pollWorkflowInstance(request, token, instanceId, (instance) => instance.status !== 'FAILED')

      const tasksAfterRetry = await listInstanceTasks(request, token, instanceId, ALL_TASK_STATUSES)
      expect(
        tasksAfterRetry.map((row) => ({ id: row.id, status: row.status })),
        'the retry resumes against the same open task',
      ).toEqual([{ id: taskId, status: 'PENDING' }])

      const accepted = await completeTask(request, token, taskId, { retriedSubmission: true })
      expect(
        accepted.status,
        `the same task completes once the run is live again (body: ${JSON.stringify(accepted.body)})`,
      ).toBe(200)

      const finished = await pollWorkflowInstance(
        request,
        token,
        instanceId,
        (instance) => instance.status === 'COMPLETED',
      )
      expect(finished?.currentStepId).toBe('end')
      expect(finished?.context ?? {}).toMatchObject({ retriedSubmission: true })
      expect(finished?.context ?? {}).not.toHaveProperty('staleSubmission')
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })

  test('positive control: a live run completes its task and finishes', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const callerUserId = getTokenScope(token).userId
    const workflowId = `qa-wf-064-live-${Date.now()}`

    let definitionId: string | null = null
    let instanceId: string | null = null
    try {
      definitionId = await createWorkflowDefinitionFixture(request, token, buildDefinition(workflowId, callerUserId))
      instanceId = await startWorkflowInstanceFixture(request, token, { workflowId, initialContext: {} })

      const task = await findInstanceUserTask(request, token, instanceId)
      expect(task?.id, 'the run should park on its user task').toBeTruthy()
      const taskId = task!.id!
      await pollWorkflowInstance(request, token, instanceId, (instance) => instance.status === 'PAUSED')

      const completion = await completeTask(request, token, taskId, { liveSubmission: true })
      expect(
        completion.status,
        `completing a task of a live run should succeed (body: ${JSON.stringify(completion.body)})`,
      ).toBe(200)

      const finished = await pollWorkflowInstance(
        request,
        token,
        instanceId,
        (instance) => instance.status === 'COMPLETED',
      )
      expect(finished?.status).toBe('COMPLETED')
      expect(finished?.currentStepId).toBe('end')
      expect(finished?.context ?? {}, 'the submitted form reaches the run context').toMatchObject({
        liveSubmission: true,
      })

      const tasks = await listInstanceTasks(request, token, instanceId, ALL_TASK_STATUSES)
      expect(tasks.map((row) => ({ id: row.id, status: row.status }))).toEqual([
        { id: taskId, status: 'COMPLETED' },
      ])
      expect(tasks[0]?.formData).toMatchObject({ liveSubmission: true })

      const completedEvents = await listWorkflowInstanceEvents(request, token, instanceId, {
        eventType: 'USER_TASK_COMPLETED',
      })
      expect(completedEvents).toHaveLength(1)
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })
})
