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

async function createMinimalDefinitionViaUi(
  page: Page,
  workflowId: string,
  workflowName: string,
): Promise<void> {
  await page.goto('/backend/definitions/create')
  await expect(page).toHaveURL(/\/backend\/definitions\/create/)

  await fillText(page, page.getByPlaceholder('checkout_workflow'), workflowId)
  await fillText(page, page.getByPlaceholder('Enter a descriptive workflow name'), workflowName)

  const addStepBtn = page.getByRole('button', { name: /^add step$/i })
  await addStepBtn.click()
  await fillText(page, page.locator('#step-0-id'), 'start')
  await fillText(page, page.locator('#step-0-name'), 'Start')
  await page.locator('#step-0-type').selectOption('START')

  await addStepBtn.click()
  await fillText(page, page.locator('#step-1-id'), 'end')
  await fillText(page, page.locator('#step-1-name'), 'End')
  await page.locator('#step-1-type').selectOption('END')

  await page.getByRole('button', { name: /^add transition$/i }).click()
  await fillText(page, page.locator('#transition-0-id'), 'start-to-end')
  await fillText(page, page.locator('#transition-0-name'), 'Auto advance')
  await page.locator('#transition-0-from').selectOption('start')
  await page.locator('#transition-0-to').selectOption('end')

  await page.getByRole('button', { name: /^create workflow$/i }).first().click()
  await expect(page).toHaveURL(/\/backend\/definitions(\?|$|\/)/, { timeout: 15_000 })
}

/**
 * TC-WF-007: Open a UI-created workflow in the visual editor and verify React Flow
 * renders the START/END nodes and the connecting edge.
 *
 * Entirely UI-driven: the definition is created via the Create form (not the API),
 * then opened in /backend/definitions/visual-editor. React Flow nodes are located
 * via ReactFlow's default `.react-flow__node` / `.react-flow__edge` class hooks.
 */
test.describe('TC-WF-007: Visual editor renders a UI-created workflow', () => {
  test('loads START/END nodes and their transition in the graph', async ({ page, request }) => {
    const timestamp = Date.now()
    const workflowId = `qa-wf-007-${timestamp}`
    const workflowName = `QA TC-WF-007 ${timestamp}`
    let token: string | null = null

    try {
      token = await getAuthToken(request, 'admin')

      await login(page, 'admin')
      await createMinimalDefinitionViaUi(page, workflowId, workflowName)

      // Navigate via the visual editor row action instead of URL-typing — more UI-real.
      const searchBox = page.getByPlaceholder(/search/i).first()
      if (await searchBox.isVisible().catch(() => false)) {
        await fillText(page, searchBox, workflowId)
        await searchBox.press('Enter').catch(() => undefined)
      }

      const row = page.getByRole('row').filter({ hasText: workflowId })
      await expect(row).toBeVisible({ timeout: 10_000 })
      await row.getByRole('button', { name: /open actions/i }).hover()
      await page.getByRole('menuitem', { name: /edit visually/i }).click()

      await expect(page).toHaveURL(/\/backend\/definitions\/visual-editor\?id=/, { timeout: 15_000 })

      // React Flow renders nodes with `.react-flow__node` and edges with `.react-flow__edge`.
      const nodes = page.locator('.react-flow__node')
      await expect(nodes).toHaveCount(2, { timeout: 15_000 })

      // Each node card shows its label — verify START and END are both present.
      await expect(nodes.filter({ hasText: 'Start' })).toHaveCount(1)
      await expect(nodes.filter({ hasText: 'End' })).toHaveCount(1)

      // One edge (start → end).
      await expect(page.locator('.react-flow__edge')).toHaveCount(1, { timeout: 10_000 })

      // Workflow metadata pane reflects what we created.
      await expect(page.locator(`input[value="${workflowId}"]`).first()).toBeVisible()
      await expect(page.locator(`input[value="${workflowName}"]`).first()).toBeVisible()
    } finally {
      if (token) {
        const leftoverId = await findDefinitionIdByWorkflowId(request, token, workflowId)
        await deleteWorkflowDefinitionIfExists(request, token, leftoverId)
      }
    }
  })

  // Covers branch: NodeEditDialog's activity-type dropdown now lists WAIT
  // (d8aa7f499) and a WAIT_FOR_TIMER step is a valid node type (db48d0295).
  // Creates a definition via UI that includes a WAIT_FOR_TIMER step, opens the
  // visual editor, and verifies both show up: the timer node renders alongside
  // start/end, and the per-node activity-type dropdown offers the WAIT option.
  test('exposes WAIT activity option and renders WAIT_FOR_TIMER node in visual editor', async ({ page, request }) => {
    const timestamp = Date.now()
    const workflowId = `qa-wf-007-timer-${timestamp}`
    const workflowName = `QA TC-WF-007 timer ${timestamp}`
    let token: string | null = null

    try {
      token = await getAuthToken(request, 'admin')

      await login(page, 'admin')
      await page.goto('/backend/definitions/create')
      await expect(page).toHaveURL(/\/backend\/definitions\/create/)

      await fillText(page, page.getByPlaceholder('checkout_workflow'), workflowId)
      await fillText(page, page.getByPlaceholder('Enter a descriptive workflow name'), workflowName)

      const addStepBtn = page.getByRole('button', { name: /^add step$/i })
      await addStepBtn.click()
      await fillText(page, page.locator('#step-0-id'), 'start')
      await fillText(page, page.locator('#step-0-name'), 'Start')
      await page.locator('#step-0-type').selectOption('START')

      await addStepBtn.click()
      await fillText(page, page.locator('#step-1-id'), 'wait_for_timer')
      await fillText(page, page.locator('#step-1-name'), 'Wait')
      await page.locator('#step-1-type').selectOption('WAIT_FOR_TIMER')
      await fillText(page, page.locator('#step-1-duration'), 'PT5M')

      await addStepBtn.click()
      await fillText(page, page.locator('#step-2-id'), 'end')
      await fillText(page, page.locator('#step-2-name'), 'End')
      await page.locator('#step-2-type').selectOption('END')

      const addTransitionBtn = page.getByRole('button', { name: /^add transition$/i })
      await addTransitionBtn.click()
      await fillText(page, page.locator('#transition-0-id'), 'start-to-timer')
      await fillText(page, page.locator('#transition-0-name'), 'To timer')
      await page.locator('#transition-0-from').selectOption('start')
      await page.locator('#transition-0-to').selectOption('wait_for_timer')

      await addTransitionBtn.click()
      await fillText(page, page.locator('#transition-1-id'), 'timer-to-end')
      await fillText(page, page.locator('#transition-1-name'), 'Timer fired')
      await page.locator('#transition-1-from').selectOption('wait_for_timer')
      await page.locator('#transition-1-to').selectOption('end')

      await page.getByRole('button', { name: /^create workflow$/i }).first().click()
      await expect(page).toHaveURL(/\/backend\/definitions(\?|$|\/)/, { timeout: 15_000 })

      // Open in visual editor via row action.
      const searchBox = page.getByPlaceholder(/search/i).first()
      if (await searchBox.isVisible().catch(() => false)) {
        await fillText(page, searchBox, workflowId)
        await searchBox.press('Enter').catch(() => undefined)
      }

      const row = page.getByRole('row').filter({ hasText: workflowId })
      await expect(row).toBeVisible({ timeout: 10_000 })
      await row.getByRole('button', { name: /open actions/i }).hover()
      await page.getByRole('menuitem', { name: /edit visually/i }).click()

      await expect(page).toHaveURL(/\/backend\/definitions\/visual-editor\?id=/, { timeout: 15_000 })

      const nodes = page.locator('.react-flow__node')
      await expect(nodes).toHaveCount(3, { timeout: 15_000 })
      await expect(nodes.filter({ hasText: 'Wait' })).toHaveCount(1)
      await expect(page.locator('.react-flow__edge')).toHaveCount(2, { timeout: 10_000 })

      // NodeEditDialog opens on single click. Pick the timer node so the dialog
      // shows its step-scoped activity editor (where the WAIT dropdown option lives).
      await nodes.filter({ hasText: 'Wait' }).first().click()

      const dialog = page.getByRole('dialog').first()
      await expect(dialog).toBeVisible({ timeout: 10_000 })

      // The activity-type dropdown is rendered per-activity. Adding one reveals
      // the select; the branch d8aa7f499 added the WAIT option to that select.
      const addActivity = dialog.getByRole('button', { name: /add.*activity/i }).first()
      if (await addActivity.isVisible().catch(() => false)) {
        await addActivity.click()
      }

      // Assert the WAIT option exists in at least one activity-type select.
      // We locate it structurally instead of by role — native <select><option>
      // doesn't expose combobox semantics reliably in headless runs.
      const waitOption = dialog.locator('select >> option[value="WAIT"]').first()
      await expect(
        waitOption,
        'NodeEditDialog activity type dropdown should offer the WAIT option (branch d8aa7f499)',
      ).toHaveCount(1)
    } finally {
      if (token) {
        const leftoverId = await findDefinitionIdByWorkflowId(request, token, workflowId)
        await deleteWorkflowDefinitionIfExists(request, token, leftoverId)
      }
    }
  })
})
