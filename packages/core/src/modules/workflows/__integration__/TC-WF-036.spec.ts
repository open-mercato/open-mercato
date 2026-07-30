import { expect, test, type Page } from '@playwright/test'
import { workflowInspector } from '@open-mercato/core/helpers/integration/workflowsUi'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'

/**
 * TC-WF-036: the Code view reads the save payload and pastes canvas subgraphs.
 *
 * Spec 2026-07-26-workflows-ux-redesign.md section 2.2 makes the Code view the
 * precondition for retiring the form editor, and scopes its Phase 3 stage to
 * "read-only view + copy/paste of subgraphs + JSON-schema validation display".
 *
 * Two properties are asserted, because they are the ones that make the panel
 * trustworthy:
 *   1. the JSON on screen IS the definition that a Save would persist — it is
 *      assembled through the same `graphToDefinition` + `buildDefinitionPayload`
 *      pair `handleSave` uses, so the author is not reading a re-serialization;
 *   2. a fragment copied from the CANVAS pastes through the Code view, is
 *      re-IDed, and shows up in the JSON — one clipboard format across both
 *      surfaces.
 *
 * Two-way live sync is explicitly Phase 5 and is NOT covered here: the panel is
 * read-only and the canvas stays the source of truth.
 *
 * Self-contained: the definition is created via the API in setup and deleted in
 * `finally`; nothing relies on seeded or demo data.
 */

type CodeViewDefinition = {
  steps?: Array<{ stepId?: string; stepName?: string; stepType?: string }>
  transitions?: Array<{ transitionId?: string; fromStepId?: string; toStepId?: string }>
}

function buildCodeViewDefinitionPayload(timestamp: number) {
  return {
    workflowId: `qa-wf036-codeview-${timestamp}`,
    workflowName: `QA WF-036 Code View ${timestamp}`,
    description: 'Code view copy/paste fixture',
    version: 1,
    enabled: false,
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        { stepId: 'review', stepName: 'Review Request', stepType: 'USER_TASK', userTaskConfig: { assignedTo: 'admin' } },
        { stepId: 'done', stepName: 'Done', stepType: 'END' },
      ],
      transitions: [
        { transitionId: 't_qa_wf036_start', fromStepId: 'start', toStepId: 'review', trigger: 'auto' },
        { transitionId: 't_qa_wf036_done', fromStepId: 'review', toStepId: 'done', trigger: 'manual' },
      ],
    },
  }
}

async function openStudio(page: Page, definitionId: string): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/backend/definitions/visual-editor?id=${encodeURIComponent(definitionId)}`, {
    waitUntil: 'domcontentloaded',
  })
  await expect(page.locator('.react-flow__node[data-id="review"]')).toBeVisible({ timeout: 30_000 })
}

async function readCodeViewDefinition(page: Page): Promise<CodeViewDefinition> {
  const json = await page.getByTestId('workflow-code-view-json').innerText()
  return JSON.parse(json) as CodeViewDefinition
}

test.describe('TC-WF-036: Code view — definition JSON and subgraph paste', () => {
  test.describe.configure({ timeout: 120_000 })

  test('shows the save payload with its validation state and pastes a copied subgraph', async ({ page, request }) => {
    const apiToken = await getAuthToken(request, 'admin')
    const payload = buildCodeViewDefinitionPayload(Date.now())
    let definitionId: string | null = null

    try {
      definitionId = await createWorkflowDefinitionFixture(request, apiToken, payload)
      await login(page, 'admin')
      await openStudio(page, definitionId)

      // Select a step on the canvas and copy it. The click opens the inspector,
      // so Escape closes it again while leaving the node selected — Cmd+C is
      // suppressed while an overlay is open, by design. At this viewport
      // (1440x900) the inspector is the DOCKED rail, not a modal dialog.
      await page.locator('.react-flow__node[data-id="review"]').click()
      const nodeInspector = workflowInspector(page)
      await expect(nodeInspector).toBeVisible({ timeout: 15_000 })
      await expect(nodeInspector.getByRole('heading', { name: 'Edit Step' })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(nodeInspector).toBeHidden({ timeout: 15_000 })
      await page.keyboard.press('ControlOrMeta+c')

      await page.getByRole('button', { name: 'Show the definition JSON' }).click()
      const drawer = page.getByRole('dialog').filter({ hasText: 'Definition JSON' })
      await expect(drawer).toBeVisible({ timeout: 15_000 })
      await expect(drawer.getByRole('heading', { name: 'Code' })).toBeVisible()

      const before = await readCodeViewDefinition(page)
      expect(before.steps?.map((step) => step.stepId), 'the panel renders the definition that would be saved').toEqual([
        'start',
        'review',
        'done',
      ])
      expect(before.transitions?.map((transition) => transition.transitionId)).toEqual([
        't_qa_wf036_start',
        't_qa_wf036_done',
      ])

      // A valid definition reports a clean schema-validation state rather than
      // an empty list the author has to interpret.
      await expect(page.getByTestId('workflow-code-view-clean')).toHaveText('No problems found in this definition.')

      // Copy is the whole document, not a fragment.
      await page.getByRole('button', { name: 'Copy JSON' }).click()
      await expect(
        page.getByText(/Definition JSON copied|browser blocked clipboard access/).first(),
        'copy either succeeds or says why it could not — never silently no-ops',
      ).toBeVisible({ timeout: 10_000 })

      // Paste the canvas fragment through the Code view.
      await page.getByRole('button', { name: 'Paste steps' }).click()

      await expect
        .poll(async () => (await readCodeViewDefinition(page)).steps?.length ?? 0, { timeout: 20_000 })
        .toBe(4)

      const after = await readCodeViewDefinition(page)
      const reviewSteps = (after.steps ?? []).filter((step) => step.stepName === 'Review Request')
      expect(reviewSteps, 'the copied step is pasted alongside the original').toHaveLength(2)
      expect(reviewSteps[0]?.stepId).not.toBe(reviewSteps[1]?.stepId)
      expect(reviewSteps.every((step) => step.stepType === 'USER_TASK'), 'the paste keeps the step type').toBe(true)

      // A single-step selection carries no internal routes, so the paste must
      // not invent one — the wiring is untouched.
      expect(after.transitions?.map((transition) => transition.transitionId)).toEqual([
        't_qa_wf036_start',
        't_qa_wf036_done',
      ])
    } finally {
      await deleteWorkflowDefinitionIfExists(request, apiToken, definitionId)
    }
  })
})
