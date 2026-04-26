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
  // Radix Select helpers
  const pickRadix = async (triggerId: string, optionLabel: string | RegExp) => {
    await page.locator(`#${triggerId}`).click()
    const opt = typeof optionLabel === 'string'
      ? page.getByRole('option', { name: optionLabel, exact: true })
      : page.getByRole('option', { name: optionLabel })
    await opt.first().click()
  }
  await pickRadix('step-0-type', 'START')

  await addStepBtn.click()
  await fillText(page, page.locator('#step-1-id'), 'end')
  await fillText(page, page.locator('#step-1-name'), 'End')
  await pickRadix('step-1-type', 'END')

  await page.getByRole('button', { name: /^add transition$/i }).click()
  await fillText(page, page.locator('#transition-0-id'), 'start-to-end')
  await fillText(page, page.locator('#transition-0-name'), 'Auto advance')
  await pickRadix('transition-0-from', /^start$/i)
  await pickRadix('transition-0-to', /^end$/i)

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
})
