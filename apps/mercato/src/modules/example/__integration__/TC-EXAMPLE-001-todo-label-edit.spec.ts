import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'

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
