import { expect, test, type Page } from '@playwright/test'
import { workflowInspector } from '@open-mercato/core/helpers/integration/workflowsUi'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'

/**
 * TC-WF-034: step-type conversion keeps the quarantined config visible (#4237).
 *
 * Spec 2026-07-26-workflows-ux-redesign.md section 4.5: "Change type…" keeps
 * id/name/position/wiring; compatible config is mapped; incompatible config is
 * "quarantined into a visible 'unmapped config' drawer (flagged in Problems),
 * never dropped".
 *
 * Converting a USER_TASK step to AUTOMATED is the sharpest case: none of the
 * task configuration is executable by an automated step, so all of it must
 * survive as quarantine rather than being deleted. The test asserts the whole
 * chain — the confirmation names the parked keys, the inspector renders them in
 * the read-only drawer, Problems raises the warning, and the definition
 * persists them under `step.metadata.unmappedConfig` while the step id and both
 * of its routes stay exactly where they were.
 *
 * Self-contained: the definition is created via the API in setup and deleted in
 * `finally`; nothing relies on seeded or demo data.
 */

type DefinitionRecord = {
  definition?: {
    steps?: Array<{
      stepId?: string
      stepType?: string
      stepName?: string
      metadata?: { unmappedConfig?: Record<string, unknown> } | null
    }>
    transitions?: Array<{ transitionId?: string; fromStepId?: string; toStepId?: string }>
  }
}

function buildConversionDefinitionPayload(timestamp: number) {
  return {
    workflowId: `qa-wf034-conversion-${timestamp}`,
    workflowName: `QA WF-034 Conversion ${timestamp}`,
    description: 'Step-type conversion fixture (#4237)',
    version: 1,
    enabled: false,
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        {
          stepId: 'review',
          stepName: 'Review Request',
          stepType: 'USER_TASK',
          userTaskConfig: {
            assignedTo: 'admin',
            // `label` is required by `userTaskConfigSchema`'s `fields` arm
            // (data/validators.ts) — without it the whole definition is rejected
            // 400 `invalid_union`. Same fix as 8e5d02974 applied to the shared
            // fixture; this spec carries its own copy.
            formSchema: { fields: [{ name: 'approved', type: 'boolean', label: 'Approved', required: true }] },
          },
        },
        { stepId: 'done', stepName: 'Done', stepType: 'END' },
      ],
      transitions: [
        { transitionId: 't_qa_wf034_start', fromStepId: 'start', toStepId: 'review', trigger: 'auto' },
        { transitionId: 't_qa_wf034_done', fromStepId: 'review', toStepId: 'done', trigger: 'manual' },
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

async function openStepInspector(page: Page, stepId: string): Promise<void> {
  await page.locator(`.react-flow__node[data-id="${stepId}"]`).click()
  // The step inspector is the DOCKED rail at this viewport, not a modal dialog.
  await expect(workflowInspector(page)).toBeVisible({ timeout: 15_000 })
  await expect(workflowInspector(page).getByRole('heading', { name: 'Edit Step' })).toBeVisible()
}

test.describe('TC-WF-034: step-type conversion quarantines config visibly', () => {
  test.describe.configure({ timeout: 120_000 })

  test('converting USER_TASK to AUTOMATED parks the task config instead of dropping it', async ({ page, request }) => {
    const apiToken = await getAuthToken(request, 'admin')
    const payload = buildConversionDefinitionPayload(Date.now())
    let definitionId: string | null = null

    try {
      definitionId = await createWorkflowDefinitionFixture(request, apiToken, payload)
      await login(page, 'admin')
      await openStudio(page, definitionId)
      await openStepInspector(page, 'review')

      // Pick the target type and trigger the conversion.
      await page.getByRole('combobox', { name: 'New step type' }).click()
      await page.getByRole('option', { name: 'AUTOMATED', exact: true }).click()
      await page.getByRole('button', { name: 'Change type…' }).click()

      // The confirmation names what is about to be parked — the author is never
      // asked to approve a silent deletion.
      // `useConfirmDialog` renders an alertdialog, not a plain dialog.
      const confirmDialog = page
        .getByRole('alertdialog')
        .filter({ hasText: 'Change step type?' })
        .or(page.getByRole('dialog').filter({ hasText: 'Change step type?' }))
        .first()
      await expect(confirmDialog).toBeVisible({ timeout: 15_000 })
      await expect(confirmDialog).toContainText('move to Unmapped configuration')
      await expect(confirmDialog).toContainText('userTaskConfig')
      await confirmDialog.getByRole('button', { name: 'Confirm' }).click()

      await expect(page.getByText(/parked as unmapped configuration/).first()).toBeVisible({ timeout: 10_000 })

      // The quarantine is visible in the inspector, read-only, with the values intact.
      await openStepInspector(page, 'review')
      const drawer = page.locator('details').filter({ hasText: 'Unmapped configuration' })
      await expect(drawer).toBeVisible()
      await drawer.locator('summary').click()
      await expect(drawer.locator('pre')).toContainText('userTaskConfig')
      await expect(drawer.locator('pre')).toContainText('assignedTo')
      await page.keyboard.press('Escape')
      await expect(workflowInspector(page)).toBeHidden({ timeout: 15_000 })

      // Problems flags it as a warning so it cannot be forgotten about.
      await page.getByRole('button', { name: 'Validate', exact: true }).click()
      await expect(page.getByText(/keeps unmapped configuration from an earlier type change/).first()).toBeVisible({
        timeout: 15_000,
      })

      const saveButton = page.getByRole('button', { name: 'Update', exact: true })
      const [response] = await Promise.all([
        page.waitForResponse(
          (res) => res.url().includes(`/api/workflows/definitions/${definitionId}`) && res.request().method() === 'PUT',
          { timeout: 30_000 },
        ),
        saveButton.click(),
      ])
      expect(response.status(), 'a quarantining conversion still saves').toBe(200)

      const detail = await apiRequest(
        request,
        'GET',
        `/api/workflows/definitions/${encodeURIComponent(definitionId)}`,
        { token: apiToken },
      )
      const body = await readJsonSafe<{ data?: DefinitionRecord }>(detail)
      const converted = (body?.data?.definition?.steps ?? []).find((step) => step.stepId === 'review')

      expect(converted?.stepType, 'the step is now automated').toBe('AUTOMATED')
      expect(converted?.stepName, 'the step keeps its name').toBe('Review Request')
      expect(converted?.metadata?.unmappedConfig, 'the task config is parked, not deleted').toBeTruthy()
      expect(Object.keys(converted?.metadata?.unmappedConfig ?? {})).toContain('userTaskConfig')

      const transitions = body?.data?.definition?.transitions ?? []
      expect(
        transitions.map((transition) => [transition.transitionId, transition.fromStepId, transition.toStepId]),
        'conversion never touches the wiring',
      ).toEqual([
        ['t_qa_wf034_start', 'start', 'review'],
        ['t_qa_wf034_done', 'review', 'done'],
      ])
    } finally {
      await deleteWorkflowDefinitionIfExists(request, apiToken, definitionId)
    }
  })
})
