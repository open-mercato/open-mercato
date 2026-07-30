import { expect, test, type Page } from '@playwright/test'
import { workflowInspector } from '@open-mercato/core/helpers/integration/workflowsUi'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  buildMinimalDefinitionPayload,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'

/**
 * TC-WF-037: accessibility smoke — add, configure and save without a pointer.
 *
 * Spec 2026-07-26-workflows-ux-redesign.md section 4.6 states this as an
 * acceptance criterion, not a polish item: "Every canvas operation is reachable
 * without a pointer: the command palette + inspector + Problems panel + Code
 * view together form a complete non-pointer authoring path".
 *
 * The test therefore performs a full authoring loop — add a step, name it, save
 * the definition — and **never issues a pointer action**: no `click()`, no
 * `hover()`, no mouse. Only key presses and `fill()` (which focuses an element
 * and types into it without dispatching pointer events) are used. Every step of
 * the loop goes through the Cmd+K palette or a direct canvas binding.
 *
 * It also asserts the ARIA contract the same section requires: the node card
 * exposes `role="group"` with a `{type}: {title} — {status}` name, so the step
 * an author just created is announceable, and status is never colour-only.
 *
 * Self-contained: the definition is created via the API in setup and deleted in
 * `finally`; nothing relies on seeded or demo data.
 */

type DefinitionRecord = {
  definition?: { steps?: Array<{ stepId?: string; stepName?: string; stepType?: string }> }
}

const NEW_STEP_NAME = 'Keyboard Added Step'

async function openStudio(page: Page, definitionId: string): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/backend/definitions/visual-editor?id=${encodeURIComponent(definitionId)}`, {
    waitUntil: 'domcontentloaded',
  })
  await expect(page.locator('.react-flow__node[data-id="start"]')).toBeVisible({ timeout: 30_000 })
}

/**
 * Open the palette, filter to a single command, and run it with Enter.
 *
 * The option is matched on its TEXT, not `{ name: query, exact: true }`: a
 * command descriptor may carry a `description` (a "Go to step" entry appends the
 * step's type label) or a `shortcut` (`Save` renders `Cmd+S` in a `<Kbd>`), and
 * both render inside the option — so the accessible name is
 * `"Go to step: New Automated Task AUTOMATED"` / `"Save Cmd+S"` and an exact
 * match can never succeed.
 */
async function runPaletteCommand(page: Page, query: string): Promise<void> {
  await page.keyboard.press('ControlOrMeta+k')
  const search = page.getByPlaceholder('Search commands…')
  await expect(search).toBeVisible({ timeout: 15_000 })
  await search.fill(query)
  await expect(page.getByRole('option').filter({ hasText: query }).first()).toBeVisible({ timeout: 15_000 })
  await page.keyboard.press('Enter')
  await expect(search).toBeHidden({ timeout: 15_000 })
}

test.describe('TC-WF-037: keyboard-only authoring loop (a11y smoke)', () => {
  test.describe.configure({ timeout: 120_000 })

  test('adds, configures and saves a step using only the palette and the keyboard', async ({ page, request }) => {
    const apiToken = await getAuthToken(request, 'admin')
    const payload = buildMinimalDefinitionPayload(Date.now(), '-a11y')
    let definitionId: string | null = null

    try {
      definitionId = await createWorkflowDefinitionFixture(request, apiToken, { ...payload, enabled: false })
      await login(page, 'admin')
      await openStudio(page, definitionId)

      // 1. ADD — the palette lists every step type; the entry is never hidden.
      await runPaletteCommand(page, 'Add step: AUTOMATED')
      const newNode = page.locator('.react-flow__node[data-id^="automated_"]')
      await expect(newNode).toHaveCount(1, { timeout: 15_000 })

      // 2. SELECT — "Go to step" centres and selects it, which is what makes the
      //    Enter binding usable without ever pointing at the card.
      await runPaletteCommand(page, 'Go to step: New Automated Task')
      await expect(newNode).toHaveClass(/selected/, { timeout: 15_000 })

      // 3. CONFIGURE — Enter opens the inspector for the selection; the field is
      //    reached by its label and submitted from the keyboard.
      await page.keyboard.press('Enter')
      // The inspector is the DOCKED rail at the default viewport, not a modal.
      const nodeDialog = workflowInspector(page)
      await expect(nodeDialog).toBeVisible({ timeout: 15_000 })
      await expect(nodeDialog.getByRole('heading', { name: 'Edit Step' })).toBeVisible()
      await nodeDialog.getByLabel('Step Name').fill(NEW_STEP_NAME)
      await nodeDialog.getByRole('button', { name: 'Save Step' }).press('Enter')
      await expect(nodeDialog).toBeHidden({ timeout: 15_000 })

      // The card announces type, title and status — status is never colour-only.
      await expect(
        page.getByRole('group', { name: `AUTOMATED: ${NEW_STEP_NAME} — Pending` }),
      ).toBeVisible({ timeout: 15_000 })

      // 4. SAVE — through the palette, again without a pointer.
      const savePromise = page.waitForResponse(
        (res) => res.url().includes(`/api/workflows/definitions/${definitionId}`) && res.request().method() === 'PUT',
        { timeout: 30_000 },
      )
      await runPaletteCommand(page, 'Save')
      const saveResponse = await savePromise
      expect(saveResponse.status(), 'the keyboard-only save must actually persist').toBe(200)

      const detail = await apiRequest(
        request,
        'GET',
        `/api/workflows/definitions/${encodeURIComponent(definitionId)}`,
        { token: apiToken },
      )
      const body = await readJsonSafe<{ data?: DefinitionRecord }>(detail)
      const added = (body?.data?.definition?.steps ?? []).find((step) => step.stepName === NEW_STEP_NAME)
      expect(added, 'the step authored by keyboard is persisted').toBeTruthy()
      expect(added?.stepType).toBe('AUTOMATED')
    } finally {
      await deleteWorkflowDefinitionIfExists(request, apiToken, definitionId)
    }
  })
})
