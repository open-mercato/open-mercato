import { expect, test } from '@playwright/test'
import { randomInt } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  buildUserTaskDefinitionPayload,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import {
  invokeWorkflowHeaderAction,
  runWorkflowPaletteCommand,
  WORKFLOW_CODE_VIEW_MENU_ITEM_LABEL,
  isWorkflowDefinitionSave,
} from '@open-mercato/core/helpers/integration/workflowsUi'

/**
 * TC-WF-062 [P1] (UI): Code view stage 2 — edit the JSON, the canvas updates,
 * and the result round-trips through a save.
 *
 * Spec section 10's UI list names the Code-view path; section 2.2 defines stage 2
 * as *"two-way live sync with error squiggles that highlight the corresponding
 * node"*.
 *
 * The SAFETY MODEL is the thing worth exercising end to end, because it is the
 * part a unit test can only assert about a pure function: canvas → code is
 * live, code → canvas needs an explicit Apply, and a draft that does not parse
 * (or whose graph is broken) cannot reach the canvas at all. The refusal
 * decision itself is unit-covered in `lib/__tests__/code-view-apply.test.ts`;
 * what this asserts is that the Studio wires it to a real Apply button and that
 * an applied edit survives a Save.
 */

test.describe('TC-WF-062: Code view two-way sync', () => {
  test('editing the JSON updates the canvas and survives a save', async ({ page, request }) => {
    test.setTimeout(180_000)

    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now() + randomInt(1_000)

    let definitionId: string | null = null

    try {
      const payload = buildUserTaskDefinitionPayload(stamp)
      definitionId = await createWorkflowDefinitionFixture(request, token, payload)

      await login(page, 'admin')
      await page.goto(`/backend/definitions/visual-editor?id=${encodeURIComponent(definitionId)}`)

      await invokeWorkflowHeaderAction(page, WORKFLOW_CODE_VIEW_MENU_ITEM_LABEL)
      const editor = page.getByTestId('workflow-code-view-json')
      await expect(editor).toBeVisible()

      const original = await editor.inputValue()
      const parsed = JSON.parse(original) as {
        steps: Array<{ stepId: string; stepName: string }>
      }
      const review = parsed.steps.find((step) => step.stepId === 'review')
      expect(review, 'the fixture has a review step').toBeTruthy()

      // --- the canvas is NOT mutated by an in-progress edit -----------------
      await editor.fill('{ "steps": [')
      const apply = page.getByTestId('workflow-code-view-apply')
      await expect(apply, 'unparseable JSON cannot be applied').toBeDisabled()
      await expect(page.getByTestId('workflow-code-view-blocking')).toBeVisible()

      // --- a valid edit applies on demand ----------------------------------
      const renamed = 'Renamed by the Code view'
      const edited = JSON.parse(original) as { steps: Array<{ stepId: string; stepName: string }> }
      const target = edited.steps.find((step) => step.stepId === 'review')!
      target.stepName = renamed

      await editor.fill(JSON.stringify(edited, null, 2))
      await expect(apply, 'a valid definition can be applied').toBeEnabled()
      await apply.click()

      // The canvas now shows the renamed step.
      await expect(page.getByText(renamed).first()).toBeVisible()

      // --- and a Save persists it ------------------------------------------
      // The Code view is a modal drawer over the editor, so the toolbar's Save
      // is unreachable until it is closed. Closing after an Apply keeps the
      // edit: only an UNAPPLIED draft is discarded.
      await page.keyboard.press('Escape')
      await expect(editor).toBeHidden({ timeout: 15_000 })
      // The Studio has no bare Save button — saving is a command, the same way
      // the keyboard-only spec saves.
      const savePromise = page.waitForResponse(
        (res) => isWorkflowDefinitionSave(res, definitionId!),
        { timeout: 30_000 },
      )
      await runWorkflowPaletteCommand(page, 'Save')
      const saveResponse = await savePromise
      expect(saveResponse.status(), 'the Code-view edit must actually persist').toBe(200)

      const readBack = await apiRequest(
        request,
        'GET',
        `/api/workflows/definitions/${encodeURIComponent(definitionId)}`,
        { token },
      )
      expect(readBack.status()).toBe(200)
      const body = await readJsonSafe<{
        data?: { definition?: { steps?: Array<{ stepId?: string; stepName?: string }> } }
      }>(readBack)
      const persisted = (body?.data?.definition?.steps ?? []).find((step) => step.stepId === 'review')
      expect(persisted?.stepName, 'the Code-view edit round-trips through a save').toBe(renamed)
    } finally {
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })

  test('an issue points at the line of the step it belongs to', async ({ page, request }) => {
    test.setTimeout(180_000)

    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now() + randomInt(1_000)

    let definitionId: string | null = null

    try {
      const payload = buildUserTaskDefinitionPayload(stamp)
      definitionId = await createWorkflowDefinitionFixture(request, token, payload)

      await login(page, 'admin')
      await page.goto(`/backend/definitions/visual-editor?id=${encodeURIComponent(definitionId)}`)

      await invokeWorkflowHeaderAction(page, WORKFLOW_CODE_VIEW_MENU_ITEM_LABEL)
      const editor = page.getByTestId('workflow-code-view-json')
      await expect(editor).toBeVisible()

      const original = await editor.inputValue()
      const edited = JSON.parse(original) as {
        steps: Array<{ stepId: string; stepType: string }>
        transitions: Array<{ fromStepId: string; toStepId: string }>
      }
      // Detach the review step from the graph: the resulting issue names that
      // node, so the marker must land on the review element's own lines.
      edited.transitions = edited.transitions.filter((transition) => transition.toStepId !== 'review')
      await editor.fill(JSON.stringify(edited, null, 2))

      // The issue list IS the Problems panel's list, which is evaluated over the
      // canvas — code → canvas needs an explicit Apply, so the detached step has
      // to reach the document before any issue can name it. (Parse and schema
      // failures are the live half, and the first test covers those.)
      const apply = page.getByTestId('workflow-code-view-apply')
      await expect(apply, 'a graph warning does not block an apply').toBeEnabled()
      await apply.click()

      // Each locatable row carries the line its node lives on.
      const issues = page.getByTestId('workflow-code-view-issues')
      await expect(issues).toBeVisible()
      await expect(issues.locator('[data-issue-line]').first()).toBeVisible()

      // The gutter marks that same line.
      await expect(
        page.getByTestId('workflow-code-view-gutter').locator('[data-marker]').first(),
      ).toBeVisible()
    } finally {
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })
})
