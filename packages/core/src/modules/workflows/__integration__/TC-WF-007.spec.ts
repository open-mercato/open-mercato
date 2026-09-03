import { test, expect, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/workflowsFixtures'
import {
  openWorkflowDetailsDrawer,
  WORKFLOW_TRIGGER_CAP_TESTID,
  workflowInspector,
  workflowNodeByTitle,
  workflowRouteEdges,
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
 * Author a definition entirely through the UI, in the Studio.
 *
 * The form editor is retired (spec section 10), so the create path is now:
 * definitions list → "Create Workflow" → template gallery → a template card →
 * the Studio, pre-populated. The template's own workflowId/name are overwritten
 * with the test's unique values before saving so concurrent runs cannot collide.
 * `task-escalation` is deliberate: it is the only gallery template that carries
 * no event trigger of its own, so nothing runs behind the test's back.
 */
async function createDefinitionInStudio(
  page: Page,
  workflowId: string,
  workflowName: string,
): Promise<void> {
  await page.goto('/backend/definitions')
  await page.getByRole('button', { name: /^create workflow$/i }).first().click()

  const gallery = page.getByRole('dialog')
  await expect(gallery).toBeVisible({ timeout: 10_000 })
  await page.getByTestId('template-card-task-escalation').click()

  await expect(page).toHaveURL(/\/backend\/definitions\/visual-editor\?template=task-escalation/, { timeout: 15_000 })
  await expect(workflowStepNodes(page).first()).toBeVisible({ timeout: 15_000 })

  // Definition metadata lives in the details Drawer, which starts closed.
  const drawer = await openWorkflowDetailsDrawer(page)
  await fillText(page, drawer.locator('#workflowId'), workflowId)
  await fillText(page, drawer.locator('#workflowName'), workflowName)

  // Save from inside the drawer: with it open, the header Save and the drawer
  // footer Save are two buttons with the same accessible name.
  await drawer.getByRole('button', { name: /^save$/i }).click()
  await expect(page).toHaveURL(/\/backend\/definitions\/visual-editor\?id=[0-9a-f-]{36}/i, { timeout: 15_000 })
}

/**
 * TC-WF-007: Open a UI-created workflow in the visual editor and verify React Flow
 * renders its steps and routes.
 *
 * Entirely UI-driven: the definition is authored in the Studio through the
 * template gallery (not the API), then re-opened from the definitions list.
 * React Flow nodes are located via ReactFlow's default `.react-flow__node` /
 * `.react-flow__edge` class hooks.
 */
test.describe('TC-WF-007: Visual editor renders a UI-created workflow', () => {
  test('loads the authored steps and their transitions in the graph', async ({ page, request }) => {
    // Authoring through the gallery, opening the details drawer, saving, going
    // back to the list and re-entering through the row action is a long walk; it
    // does not fit the 20s default.
    test.setTimeout(90_000)
    const timestamp = Date.now()
    const workflowId = `qa-wf-007-${timestamp}`
    const workflowName = `QA TC-WF-007 ${timestamp}`
    let token: string | null = null

    try {
      token = await getAuthToken(request, 'admin')

      await login(page, 'admin')
      await createDefinitionInStudio(page, workflowId, workflowName)

      // Re-open from the list through the row action instead of URL-typing —
      // more UI-real, and it is the single Edit entry now that the form editor
      // is retired (spec section 10).
      await page.goto('/backend/definitions')
      const searchBox = page.getByPlaceholder(/search/i).first()
      if (await searchBox.isVisible().catch(() => false)) {
        await fillText(page, searchBox, workflowId)
        await searchBox.press('Enter').catch(() => undefined)
      }

      // The list's "Workflow ID" column is gone — the id lives in a portaled
      // hover tooltip on the name, so it is never inside the row. The search
      // above still narrows by id, so the name resolves to our row alone.
      const row = page.getByRole('row').filter({ hasText: workflowName })
      await expect(row).toBeVisible({ timeout: 10_000 })
      await row.getByRole('button', { name: /open actions/i }).hover()
      await page.getByRole('menuitem', { name: /^edit$/i }).first().click()

      await expect(page).toHaveURL(/\/backend\/definitions\/visual-editor\?id=/, { timeout: 15_000 })

      // React Flow renders nodes with `.react-flow__node` and edges with
      // `.react-flow__edge`. Counts mirror `examples/templates/task-escalation.json`
      // and exclude the render-time trigger pill (see workflowsUi).
      const nodes = workflowStepNodes(page)
      await expect(nodes).toHaveCount(4, { timeout: 15_000 })

      // Each node card shows its label — verify the template's steps survived
      // the save → reload round trip. Matched on the node's OWN title element
      // (`workflowNodeByTitle`): a whole-card `hasText` is a case-insensitive
      // substring match, so it also hits the unconditional `sr-only` status
      // name ("Not started") every card renders, and "Start" then resolved to
      // all four nodes.
      await expect(workflowNodeByTitle(page, 'Start')).toHaveCount(1)
      await expect(workflowNodeByTitle(page, 'Review Task')).toHaveCount(1)
      await expect(workflowNodeByTitle(page, 'Notify Escalation')).toHaveCount(1)
      await expect(workflowNodeByTitle(page, 'Done')).toHaveCount(1)

      await expect(workflowRouteEdges(page)).toHaveCount(4, { timeout: 10_000 })

      // The trigger summary is part of the Studio now — assert it, rather than
      // silently tolerating it in the counts above. It is the cap FOLDED onto
      // the START node (`TriggerCap`); the separate overlay trigger node it
      // replaced (`workflow-trigger-node`) is deprecated and unmounted.
      await expect(page.getByTestId(WORKFLOW_TRIGGER_CAP_TESTID)).toBeVisible()

      // Workflow metadata reflects what we created.
      const reopened = await openWorkflowDetailsDrawer(page)
      await expect(reopened.locator('#workflowId')).toHaveValue(workflowId)
      await expect(reopened.locator('#workflowName')).toHaveValue(workflowName)
    } finally {
      if (token) {
        const leftoverId = await findDefinitionIdByWorkflowId(request, token, workflowId)
        await deleteWorkflowDefinitionIfExists(request, token, leftoverId)
      }
    }
  })

  // WAIT_FOR_TIMER renders as a dedicated node in the visual editor and the
  // CrudForm node dialog (default since the crud-form-dialogs flag flip)
  // exposes its timer configuration. The definition is seeded via API so the
  // assertion stays scoped to the React Flow + node dialog surface.
  test('renders WAIT_FOR_TIMER as a dedicated node with timer-config inputs', async ({ page, request }) => {
    const timestamp = Date.now()
    const workflowId = `qa-wf-007-timer-${timestamp}`
    let token: string | null = null
    let definitionId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')

      definitionId = await createWorkflowDefinitionFixture(request, token, {
        workflowId,
        workflowName: `QA TC-WF-007 timer ${timestamp}`,
        description: 'Integration test: timer node renders in visual editor',
        version: 1,
        enabled: true,
        definition: {
          steps: [
            { stepId: 'start', stepName: 'Start', stepType: 'START' },
            {
              stepId: 'wait_for_timer',
              stepName: 'Wait',
              stepType: 'WAIT_FOR_TIMER',
              config: { duration: 'PT5M' },
            },
            { stepId: 'end', stepName: 'End', stepType: 'END' },
          ],
          transitions: [
            { transitionId: 'start-to-timer', fromStepId: 'start', toStepId: 'wait_for_timer', trigger: 'auto' },
            { transitionId: 'timer-to-end', fromStepId: 'wait_for_timer', toStepId: 'end', trigger: 'auto' },
          ],
        },
      })

      await login(page, 'admin')
      await page.goto(`/backend/definitions/visual-editor?id=${encodeURIComponent(definitionId)}`)
      await expect(page).toHaveURL(/\/backend\/definitions\/visual-editor\?id=/, { timeout: 15_000 })

      // All three nodes render, including the WAIT_FOR_TIMER step.
      const nodes = workflowStepNodes(page)
      await expect(nodes).toHaveCount(3, { timeout: 15_000 })
      await expect(nodes.filter({ hasText: 'Wait' })).toHaveCount(1)
      await expect(workflowRouteEdges(page)).toHaveCount(2, { timeout: 10_000 })

      // Open the step inspector by clicking the timer node. Both inspectors
      // open as the wide overlay Drawer now; `workflowInspector` addresses it by
      // its `data-slot` so the spec does not depend on which layout it got.
      await nodes.filter({ hasText: 'Wait' }).first().click()
      const dialog = workflowInspector(page)
      await expect(dialog).toBeVisible({ timeout: 10_000 })
      await expect(dialog.getByRole('heading', { name: 'Edit Step' })).toBeVisible()

      // The CrudForm node dialog renders WAIT_FOR_TIMER config in a "Timer
      // Configuration" group: a composite duration control (DurationInput's
      // amount spinbutton + unit select) pre-filled from config.duration=PT5M,
      // plus a "Wait Until" date-time picker. Labels are the English strings
      // from workflows/i18n/en.json and ui.durationInput.* / ui.dateTimePicker.*.
      await expect(dialog.getByText('WAIT FOR TIMER', { exact: true })).toBeVisible()
      await expect(dialog.getByText('Timer Configuration', { exact: true })).toBeVisible()
      await expect(dialog.getByRole('spinbutton', { name: 'Duration amount' })).toHaveValue('5')
      await expect(dialog.getByRole('combobox', { name: 'Duration unit' })).toContainText('Minutes')
      await expect(dialog.getByText('Wait Until', { exact: true })).toBeVisible()
      await expect(dialog.getByRole('button', { name: 'Pick date and time' })).toBeVisible()
    } finally {
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })

  // The node dialog's activity-type dropdown lists the WAIT option on
  // AUTOMATED steps. Under the CrudForm dialog (default since the
  // crud-form-dialogs flag flip) activities render via ActivityArrayEditor —
  // we mount an activity, open its Radix Select, and assert the option role.
  test('NodeEditDialog activity-type dropdown offers the WAIT option on AUTOMATED steps', async ({ page, request }) => {
    const timestamp = Date.now()
    const workflowId = `qa-wf-007-automated-${timestamp}`
    let token: string | null = null
    let definitionId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')

      definitionId = await createWorkflowDefinitionFixture(request, token, {
        workflowId,
        workflowName: `QA TC-WF-007 automated ${timestamp}`,
        description: 'Integration test: WAIT option visible in activity-type dropdown',
        version: 1,
        enabled: true,
        definition: {
          steps: [
            { stepId: 'start', stepName: 'Start', stepType: 'START' },
            { stepId: 'notify', stepName: 'Notify', stepType: 'AUTOMATED' },
            { stepId: 'end', stepName: 'End', stepType: 'END' },
          ],
          transitions: [
            { transitionId: 'start-to-notify', fromStepId: 'start', toStepId: 'notify', trigger: 'auto' },
            { transitionId: 'notify-to-end', fromStepId: 'notify', toStepId: 'end', trigger: 'auto' },
          ],
        },
      })

      await login(page, 'admin')
      await page.goto(`/backend/definitions/visual-editor?id=${encodeURIComponent(definitionId)}`)
      await expect(page).toHaveURL(/\/backend\/definitions\/visual-editor\?id=/, { timeout: 15_000 })

      const nodes = workflowStepNodes(page)
      await expect(nodes).toHaveCount(3, { timeout: 15_000 })

      // Open the step inspector on the AUTOMATED node — that's where the
      // per-activity editor (and its activity-type dropdown) lives.
      await nodes.filter({ hasText: 'Notify' }).first().click()
      const dialog = workflowInspector(page)
      await expect(dialog).toBeVisible({ timeout: 10_000 })
      await expect(dialog.getByRole('heading', { name: 'Edit Step' })).toBeVisible()

      // ActivityArrayEditor mounts a new activity already expanded, so its
      // "Activity Type *" Select trigger renders right after Add Activity.
      await dialog.getByRole('button', { name: /add activity/i }).click()

      const activityTypeTrigger = dialog.getByRole('combobox', { name: 'Activity Type *' })
      await expect(activityTypeTrigger).toBeVisible({ timeout: 10_000 })
      await activityTypeTrigger.click()

      // Radix portals SelectContent to <body>, not inside the dialog — assert
      // at the page level instead of scoping to the dialog locator. The WAIT
      // activity is labelled "Wait / Delay" in workflows/i18n/en.json.
      await expect(
        page.getByRole('option', { name: 'Wait / Delay' }),
        'node dialog activity-type dropdown should offer the WAIT option',
      ).toBeVisible({ timeout: 10_000 })
    } finally {
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })
})
