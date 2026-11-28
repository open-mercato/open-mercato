import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  deleteGeneralEntityIfExists,
  expectId,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  buildInspectorUserTaskDefinitionPayload,
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  startWorkflowInstanceFixture,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'

export const integrationMeta = { dependsOnModules: ['customers', 'workflows'] }

type TaskListResponse = {
  items?: Array<{ id: string; todoId: string; todoSource: string }>
  total?: number
  totalPages?: number
}

test.describe('TC-CRM-098: customer task list reports the real total in compatibility mode', () => {
  test('every page agrees on the total and together they return each live legacy and canonical task exactly once', async ({ request }) => {
    const stamp = Date.now()
    let token: string | null = null
    let personId: string | null = null
    let definitionId: string | null = null
    let instanceId: string | null = null
    const taskIds: string[] = []

    try {
      token = await getAuthToken(request, 'admin')
      const personResponse = await apiRequest(request, 'POST', '/api/customers/people', {
        token,
        data: { firstName: 'Tasks', lastName: `TC-CRM-098-${stamp}`, displayName: `QA TC-CRM-098 ${stamp}` },
      })
      expect(personResponse.ok(), `POST /api/customers/people returned ${personResponse.status()}`).toBeTruthy()
      const person = await readJsonSafe<{ id?: string; entityId?: string }>(personResponse)
      personId = expectId(person?.id ?? person?.entityId, 'person id')

      for (let index = 0; index < 6; index += 1) {
        const taskResponse = await apiRequest(request, 'POST', '/api/customers/interactions', {
          token,
          data: {
            entityId: personId,
            interactionType: 'task',
            title: `QA TC-CRM-098 task ${index} ${stamp}`,
            status: 'planned',
          },
        })
        expect(taskResponse.ok(), `POST /api/customers/interactions returned ${taskResponse.status()}`).toBeTruthy()
        const task = await readJsonSafe<{ id?: string }>(taskResponse)
        taskIds.push(expectId(task?.id, 'task id'))
      }
      await deleteGeneralEntityIfExists(request, token, '/api/customers/interactions', taskIds[5])
      const liveTaskIds = taskIds.slice(0, 5)

      const definition = buildInspectorUserTaskDefinitionPayload(stamp, {
        suffix: '-crm098',
        postTaskTrigger: 'manual',
        userTaskConfig: {
          assignedToRoles: ['admin'],
          entityBindings: [{ entityType: 'customers:person', idPath: 'context.customerId' }],
          formSchema: { properties: { outcome: { type: 'string' } } },
        },
      })
      definitionId = await createWorkflowDefinitionFixture(request, token, definition)
      instanceId = await startWorkflowInstanceFixture(request, token, {
        workflowId: definition.workflowId,
        initialContext: { customerId: personId },
      })

      const adminToken = token
      const listUrl = (page: number, pageSize: number) =>
        `/api/customers/interactions/tasks?entityId=${personId}&page=${page}&pageSize=${pageSize}`
      await expect
        .poll(async () => {
          const response = await apiRequest(request, 'GET', listUrl(1, 100), { token: adminToken })
          const body = await readJsonSafe<TaskListResponse>(response)
          return (body?.items ?? []).filter((item) => item.todoSource === 'workflows:user_task').length
        }, { message: 'the workflow task should be linked to the person', timeout: 10_000 })
        .toBe(1)

      const pages: TaskListResponse[] = []
      for (const page of [1, 2, 3]) {
        const listResponse = await apiRequest(request, 'GET', listUrl(page, 2), { token })
        expect(listResponse.ok(), `GET /api/customers/interactions/tasks returned ${listResponse.status()}`).toBeTruthy()
        pages.push((await readJsonSafe<TaskListResponse>(listResponse)) ?? {})
      }

      expect(pages.map((page) => page.total)).toEqual([6, 6, 6])
      expect(pages.map((page) => page.totalPages)).toEqual([3, 3, 3])
      expect(pages.map((page) => page.items?.length ?? 0)).toEqual([2, 2, 2])
      const listed = pages.flatMap((page) => page.items ?? [])
      expect(new Set(listed.map((item) => item.id)).size).toBe(6)
      expect(listed.filter((item) => item.todoSource === 'workflows:user_task')).toHaveLength(1)
      expect(
        listed.filter((item) => taskIds.includes(item.todoId)).map((item) => item.todoId).sort(),
      ).toEqual([...liveTaskIds].sort())
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
      for (const taskId of taskIds) {
        await deleteGeneralEntityIfExists(request, token, '/api/customers/interactions', taskId)
      }
      await deleteGeneralEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })
})
