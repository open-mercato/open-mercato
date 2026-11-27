import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'

/**
 * TC-UI-FLASH-002: companion to `packages/ui/__integration__/TC-UI-FLASH-001-url-flash-browser-race.spec.ts`
 * — exercises the same primary-host flash delivery through a real
 * tenant-bound Todo record and the product's actual production CrudForm
 * save redirect, per #8709's acceptance criteria, rather than TC-UI-FLASH-001's
 * synthetic harness. Lives here (not in `packages/ui/__integration__/`) so it
 * can use `@open-mercato/core`'s integration-test helpers without adding a
 * `ui` -> `core` devDependency, which would close an existing one-way
 * workspace dependency (`core` already depends on `ui`) into a cycle.
 */
test.describe('TC-UI-FLASH-002: FlashMessages real production save redirect', () => {
  test('shows exactly one "Todo saved" toast and strips the URL after a real edit/save redirect', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const title = `QA flash redirect ${Date.now()}`
    let todoId: string | null = null

    try {
      const created = await apiRequest(request, 'POST', '/api/example/todos', {
        token,
        // `cf_priority`/`cf_severity` are required custom fields on the Todo
        // entity (apps/mercato/src/modules/example/ce.ts) — the API does not
        // backfill their `defaultValue` on create, so omitting them here
        // leaves the edit form's required-field validation blocking every
        // save silently (no navigation, no error toast).
        data: { title, cf_priority: 3, cf_severity: 'medium' },
      })
      expect(created.ok(), `Failed to create todo fixture: ${created.status()}`).toBeTruthy()
      const createdBody = (await created.json()) as { id?: string }
      todoId = createdBody.id ?? null
      expect(todoId).toBeTruthy()

      await login(page, 'admin')
      await page.goto(`/backend/todos/${encodeURIComponent(todoId!)}/edit`, { waitUntil: 'commit' })

      const titleInput = page.locator('[data-crud-field-id="title"] input').first()
      await expect(titleInput).toHaveValue(title)
      await titleInput.fill(`${title} edited`)

      const saveForm = page.locator('[data-crud-field-id="title"]').first().locator('xpath=ancestor::form').first()
      await saveForm.locator('button[type="submit"]').first().click()

      await expect(page).toHaveURL(/\/backend\/todos(?:\?.*)?$/)

      const toasts = page.locator('[data-slot="alert"]')
      await expect(toasts).toHaveCount(1)
      await expect(toasts.first()).toContainText('Todo saved')

      const currentUrl = page.url()
      expect(currentUrl).not.toContain('flash=')
      expect(currentUrl).not.toContain('type=')
    } finally {
      await deleteEntityIfExists(request, token, '/api/example/todos', todoId)
    }
  })
})
