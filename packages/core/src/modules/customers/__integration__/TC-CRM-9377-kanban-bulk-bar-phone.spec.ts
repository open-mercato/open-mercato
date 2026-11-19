import { expect, test, type Locator, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createDealFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

const ACTIONS = ['Change stage', 'Change owner', 'Export CSV', 'Delete']

async function expectActionsInsideBar(page: Page, bar: Locator, viewportWidth: number): Promise<void> {
  const barBox = await bar.boundingBox()
  expect(barBox, 'bulk bar has a layout box').not.toBeNull()
  for (const name of ACTIONS) {
    const action = bar.getByRole('button', { name, exact: true })
    await expect(action, `${name} stays on screen at ${viewportWidth}px`).toBeInViewport({ ratio: 1 })
    const box = await action.boundingBox()
    expect(box, `${name} has a layout box`).not.toBeNull()
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual((barBox?.x ?? 0) + (barBox?.width ?? 0))
  }
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewportWidth)
}

/**
 * TC-CRM-9377: the kanban bulk action bar on a phone (#9377).
 *
 * The bar is a fixed strip with four actions. On a narrow screen the labelled
 * buttons ran past its right edge, so Export and Delete could not be reached.
 * The actions must stay inside the bar at 390 px and at 320 px, and keep their
 * accessible names when the visible labels are dropped.
 */
test('TC-CRM-9377: kanban bulk bar keeps every action reachable on a phone', async ({ page, request }) => {
  test.slow()

  const token = await getAuthToken(request, 'admin')
  const stamp = Date.now()
  const pipelineName = `QA 9377 pipeline ${stamp}`
  let pipelineId: string | null = null
  let stageId: string | null = null
  const dealIds: string[] = []

  try {
    const pipelineResponse = await apiRequest(request, 'POST', '/api/customers/pipelines', {
      token,
      data: { name: pipelineName, isDefault: false },
    })
    expect(pipelineResponse.status()).toBe(201)
    pipelineId = expectId((await readJsonSafe<{ id?: unknown }>(pipelineResponse))?.id, 'Pipeline fixture id')

    const stageResponse = await apiRequest(request, 'POST', '/api/customers/pipeline-stages', {
      token,
      data: { pipelineId, label: `QA 9377 stage ${stamp}`, order: 0 },
    })
    expect(stageResponse.status()).toBe(201)
    stageId = expectId((await readJsonSafe<{ id?: unknown }>(stageResponse))?.id, 'Stage fixture id')

    for (const suffix of ['first', 'second']) {
      dealIds.push(
        await createDealFixture(request, token, {
          title: `QA 9377 ${suffix} ${stamp}`,
          pipelineId,
          pipelineStageId: stageId,
        }),
      )
    }

    await login(page, 'admin')
    await page.goto('/backend/customers/deals/pipeline')
    await expect(page.getByRole('button', { name: 'New stage', exact: true }).first()).toBeEnabled()
    await page.getByRole('status', { name: 'Loading', exact: true }).waitFor({ state: 'hidden' })
    await page.getByRole('combobox').click()
    await page.getByRole('option', { name: pipelineName, exact: true }).press('Enter')

    const selectBoxes = page.getByRole('checkbox', { name: 'Select deal' })
    await expect(selectBoxes).toHaveCount(2, { timeout: 30_000 })
    for (const index of [0, 1]) {
      const box = selectBoxes.nth(index)
      await expect(async () => {
        await box.hover({ force: true })
        if (!(await box.isChecked())) await box.click({ force: true })
        await expect(box).toBeChecked({ timeout: 2_000 })
      }).toPass({ timeout: 20_000 })
    }

    const summary = page.getByTestId('kanban-bulk-selected-count')
    await expect(summary).toContainText('2')
    await expect(summary).toContainText('selected')
    const bar = page.getByRole('region', { name: 'Bulk actions' })
    await expect(bar).not.toContainText('{')

    await page.setViewportSize({ width: 390, height: 844 })
    await expectActionsInsideBar(page, bar, 390)

    await page.setViewportSize({ width: 320, height: 720 })
    await expectActionsInsideBar(page, bar, 320)
  } finally {
    for (const dealId of dealIds) await deleteEntityIfExists(request, token, '/api/customers/deals', dealId)
    await deleteEntityIfExists(request, token, '/api/customers/pipeline-stages', stageId)
    await deleteEntityIfExists(request, token, '/api/customers/pipelines', pipelineId)
  }
})
