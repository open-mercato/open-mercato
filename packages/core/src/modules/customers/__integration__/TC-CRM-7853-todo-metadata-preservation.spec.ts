import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createCompanyFixture,
  deleteEntityIfExists,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/crmFixtures'

const INTERACTION_ENTITY_ID = 'customers:customer_interaction'
const OPTIMISTIC_LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'
const DUE_AT = '2030-04-10T15:00:00.000Z'

type TodoRow = {
  id: string
  todoId: string
  todoTitle: string | null
  todoIsDone: boolean
  todoDescription: string | null
  todoPriority: number | null
  todoDueAt: string | null
  todoCustomValues: Record<string, unknown> | null
  todoUpdatedAt: string | null
}

async function readTodo(
  request: APIRequestContext,
  token: string,
  entityId: string,
  todoId: string,
): Promise<TodoRow> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/customers/todos?entityId=${encodeURIComponent(entityId)}&pageSize=100`,
    { token },
  )
  expect(response.status(), 'The task adapter should return persisted tasks').toBe(200)
  const payload = await readJsonSafe<{ items?: TodoRow[] }>(response)
  const todo = payload?.items?.find((item) => item.todoId === todoId)
  expect(todo, 'The created task should remain visible after reloading').toBeDefined()
  return todo as TodoRow
}

async function updateTodo(
  request: APIRequestContext,
  token: string,
  todo: TodoRow,
  changes: Record<string, unknown>,
): Promise<void> {
  const response = await apiRequest(request, 'PUT', '/api/customers/todos', {
    token,
    headers: todo.todoUpdatedAt ? { [OPTIMISTIC_LOCK_HEADER]: todo.todoUpdatedAt } : undefined,
    data: { id: todo.todoId, linkId: todo.id, ...changes },
  })
  expect(response.status(), 'The task adapter should accept the partial update').toBe(200)
}

for (const dueDateKey of ['due_at', 'dueAt'] as const) {
  test(`TC-CRM-7853: task completion and reopen preserve metadata with ${dueDateKey}`, async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = `${Date.now()}_${dueDateKey.toLowerCase()}`
    const fieldKey = `tc7853_note_${stamp}`
    const title = `TC-CRM-7853 task ${stamp}`
    const description = `Call the customer about renewal ${stamp}`
    let companyId: string | null = null
    let todoId: string | null = null
    let definitionCreated = false

    try {
      const definitionResponse = await apiRequest(request, 'POST', '/api/entities/definitions', {
        token,
        data: {
          entityId: INTERACTION_ENTITY_ID,
          key: fieldKey,
          kind: 'text',
          configJson: { label: `TC-CRM-7853 note ${stamp}`, validation: [] },
        },
      })
      expect(definitionResponse.status(), 'The unrelated custom field fixture should be created').toBe(200)
      definitionCreated = true

      companyId = await createCompanyFixture(request, token, `TC-CRM-7853 company ${stamp}`)
      const createResponse = await apiRequest(request, 'POST', '/api/customers/todos', {
        token,
        data: {
          entityId: companyId,
          title,
          is_done: false,
          customFields: {
            description,
            priority: 3,
            [dueDateKey]: DUE_AT,
            [fieldKey]: 'Keep this custom value',
          },
        },
      })
      test.skip(createResponse.status() === 410, 'The legacy task adapter is disabled in this environment')
      const created = await readJsonSafe<{ todoId?: string }>(createResponse)
      todoId = created?.todoId ?? null
      expect(createResponse.status(), 'The adapter should create the task').toBe(201)
      expect(todoId, 'The adapter should return the created task id').toBeTruthy()

      let todo = await readTodo(request, token, companyId, todoId as string)
      const expectedDetails = {
        todoTitle: title,
        todoDescription: description,
        todoPriority: 3,
        todoDueAt: DUE_AT,
      }
      expect(todo).toMatchObject({ ...expectedDetails, todoIsDone: false })
      expect(todo.todoCustomValues?.[fieldKey]).toBe('Keep this custom value')

      for (const isDone of [true, false]) {
        await updateTodo(request, token, todo, { is_done: isDone })
        todo = await readTodo(request, token, companyId, todoId as string)
        expect(todo).toMatchObject({ ...expectedDetails, todoIsDone: isDone })
        expect(todo.todoCustomValues?.[fieldKey]).toBe('Keep this custom value')
      }

      await updateTodo(request, token, todo, { customFields: { [fieldKey]: 'Updated custom value' } })
      todo = await readTodo(request, token, companyId, todoId as string)
      expect(todo).toMatchObject({ ...expectedDetails, todoIsDone: false })
      expect(todo.todoCustomValues?.[fieldKey]).toBe('Updated custom value')

      await updateTodo(request, token, todo, {
        customValues: { description: null, priority: null, [dueDateKey]: null },
      })
      todo = await readTodo(request, token, companyId, todoId as string)
      expect(todo).toMatchObject({
        todoTitle: title,
        todoIsDone: false,
        todoDescription: null,
        todoPriority: null,
        todoDueAt: null,
      })
      expect(todo.todoCustomValues?.[fieldKey]).toBe('Updated custom value')
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/interactions', todoId)
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
      if (definitionCreated) {
        const response = await apiRequest(request, 'DELETE', '/api/entities/definitions', {
          token,
          data: { entityId: INTERACTION_ENTITY_ID, key: fieldKey },
        })
        expect(response.ok(), 'The custom field fixture should be deleted').toBeTruthy()
      }
    }
  })
}
