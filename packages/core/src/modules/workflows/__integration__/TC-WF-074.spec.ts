import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  buildInspectorUserTaskDefinitionPayload,
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  findInstanceUserTask,
  getUserTaskDetail,
  getWorkflowInstanceSnapshot,
  pollWorkflowInstance,
  startWorkflowInstanceFixture,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'

const schemas = {
  properties: { properties: { note: { type: 'string' } } },
  fields: { fields: [{ name: 'note', type: 'text', label: 'Note' }] },
}

for (const [shape, formSchema] of Object.entries(schemas)) {
  test(`TC-WF-074: task completion preserves context when ${shape} form keys are forged (#9142)`, async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const payload = buildInspectorUserTaskDefinitionPayload(Date.now(), {
      suffix: `-completion-keys-${shape}`,
      userTaskConfig: { assignedToRoles: ['admin'], formSchema },
    })
    let definitionId: string | null = null
    let instanceId: string | null = null

    try {
      definitionId = await createWorkflowDefinitionFixture(request, token, payload)
      instanceId = await startWorkflowInstanceFixture(request, token, {
        workflowId: payload.workflowId,
        initialContext: { orderId: 'original-order', amount: 100 },
      })
      const task = await findInstanceUserTask(request, token, instanceId)
      expect(task?.id).toBeTruthy()
      const taskId = task!.id!
      const beforeTask = await getUserTaskDetail(request, token, taskId)
      const beforeRun = await getWorkflowInstanceSnapshot(request, token, instanceId)
      expect(beforeRun?.context).toMatchObject({ orderId: 'original-order', amount: 100 })

      for (const field of ['orderId', 'amount', '__result', '__park', '__decision', '_pendingAsyncActivities']) {
        const rejected = await apiRequest(request, 'POST', `/api/workflows/tasks/${taskId}/complete`, {
          token,
          data: { formData: { note: 'reviewed', [field]: 'forged' } },
        })
        expect(rejected.status(), `reject injected ${field}`).toBe(400)
        expect(await getUserTaskDetail(request, token, taskId)).toEqual(beforeTask)
        expect(await getWorkflowInstanceSnapshot(request, token, instanceId)).toEqual(beforeRun)
      }

      const accepted = await apiRequest(request, 'POST', `/api/workflows/tasks/${taskId}/complete`, {
        token,
        data: { formData: { note: 'reviewed' } },
      })
      expect(accepted.status()).toBe(200)
      expect(await getUserTaskDetail(request, token, taskId)).toMatchObject({
        status: 'COMPLETED', formData: { note: 'reviewed' },
      })
      const completed = await pollWorkflowInstance(request, token, instanceId, (record) => record.status === 'COMPLETED')
      expect(completed?.context).toMatchObject({ orderId: 'original-order', amount: 100, note: 'reviewed' })
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })
}
