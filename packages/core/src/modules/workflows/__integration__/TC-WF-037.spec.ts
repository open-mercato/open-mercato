import { expect, test, type Page } from '@playwright/test'
import {
  isWorkflowDefinitionSave,
  workflowInspector,
} from '@open-mercato/core/helpers/integration/workflowsUi'
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
  definition?: {
    steps?: Array<{ stepId?: string; stepName?: string; stepType?: string }>
    transitions?: Array<{ fromStepId?: string; toStepId?: string }>
  }
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
      // `workflowInspector` matches the inspector's `data-slot`, docked or overlay.
      const nodeDialog = workflowInspector(page)
      await expect(nodeDialog).toBeVisible({ timeout: 15_000 })
      await expect(nodeDialog.getByRole('heading', { name: 'Edit Step' })).toBeVisible()
      // Queried by ACCESSIBLE NAME, not `getByLabel`: CrudForm renders its field
      // label as a bare `<label>` with no `htmlFor` and the input as a sibling,
      // so the visible "Step Name" is not programmatically associated with any
      // control and the input's name falls back to its placeholder. The regex
      // matches either spelling, so this keeps working once that label is bound.
      await nodeDialog.getByRole('textbox', { name: /step name/i }).fill(NEW_STEP_NAME)
      await nodeDialog.getByRole('button', { name: 'Save Step' }).press('Enter')
      await expect(nodeDialog).toBeHidden({ timeout: 15_000 })

      // The card announces type, title and status — status is never colour-only.
      // In the EDITOR every card's status is "Not started" (WorkflowNodeCard:
      // there is no run behind an authoring canvas); "Pending" is a run-view
      // label and never appeared here.
      await expect(
        page.getByRole('group', { name: `AUTOMATED: ${NEW_STEP_NAME} — Not started` }),
      ).toBeVisible({ timeout: 15_000 })

      // 4. CONNECT — through the Code view, still without a pointer.
      //    A step that hangs off the graph is a validation ERROR ("Node … is
      //    disconnected") and the Studio refuses to save one, so a loop that only
      //    adds and names a step can never reach a save. The palette offers no
      //    connect command; the Code view is the non-pointer path the acceptance
      //    criterion names alongside it, so the loop rewires start → new → end
      //    there. `fill` and `press` focus and type without dispatching pointer
      //    events, so this leg keeps the spec's no-pointer rule.
      await runPaletteCommand(page, 'Toggle the Code view')
      const editor = page.getByTestId('workflow-code-view-json')
      await expect(editor).toBeVisible({ timeout: 15_000 })

      const draft = JSON.parse(await editor.inputValue()) as {
        steps: Array<{ stepId: string; stepName: string }>
        transitions: Array<{ transitionId: string; fromStepId: string; toStepId: string; trigger?: string }>
      }
      const addedStep = draft.steps.find((step) => step.stepName === NEW_STEP_NAME)
      expect(addedStep, 'the added step reaches the Code view').toBeTruthy()
      draft.transitions = [
        { transitionId: 'start-to-added', fromStepId: 'start', toStepId: addedStep!.stepId, trigger: 'auto' },
        { transitionId: 'added-to-end', fromStepId: addedStep!.stepId, toStepId: 'end', trigger: 'auto' },
      ]
      await editor.fill(JSON.stringify(draft, null, 2))
      const apply = page.getByTestId('workflow-code-view-apply')
      await expect(apply, 'a valid definition can be applied').toBeEnabled({ timeout: 15_000 })
      await apply.press('Enter')
      // Escape closes the drawer; an APPLIED edit survives it (only an unapplied
      // draft is discarded), and the toolbar's Save is unreachable until it does.
      await page.keyboard.press('Escape')
      await expect(editor).toBeHidden({ timeout: 15_000 })

      // 5. SAVE — through the palette, again without a pointer.
      const savePromise = page.waitForResponse(
        (res) => isWorkflowDefinitionSave(res, definitionId!),
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
      const transitions = body?.data?.definition?.transitions ?? []
      expect(
        transitions.map((transition) => [transition.fromStepId, transition.toStepId]),
        'the route the keyboard author drew through the Code view is persisted too',
      ).toEqual([
        ['start', added!.stepId],
        [added!.stepId, 'end'],
      ])
    } finally {
      await deleteWorkflowDefinitionIfExists(request, apiToken, definitionId)
    }
  })
})
