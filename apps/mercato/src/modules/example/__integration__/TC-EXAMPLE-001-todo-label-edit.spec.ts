import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'

type TodoListResponse = {
  items?: Array<Record<string, unknown>>
}

type SearchResponse = {
  results?: Array<{ entityId?: unknown; recordId?: unknown }>
}

async function readTodoLabels(
  request: APIRequestContext,
  token: string,
  todoId: string,
): Promise<string[]> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/example/todos?ids=${encodeURIComponent(todoId)}&page=1&pageSize=1`,
    { token },
  )
  expect(response.ok(), `GET todo by id failed: ${response.status()}`).toBeTruthy()
  const body = await response.json() as TodoListResponse
  const labels = body.items?.[0]?.cf_labels
  return Array.isArray(labels) ? labels.map(String).sort() : []
}

async function tokenSearchContains(
  request: APIRequestContext,
  token: string,
  query: string,
  todoId: string,
): Promise<boolean> {
  const params = new URLSearchParams({
    q: query,
    limit: '10',
    strategies: 'tokens',
    entityTypes: 'example:todo',
  })
  const response = await apiRequest(request, 'GET', `/api/search/search?${params.toString()}`, { token })
  if (!response.ok()) return false
  const body = await response.json() as SearchResponse
  return (body.results ?? []).some(
    (result) => result.entityId === 'example:todo' && result.recordId === todoId,
  )
}

/**
 * Regression for PR #3236 UI QA: a one-element `multi: true` custom field must
 * stay an array in the query-index projection. This scenario is deliberately
 * valid with OM_CACHE_SAFETY_ALWAYS_CONSISTENT both OFF and ON.
 */
test.describe('TC-EXAMPLE-001: todo label hydrates and is replaceable on edit', () => {
  test('preserves empty custom fields on a notes-only save and supports explicit clearing', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenContext(token)
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) throw new Error('[internal] DATABASE_URL is required for TC-EXAMPLE-001')
    const database = new Client({ connectionString })
    await database.connect()
    let todoId: string | null = null

    async function readTodo(): Promise<Record<string, unknown>> {
      const response = await apiRequest(request, 'GET', `/api/example/todos?ids=${todoId}&pageSize=1`, { token })
      expect(response.ok()).toBeTruthy()
      const body = await response.json() as TodoListResponse
      expect(body.items).toHaveLength(1)
      return body.items![0]
    }

    async function storedSelections(): Promise<Array<Record<string, unknown>>> {
      const result = await database.query(
        `select field_key, value_text, value_multiline, value_int, value_float, value_bool
         from custom_field_values
         where entity_id = 'example:todo' and record_id = $1 and tenant_id = $2 and organization_id = $3
           and field_key in ('labels', 'assignee') and deleted_at is null
         order by field_key, value_text`,
        [todoId, tenantId, organizationId],
      )
      return result.rows
    }

    try {
      const title = `QA empty custom fields ${randomUUID()}`
      const created = await apiRequest(request, 'POST', '/api/example/todos', {
        token,
        data: {
          title, notes: 'Original notes', is_done: false,
          cf_priority: 3, cf_severity: 'medium', cf_blocked: false, cf_description: 'Keep this description',
        },
      })
      expect(created.ok()).toBeTruthy()
      todoId = (await created.json() as { id: string }).id
      const before = await readTodo()
      expect(before.cf_labels).toBeNull()
      expect(before.cf_assignee).toBeNull()
      expect(await storedSelections()).toEqual([])

      await login(page, 'admin')
      await page.goto(`/backend/todos/${todoId}/edit`, { waitUntil: 'commit' })
      const titleInput = page.locator('[data-crud-field-id="title"] input').first()
      await expect(titleInput).toHaveValue(title)
      const notesInput = page.locator('[data-crud-field-id="notes"] textarea').first()
      await expect(notesInput).toHaveValue('Original notes')
      await notesInput.fill('Only notes changed')
      const form = titleInput.locator('xpath=ancestor::form').first()
      await form.locator('button[type="submit"]').first().click()
      await expect(page).toHaveURL(/\/backend\/todos(?:\?.*)?$/)

      const after = await readTodo()
      expect(after).toEqual({ ...before, notes: 'Only notes changed', updatedAt: expect.any(String) })
      expect(after.updatedAt).not.toBe(before.updatedAt)
      expect(await storedSelections()).toEqual([])

      const populated = await apiRequest(request, 'PUT', '/api/example/todos', {
        token,
        data: {
          id: todoId, cf_labels: ['frontend'], cf_assignee: ['alice'], cf_blocked: false,
          cf_priority: after.cf_priority, cf_severity: after.cf_severity,
        },
      })
      expect(populated.ok(), `Populating selections failed: ${populated.status()}`).toBeTruthy()
      const filled = await readTodo()
      expect(filled.cf_labels).toEqual(['frontend'])
      expect(filled.cf_assignee).toEqual(['alice'])
      expect(await storedSelections()).toHaveLength(2)

      const cleared = await apiRequest(request, 'PUT', '/api/example/todos', {
        token,
        data: {
          id: todoId, cf_labels: null, cf_assignee: [], cf_blocked: false,
          cf_priority: after.cf_priority, cf_severity: after.cf_severity,
        },
      })
      expect(cleared.ok(), `Clearing selections failed: ${cleared.status()}`).toBeTruthy()
      const empty = await readTodo()
      expect(empty).toEqual({ ...after, updatedAt: expect.any(String) })
      expect(await storedSelections()).toEqual([])
    } finally {
      try {
        await deleteEntityIfExists(request, token, '/api/example/todos', todoId)
      } finally {
        await database.end()
      }
    }
  })

  test('reopens a singleton label as a tag and replaces its search token', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
    const title = `QA todo label edit ${suffix}`
    const oldLabel = `qaold${suffix}`
    const newLabel = `qanew${suffix}`
    let todoId: string | null = null

    try {
      const created = await apiRequest(request, 'POST', '/api/example/todos', {
        token,
        data: {
          title,
          cf_priority: 3,
          cf_severity: 'medium',
          cf_labels: [oldLabel],
        },
      })
      expect(created.ok(), `Failed to create todo fixture: ${created.status()}`).toBeTruthy()
      const createdBody = await created.json() as { id?: string }
      todoId = createdBody.id ?? null
      expect(todoId).toBeTruthy()

      // Projection hydration is synchronous in both modes; token indexing is
      // allowed to settle in OFF mode.
      await expect(readTodoLabels(request, token, todoId!)).resolves.toEqual([oldLabel])
      await expect
        .poll(() => tokenSearchContains(request, token, oldLabel, todoId!), { timeout: 15_000 })
        .toBe(true)

      await login(page, 'admin')
      await page.goto(`/backend/todos/${encodeURIComponent(todoId!)}/edit`, { waitUntil: 'commit' })

      const titleInput = page.locator('[data-crud-field-id="title"] input').first()
      const labelsField = page.locator('[data-crud-field-id="cf_labels"]').first()
      await expect(titleInput).toHaveValue(title)
      const oldTagRemove = labelsField.getByRole('button', { name: `Remove ${oldLabel}` })
      await expect(oldTagRemove).toBeVisible()

      await oldTagRemove.click()
      const labelsInput = labelsField.locator('input').first()
      await labelsInput.fill(newLabel)
      await labelsInput.press('Enter')
      await expect(labelsField.getByRole('button', { name: `Remove ${newLabel}` })).toBeVisible()
      await expect(labelsField.getByRole('button', { name: `Remove ${oldLabel}` })).toHaveCount(0)

      const save = page.locator('[data-crud-field-id="title"]').first().locator('xpath=ancestor::form').first()
      await save.locator('button[type="submit"]').first().click()
      await expect(page).toHaveURL(/\/backend\/todos(?:\?.*)?$/)

      await expect(readTodoLabels(request, token, todoId!)).resolves.toEqual([newLabel])
      await expect
        .poll(
          async () => ({
            old: await tokenSearchContains(request, token, oldLabel, todoId!),
            next: await tokenSearchContains(request, token, newLabel, todoId!),
          }),
          { timeout: 15_000 },
        )
        .toEqual({ old: false, next: true })
    } finally {
      await deleteEntityIfExists(request, token, '/api/example/todos', todoId)
    }
  })
})
