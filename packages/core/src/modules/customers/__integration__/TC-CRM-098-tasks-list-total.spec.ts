import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  deleteGeneralEntityIfExists,
  expectId,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = { dependsOnModules: ['customers'] }

type TaskListResponse = {
  items?: Array<{ id: string; todoId: string }>
  total?: number
  totalPages?: number
}

test.describe('TC-CRM-098: customer task list reports the real total in compatibility mode', () => {
  test('every page agrees on the total and together they return each task exactly once', async ({ request }) => {
    const stamp = `${Date.now()}`
    let token: string | null = null
    let personId: string | null = null
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

      for (let index = 0; index < 5; index += 1) {
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

      const pages: TaskListResponse[] = []
      for (const page of [1, 2, 3]) {
        const listResponse = await apiRequest(
          request,
          'GET',
          `/api/customers/interactions/tasks?entityId=${personId}&page=${page}&pageSize=2`,
          { token },
        )
        expect(listResponse.ok(), `GET /api/customers/interactions/tasks returned ${listResponse.status()}`).toBeTruthy()
        pages.push((await readJsonSafe<TaskListResponse>(listResponse)) ?? {})
      }

      expect(pages.map((page) => page.total)).toEqual([5, 5, 5])
      expect(pages.map((page) => page.totalPages)).toEqual([3, 3, 3])
      expect(pages.map((page) => page.items?.length ?? 0)).toEqual([2, 2, 1])
      const listedIds = pages.flatMap((page) => (page.items ?? []).map((item) => item.todoId))
      expect([...listedIds].sort()).toEqual([...taskIds].sort())
    } finally {
      for (const taskId of taskIds) {
        await deleteGeneralEntityIfExists(request, token, '/api/customers/interactions', taskId)
      }
      await deleteGeneralEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })
})
