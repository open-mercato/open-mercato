import { expect, test } from '@playwright/test'
import { randomInt } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createCustomerCompanyFixture,
  createCustomerRoleFixture,
  createCustomerUserFixture,
  deleteCustomerCompanyFixture,
  deleteCustomerRoleFixture,
  deleteCustomerUserFixture,
  portalCookieHeaders,
  portalLogin,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
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
  test(`TC-WF-9142: task completion preserves context when ${shape} form keys are forged (#9142)`, async ({ request }) => {
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
        expect(await readJsonSafe<{ invalidFields?: string[] }>(rejected)).toMatchObject({ invalidFields: [field] })
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

function buildPortalTaskPayload(stamp: string, suffix: string, formSchema: unknown) {
  const id = `qa-wf-9142-portal${suffix}-${stamp}`
  return {
    workflowId: id,
    workflowName: `QA WF-9142 Portal${suffix} ${stamp}`,
    description: `Integration test definition ${id}`,
    version: 1,
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        {
          stepId: 'review',
          stepName: 'Review',
          stepType: 'USER_TASK',
          userTaskConfig: {
            assigneeKind: 'customer',
            assignedTo: '{{context.portalUserId}}',
            entityBindings: [{ entityType: 'customers:company', idPath: 'context.companyId' }],
            ...(formSchema ? { formSchema } : {}),
          },
        },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: [
        { transitionId: 'start-to-review', fromStepId: 'start', toStepId: 'review', trigger: 'auto' },
        { transitionId: 'review-to-end', fromStepId: 'review', toStepId: 'end', trigger: 'auto' },
      ],
    },
    enabled: true,
  }
}

test('TC-WF-9142: portal completion accepts only declared fields, and a schema-less task only {} (#9142)', async ({ request }) => {
  test.setTimeout(120_000)
  const token = await getAuthToken(request, 'admin')
  const { tenantId } = getTokenContext(token)
  const stamp = `${Date.now()}-${randomInt(1_000_000)}`
  let companyId: string | null = null
  let roleId: string | null = null
  let portalUserId: string | null = null
  const definitionIds: Array<string | null> = []
  const instanceIds: Array<string | null> = []

  try {
    companyId = await createCustomerCompanyFixture(request, token, `QA WF-9142 ${stamp}`)
    const role = await createCustomerRoleFixture(request, token, {
      features: ['portal.tasks.view', 'portal.tasks.complete'],
    })
    roleId = role.id
    const portalUser = await createCustomerUserFixture(request, token, {
      roleIds: [role.id],
      customerEntityId: companyId,
    })
    portalUserId = portalUser.id
    const session = await portalLogin(request, { email: portalUser.email, password: portalUser.password, tenantId })

    const startTask = async (suffix: string, formSchema: unknown) => {
      const payload = buildPortalTaskPayload(stamp, suffix, formSchema)
      definitionIds.push(await createWorkflowDefinitionFixture(request, token, payload))
      const instanceId = await startWorkflowInstanceFixture(request, token, {
        workflowId: payload.workflowId,
        initialContext: { portalUserId: portalUser.id, companyId, amount: 100 },
      })
      instanceIds.push(instanceId)
      const task = await findInstanceUserTask(request, token, instanceId, { statuses: ['PENDING'] })
      expect(task?.id, `${suffix} task is created`).toBeTruthy()
      return { instanceId, taskId: task!.id! }
    }
    const completeAsPortalUser = (taskId: string, formData: Record<string, unknown>) =>
      request.post(`/api/workflows/portal/tasks/${encodeURIComponent(taskId)}/complete`, {
        headers: { ...portalCookieHeaders(session), 'Content-Type': 'application/json' },
        data: { formData },
      })

    const declared = await startTask('-declared', { properties: { note: { type: 'string' } } })
    const beforeTask = await getUserTaskDetail(request, token, declared.taskId)
    const beforeRun = await getWorkflowInstanceSnapshot(request, token, declared.instanceId)
    for (const field of ['amount', '__result', '__decision', '_pendingAsyncActivities']) {
      const rejected = await completeAsPortalUser(declared.taskId, { note: 'reviewed', [field]: 'forged' })
      expect(rejected.status(), `portal rejects injected ${field}`).toBe(400)
      expect(await readJsonSafe<{ invalidFields?: string[] }>(rejected)).toMatchObject({ ok: false, invalidFields: [field] })
      expect(await getUserTaskDetail(request, token, declared.taskId)).toEqual(beforeTask)
      expect(await getWorkflowInstanceSnapshot(request, token, declared.instanceId)).toEqual(beforeRun)
    }
    expect((await completeAsPortalUser(declared.taskId, { note: 'reviewed' })).status()).toBe(200)
    const completed = await pollWorkflowInstance(request, token, declared.instanceId, (record) => record.status === 'COMPLETED')
    expect(completed?.context).toMatchObject({ amount: 100, note: 'reviewed' })

    const schemaless = await startTask('-schemaless', null)
    const refused = await completeAsPortalUser(schemaless.taskId, { note: 'anything' })
    expect(refused.status(), 'a task without a form schema refuses every key').toBe(400)
    expect(await readJsonSafe<{ invalidFields?: string[] }>(refused)).toMatchObject({ invalidFields: ['note'] })
    expect((await completeAsPortalUser(schemaless.taskId, {})).status(), 'and accepts empty formData').toBe(200)
  } finally {
    for (const instanceId of instanceIds) await cancelWorkflowInstanceIfExists(request, token, instanceId)
    for (const definitionId of definitionIds) await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    await deleteCustomerUserFixture(request, token, portalUserId)
    await deleteCustomerRoleFixture(request, token, roleId)
    await deleteCustomerCompanyFixture(request, token, companyId)
  }
})
