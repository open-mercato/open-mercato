import { test, expect, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { deleteWorkflowDefinitionIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/workflowsFixtures'
import {
  openWorkflowDetailsDrawer,
  workflowStepNodes,
} from '@open-mercato/core/helpers/integration/workflowsUi'

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
 * Verifies that the Studio's create path (list → Create Workflow → template
 * gallery → canvas → Save) actually produces a persisted definition, that the new
 * entry surfaces on the list page, and that the row-action delete flow + confirm
 * dialog removes it. Retargeted from the retired form editor (spec section 10).
 *
 * Every asserted interaction goes through the browser — API calls only run in the
 * finally block as a safety net if a UI step throws before the UI-level delete.
 */
test.describe('TC-WF-006: Create and delete workflow definition via UI', () => {
  test('creates a definition in the studio and deletes it via row actions', async ({ page, request }) => {
    // A full UI round trip — login, list, template gallery, Studio boot, details
    // drawer, save, back to the list, search, row menu, confirm delete — behind
    // the shared 20s per-test budget, which several of the individual waits
    // below are already allowed to consume most of on their own. Matches the
    // budget the sibling Studio journeys (TC-WF-033/034/036/037) use.
    test.setTimeout(120_000)
    const timestamp = Date.now()
    const workflowId = `qa-wf-006-${timestamp}`
    const workflowName = `QA TC-WF-006 ${timestamp}`
    let token: string | null = null

    try {
      token = await getAuthToken(request, 'admin')

      await login(page, 'admin')
      await page.goto('/backend/definitions')
      await expect(page.getByRole('heading', { name: /workflow definitions/i })).toBeVisible()

      // Open the studio via the list page toolbar button. It opens the template
      // gallery; the empty-list state (#772 ListEmptyState) opens the same
      // gallery, so target the first (toolbar) match.
      await page.getByRole('button', { name: /^create workflow$/i }).first().click()
      const gallery = page.getByRole('dialog')
      await expect(gallery).toBeVisible({ timeout: 10_000 })
      await page.getByTestId('template-card-task-escalation').click()

      await expect(page).toHaveURL(/\/backend\/definitions\/visual-editor\?template=task-escalation/, { timeout: 15_000 })
      await expect(workflowStepNodes(page).first()).toBeVisible({ timeout: 15_000 })

      // Overwrite the template's identifiers so parallel runs cannot collide.
      // They live in the details Drawer, which starts closed.
      const drawer = await openWorkflowDetailsDrawer(page)
      await fillText(page, drawer.locator('#workflowId'), workflowId)
      await fillText(page, drawer.locator('#workflowName'), workflowName)

      // Saving keeps the author on the canvas and switches the URL into edit
      // mode. Save from inside the drawer — with it open, the header Save and
      // the drawer footer Save share an accessible name.
      await drawer.getByRole('button', { name: /^save$/i }).click()
      await expect(page).toHaveURL(/\/backend\/definitions\/visual-editor\?id=[0-9a-f-]{36}/i, { timeout: 15_000 })

      // Back to the list — the entry should be visible
      await page.goto('/backend/definitions')
      await expect(page.getByRole('heading', { name: /workflow definitions/i })).toBeVisible()

      const searchBox = page.getByPlaceholder(/search/i).first()
      if (await searchBox.isVisible().catch(() => false)) {
        await fillText(page, searchBox, workflowId)
        // Filter bar submits on Enter or via Apply button; both work in this repo
        await searchBox.press('Enter').catch(() => undefined)
      }

      // Match on the NAME, not the id: the list dropped its "Workflow ID"
      // column and moved the id into a portaled hover tooltip on the name, so
      // the id is never inside the row element. The search box above still
      // narrows by id (the `search` filter matches workflowId OR workflowName),
      // so the row this resolves to is still unambiguously ours.
      const row = page.getByRole('row').filter({ hasText: workflowName })
      await expect(row).toBeVisible({ timeout: 10_000 })

      // Delete via row action menu → confirm dialog.
      // RowActions opens on pointerenter AND toggles on click, so hovering is the
      // stable way to open the menu without the click flipping it back closed.
      //
      // Scroll the trigger near the bottom of the viewport BEFORE opening the
      // menu. The demo feedback FAB lives at fixed bottom-6 right-6 and the
      // menu opens downward by default — if the trigger is mid-viewport the
      // bottom-most menu items overlap the FAB and clicks get intercepted in
      // CI. Putting the trigger at viewport bottom forces Radix's collision
      // detection to flip the menu upward, away from the FAB.
      const triggerBtn = row.getByRole('button', { name: /open actions/i })
      await triggerBtn.evaluate((el) => el.scrollIntoView({ block: 'end' }))
      await triggerBtn.hover()
      await page.getByRole('menuitem', { name: /^delete$/i }).click()

      const deleteDialog = page.getByRole('dialog', { name: /delete workflow/i })
      await expect(deleteDialog).toBeVisible()
      await deleteDialog.getByRole('button', { name: /^delete$/i }).click()

      // Row should disappear. The flash toast may be transient, so assert on row removal instead.
      await expect(page.getByRole('row').filter({ hasText: workflowName })).toHaveCount(0, { timeout: 10_000 })
    } finally {
      if (token) {
        const leftoverId = await findDefinitionIdByWorkflowId(request, token, workflowId)
        await deleteWorkflowDefinitionIfExists(request, token, leftoverId)
      }
    }
  })

})
