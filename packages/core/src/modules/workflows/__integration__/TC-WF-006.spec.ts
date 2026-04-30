import { test, expect, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { deleteWorkflowDefinitionIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/workflowsFixtures'

async function fillText(page: Page, locator: ReturnType<Page['locator']>, value: string): Promise<void> {
  await locator.fill('')
  await locator.fill(value)
}

async function findDefinitionIdByWorkflowId(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  workflowId: string,
): Promise<string | null> {
  const res = await apiRequest(
    request,
    'GET',
    `/api/workflows/definitions?workflowId=${encodeURIComponent(workflowId)}&limit=1`,
    { token },
  ).catch(() => null)
  if (!res || res.status() !== 200) return null
  const body = await res.json().catch(() => null)
  return body?.data?.[0]?.id ?? null
}

/**
 * TC-WF-006: Create and delete a workflow definition entirely through the admin UI.
 *
 * Verifies the Create form (CrudForm with StepsEditor + TransitionsEditor) actually
 * produces a persisted definition, that the new entry surfaces on the list page,
 * and that the row-action delete flow + confirm dialog removes it.
 *
 * Every asserted interaction goes through the browser — API calls only run in the
 * finally block as a safety net if a UI step throws before the UI-level delete.
 */
test.describe('TC-WF-006: Create and delete workflow definition via UI', () => {
  test('creates a definition through the form and deletes it via row actions', async ({ page, request }) => {
    const timestamp = Date.now()
    const workflowId = `qa-wf-006-${timestamp}`
    const workflowName = `QA TC-WF-006 ${timestamp}`
    let token: string | null = null

    try {
      token = await getAuthToken(request, 'admin')

      await login(page, 'admin')
      await page.goto('/backend/definitions')
      await expect(page.getByRole('heading', { name: /workflow definitions/i })).toBeVisible()

      // Open the Create form via the list page button
      await page.getByRole('link', { name: /^create workflow$/i }).click()
      await expect(page).toHaveURL(/\/backend\/definitions\/create/)

      // Basic fields
      await fillText(page, page.getByPlaceholder('checkout_workflow'), workflowId)
      await fillText(page, page.getByPlaceholder('Enter a descriptive workflow name'), workflowName)

      // Steps: add START and END
      const addStepBtn = page.getByRole('button', { name: /^add step$/i })
      await addStepBtn.click()
      await fillText(page, page.locator('#step-0-id'), 'start')
      await fillText(page, page.locator('#step-0-name'), 'Start')
      await page.locator('#step-0-type').selectOption('START')

      await addStepBtn.click()
      await fillText(page, page.locator('#step-1-id'), 'end')
      await fillText(page, page.locator('#step-1-name'), 'End')
      await page.locator('#step-1-type').selectOption('END')

      // Transition: start → end
      await page.getByRole('button', { name: /^add transition$/i }).click()
      await fillText(page, page.locator('#transition-0-id'), 'start-to-end')
      await fillText(page, page.locator('#transition-0-name'), 'Auto advance')
      await page.locator('#transition-0-from').selectOption('start')
      await page.locator('#transition-0-to').selectOption('end')

      // Submit (two identical buttons — header + footer; click the first)
      await page.getByRole('button', { name: /^create workflow$/i }).first().click()

      // Back to list — entry should be visible
      await expect(page).toHaveURL(/\/backend\/definitions(\?|$|\/)/, { timeout: 15_000 })
      await expect(page.getByRole('heading', { name: /workflow definitions/i })).toBeVisible()

      const searchBox = page.getByPlaceholder(/search/i).first()
      if (await searchBox.isVisible().catch(() => false)) {
        await fillText(page, searchBox, workflowId)
        // Filter bar submits on Enter or via Apply button; both work in this repo
        await searchBox.press('Enter').catch(() => undefined)
      }

      const row = page.getByRole('row').filter({ hasText: workflowId })
      await expect(row).toBeVisible({ timeout: 10_000 })

      // Delete via row action menu → confirm dialog.
      // RowActions opens on pointerenter AND toggles on click, so hovering is the
      // stable way to open the menu without the click flipping it back closed.
      await row.getByRole('button', { name: /open actions/i }).hover()
      await page.getByRole('menuitem', { name: /^delete$/i }).click()

      const deleteDialog = page.getByRole('dialog', { name: /delete workflow/i })
      await expect(deleteDialog).toBeVisible()
      await deleteDialog.getByRole('button', { name: /^delete$/i }).click()

      // Row should disappear. The flash toast may be transient, so assert on row removal instead.
      await expect(page.getByRole('row').filter({ hasText: workflowId })).toHaveCount(0, { timeout: 10_000 })
    } finally {
      if (token) {
        const leftoverId = await findDefinitionIdByWorkflowId(request, token, workflowId)
        await deleteWorkflowDefinitionIfExists(request, token, leftoverId)
      }
    }
  })
})
