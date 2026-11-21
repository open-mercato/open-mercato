import { expect, test, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

async function expectFiltersOnOneLine(page: Page, viewportWidth: number): Promise<void> {
  const group = page.getByRole('group', { name: 'Filter' })
  await expect(group).toBeVisible()
  const chipTops = await group.getByRole('button').evaluateAll((nodes) =>
    nodes.map((node) => Math.round(node.getBoundingClientRect().top)),
  )
  expect(chipTops.length, 'the filter group has chips').toBeGreaterThan(3)
  expect(new Set(chipTops).size, `filters share one line at ${viewportWidth}px`).toBe(1)

  const sort = page.getByRole('button', { name: /^Sort/ }).first()
  await expect(sort).toBeInViewport({ ratio: 1 })
  const sortBox = await sort.boundingBox()
  expect(Math.round(sortBox?.y ?? -1), `sort sits on the filter line at ${viewportWidth}px`).toBe(chipTops[0])

  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewportWidth)
}

async function expectLastFilterReachable(page: Page, viewportWidth: number): Promise<void> {
  const label = `${viewportWidth}px`
  const group = page.getByRole('group', { name: 'Filter' })
  const lastFilter = group.getByRole('button').last()
  const scrollRight = page.getByRole('button', { name: 'Scroll right', exact: true })
  const scrollLeft = page.getByRole('button', { name: 'Scroll left', exact: true })

  await expect(lastFilter, `the last filter starts clipped at ${label}`).not.toBeInViewport({ ratio: 1 })
  await expect(scrollRight, `a visible control reaches the clipped filters at ${label}`).toBeVisible()

  await expect(async () => {
    if (await scrollRight.isVisible()) await scrollRight.click()
    await expect(lastFilter).toBeInViewport({ ratio: 1, timeout: 1_500 })
    await expect(scrollRight).toBeHidden({ timeout: 1_500 })
  }).toPass({ timeout: 20_000 })
  await expect(scrollLeft).toBeVisible()

  await lastFilter.click()
  const popover = page.getByRole('dialog')
  await expect(popover, `the last filter opens at ${label}`).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(popover).toBeHidden()

  await expect(async () => {
    if (await scrollLeft.isVisible()) await scrollLeft.click()
    await expect(scrollLeft).toBeHidden({ timeout: 1_500 })
  }).toPass({ timeout: 20_000 })
}

/**
 * TC-CRM-KANBAN-FILTER-ROW-001: the deals board filter row never wraps.
 *
 * Seven filters and the sort control used to break into two or three lines.
 * The filters now share one line at every width, scroll sideways when they do
 * not fit, and keep the sort control pinned on the same line. On a tablet and
 * a phone the clipped filters are reachable through the scroll arrow, without
 * a horizontal wheel or a touch drag.
 */
test('TC-CRM-KANBAN-FILTER-ROW-001: board filters stay on one line from desktop to phone', async ({ page, request }) => {
  test.slow()

  const token = await getAuthToken(request, 'admin')
  const stamp = Date.now()
  const pipelineName = `QA filter row pipeline ${stamp} ${'long name '.repeat(5)}`.trim()
  let pipelineId: string | null = null
  let stageId: string | null = null

  try {
    const pipelineResponse = await apiRequest(request, 'POST', '/api/customers/pipelines', {
      token,
      data: { name: pipelineName, isDefault: false },
    })
    expect(pipelineResponse.status()).toBe(201)
    pipelineId = expectId((await readJsonSafe<{ id?: unknown }>(pipelineResponse))?.id, 'Pipeline fixture id')

    const stageResponse = await apiRequest(request, 'POST', '/api/customers/pipeline-stages', {
      token,
      data: { pipelineId, label: `QA filter row stage ${stamp}`, order: 0 },
    })
    expect(stageResponse.status()).toBe(201)
    stageId = expectId((await readJsonSafe<{ id?: unknown }>(stageResponse))?.id, 'Stage fixture id')

    await login(page, 'admin')
    await page.goto('/backend/customers/deals/pipeline')
    await expect(page.getByRole('button', { name: 'New stage', exact: true }).first()).toBeEnabled()
    await page.getByRole('status', { name: 'Loading', exact: true }).waitFor({ state: 'hidden' })
    await page.getByRole('combobox').click()
    await page.getByRole('option', { name: pipelineName, exact: true }).press('Enter')
    await expect(page.getByRole('button', { name: `Pipeline: ${pipelineName}`, exact: true })).toBeVisible()

    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 768, height: 1024 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport)
      await expectFiltersOnOneLine(page, viewport.width)
      if (viewport.width < 1440) await expectLastFilterReachable(page, viewport.width)
    }
  } finally {
    await deleteEntityIfExists(request, token, '/api/customers/pipeline-stages', stageId)
    await deleteEntityIfExists(request, token, '/api/customers/pipelines', pipelineId)
  }
})
