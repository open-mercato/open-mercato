import { test, expect } from '@playwright/test'
import {
  apiRequest,
  getAuthToken,
} from '@open-mercato/core/helpers/integration/api'
import { deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'

async function readTodoSeverity(request: Parameters<typeof apiRequest>[0], token: string, todoId: string): Promise<string | null> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/example/todos?ids=${encodeURIComponent(todoId)}&page=1&pageSize=1`,
    { token },
  )
  if (!response.ok()) return null
  const body = await response.json() as { items?: Array<Record<string, unknown>> }
  const item = body.items?.[0]
  if (!item) return null
  const direct = item.cf_severity
  if (typeof direct === 'string') return direct
  const customFields = item.customFields
  if (customFields && typeof customFields === 'object' && !Array.isArray(customFields)) {
    const nested = (customFields as Record<string, unknown>).severity
    if (typeof nested === 'string') return nested
  }
  return null
}

test.describe('Todo priority validation', () => {
  let adminToken: string

  test.beforeAll(async ({ request }) => {
    adminToken = await getAuthToken(request, 'admin')
  })

  test('rejects priorities above the configured max', async ({ request }) => {
    const response = await apiRequest(request, 'POST', '/api/example/todos', {
      token: adminToken,
      data: {
        title: `QA invalid priority ${Date.now()}`,
        cf_priority: 8,
        cf_severity: 'high',
      },
    })

    expect(response.status()).toBe(400)
    const body = await response.json() as {
      error?: string
      fields?: Record<string, string | undefined>
    }
    expect(body.error).toBe('Validation failed')
    expect(body.fields?.cf_priority).toBe('Priority must be <= 5')
  })

  test('accepts priorities inside the configured range', async ({ request }) => {
    let todoId: string | null = null
    try {
      const response = await apiRequest(request, 'POST', '/api/example/todos', {
        token: adminToken,
        data: {
          title: `QA valid priority ${Date.now()}`,
          cf_priority: 5,
          cf_severity: 'medium',
        },
      })

      expect(response.ok()).toBeTruthy()
      const body = await response.json() as { id?: string }
      todoId = body.id ?? null
      expect(todoId).toBeTruthy()
    } finally {
      await deleteEntityIfExists(request, adminToken, '/api/example/todos', todoId)
    }
  })

  test('shows the max-priority error on blur before submit', async ({ page }) => {
    test.slow()
    const { login } = await import('@open-mercato/core/helpers/integration/auth')
    await login(page, 'admin')
    await page.goto('/backend/todos/create', { waitUntil: 'commit' })

    const priorityField = page.locator('[data-crud-field-id="cf_priority"]').first()
    const priorityInput = priorityField.locator('input[type="number"]').first()

    await expect(priorityInput).toBeVisible()
    await priorityInput.scrollIntoViewIfNeeded()
    await priorityInput.click()
    await priorityInput.type('8')
    await page.keyboard.press('Tab')

    await expect(priorityField.getByText('Priority must be <= 5')).toBeVisible()

    await priorityInput.fill('5')
    await page.keyboard.press('Tab')

    await expect(priorityField.getByText('Priority must be <= 5')).toHaveCount(0)
  })

  test('accepts corrected priority after blur validation and creates the todo', async ({ page, request }) => {
    test.slow()
    const { login } = await import('@open-mercato/core/helpers/integration/auth')
    const title = `QA corrected priority ${Date.now()}`
    let createdIds: string[] = []

    try {
      await login(page, 'admin')
      await page.goto('/backend/todos/create', { waitUntil: 'commit' })

      const titleInput = page.locator('[data-crud-field-id="title"] input').first()
      const priorityField = page.locator('[data-crud-field-id="cf_priority"]').first()
      const priorityInput = priorityField.locator('input[type="number"]').first()
      const severityField = page.locator('[data-crud-field-id="cf_severity"]').first()
      const form = page.locator('[data-crud-field-id="title"]').first().locator('xpath=ancestor::form').first()

      const severitySelect = severityField.getByRole('combobox').first()
      await expect(severitySelect).toBeVisible()
      await expect(titleInput).toBeVisible()
      await titleInput.fill(title)
      await expect(priorityInput).toBeVisible()
      await priorityInput.scrollIntoViewIfNeeded()
      await priorityInput.click()
      await priorityInput.type('8')
      await page.keyboard.press('Tab')

      await expect(priorityField.getByText('Priority must be <= 5')).toBeVisible()

      await priorityInput.fill('5')
      await severitySelect.click()
      await page.getByRole('option', { name: 'Medium' }).click()
      await form.locator('button[type="submit"]').first().click()

      await expect(page).toHaveURL(/\/backend\/todos(?:\?.*)?$/)

      const response = await apiRequest(
        request,
        'GET',
        `/api/example/todos?title=${encodeURIComponent(title)}&page=1&pageSize=10`,
        { token: adminToken },
      )
      expect(response.ok()).toBeTruthy()
      const body = await response.json() as { items?: Array<{ id?: string | null }> }
      createdIds = (body.items ?? [])
        .map((item) => item.id)
        .filter((itemId): itemId is string => typeof itemId === 'string' && itemId.length > 0)
      expect(createdIds.length).toBeGreaterThan(0)
    } finally {
      if (createdIds.length === 0) {
        const response = await apiRequest(
          request,
          'GET',
          `/api/example/todos?title=${encodeURIComponent(title)}&page=1&pageSize=10`,
          { token: adminToken },
        )

        if (response.ok()) {
          const body = await response.json() as { items?: Array<{ id?: string | null }> }
          createdIds = (body.items ?? [])
            .map((item) => item.id)
            .filter((itemId): itemId is string => typeof itemId === 'string' && itemId.length > 0)
        }
      }

      for (const itemId of createdIds) {
        await deleteEntityIfExists(request, adminToken, '/api/example/todos', itemId)
      }
    }
  })

  test('prefills the saved severity option label on edit', async ({ page, request }) => {
    test.slow()
    const { login } = await import('@open-mercato/core/helpers/integration/auth')
    const title = `QA severity prefill ${Date.now()}`
    let todoId: string | null = null

    try {
      const response = await apiRequest(request, 'POST', '/api/example/todos', {
        token: adminToken,
        data: {
          title,
          cf_priority: 3,
          cf_severity: 'medium',
        },
      })
      expect(response.ok(), `Failed to create todo fixture: ${response.status()}`).toBeTruthy()
      const body = await response.json() as { id?: string }
      todoId = body.id ?? null
      expect(todoId).toBeTruthy()

      await expect
        .poll(() => readTodoSeverity(request, adminToken, todoId!), { timeout: 15_000 })
        .toBe('medium')

      await login(page, 'admin')
      const editUrl = `/backend/todos/${encodeURIComponent(todoId!)}/edit`
      await page.goto(editUrl, { waitUntil: 'commit' })

      await expect(page.locator('main').getByText('Edit Todo').first()).toBeVisible()
      await expect(page.locator('[data-crud-field-id="title"] input').first()).toHaveValue(title)
      const severityField = page.locator('[data-crud-field-id="cf_severity"]').first()
      const severitySelect = severityField.getByRole('combobox').first()
      await expect(severitySelect).toBeVisible()
      if (!/medium/i.test(await severitySelect.textContent() ?? '')) {
        await page.reload({ waitUntil: 'domcontentloaded' })
        await expect(page.locator('main').getByText('Edit Todo').first()).toBeVisible()
      }
      await expect(severitySelect).toContainText(/medium/i)
    } finally {
      await deleteEntityIfExists(request, adminToken, '/api/example/todos', todoId)
    }
  })
})
