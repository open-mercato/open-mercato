import { randomUUID } from 'node:crypto'
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  createDealFixture,
  createPipelineFixture,
  createPipelineStageFixture,
} from '@open-mercato/core/helpers/integration/crmFixtures'

type StageFixture = {
  id: string
  label: string
  usdTitles: string[]
  eurTitle: string
}

function getLane(page: Page, stage: StageFixture): Locator {
  return page.getByRole('button', { name: `Quickly add a deal to ${stage.label}`, exact: true }).locator('..')
}

async function expectSummaries(page: Page, stages: StageFixture[]): Promise<void> {
  for (const stage of stages) {
    const lane = getLane(page, stage)
    const usdCount = stage.usdTitles.length
    await expect(lane.getByText(String(usdCount + 1), { exact: true })).toBeVisible()
    await lane.getByRole('button', { name: 'Show per-currency breakdown (2 currencies)', exact: true }).click()
    const heading = `${stage.label.toUpperCase()} (${usdCount + 1} deals)`
    const dialog = page.getByRole('dialog').filter({ has: page.getByText(heading, { exact: true }) })
    await expect(dialog.getByText('Lane breakdown', { exact: true })).toBeVisible()
    await expect(dialog.getByText(heading, { exact: true })).toBeVisible()
    const usdRow = dialog.getByRole('listitem').filter({ has: page.getByText('USD', { exact: true }) })
    const eurRow = dialog.getByRole('listitem').filter({ has: page.getByText('EUR', { exact: true }) })
    await expect(usdRow.getByText((usdCount * 100).toLocaleString('en-US'), { exact: true })).toBeVisible()
    await expect(usdRow.getByText(String(usdCount), { exact: true })).toBeVisible()
    await expect(eurRow.getByText('200', { exact: true })).toBeVisible()
    await expect(eurRow.getByText('1', { exact: true })).toBeVisible()
    await dialog.press('Escape')
    await expect(dialog).toBeHidden()
  }
}

async function filterCurrency(page: Page, currency: 'EUR' | 'USD'): Promise<void> {
  await page.getByRole('button', { name: /^Currency:/ }).click()
  const dialog = page.getByRole('dialog').filter({
    has: page.getByText('Filter kanban by currency', { exact: true }),
  })
  await dialog.getByRole('radio', { name: new RegExp(`^${currency} `) }).click()
  await dialog.getByRole('button', { name: 'Apply filter', exact: true }).click()
  await expect(dialog).toBeHidden()
}

test.describe('TC-CRM-8576: currency-filtered Kanban pagination', () => {
  let authCookies: Awaited<ReturnType<BrowserContext['cookies']>> = []
  let token: string
  let pipelineId: string | null = null
  let pipelineName: string
  const stages: StageFixture[] = []
  const dealIds: string[] = []

  test.beforeAll(async ({ request, browser, baseURL }) => {
    token = await getAuthToken(request, 'admin')
    pipelineName = `TC-CRM-8576 ${randomUUID()}`
    const createdPipelineId = await createPipelineFixture(request, token, { name: pipelineName, isDefault: false })
    pipelineId = createdPipelineId
    for (const [order, usdCount] of [1, 27].entries()) {
      const label = `${order === 0 ? 'Small' : 'Large'} ${createdPipelineId.slice(0, 8)}`
      const id = await createPipelineStageFixture(request, token, { pipelineId, label, order })
      stages.push({
        id,
        label,
        usdTitles: Array.from({ length: usdCount }, (_, index) => `${label} USD ${index + 1}`),
        eurTitle: `${label} EUR`,
      })
    }
    const results = await Promise.allSettled(stages.flatMap((stage) => [
      ...stage.usdTitles.map((title) => ({ stage, title, valueCurrency: 'USD', valueAmount: 100 })),
      { stage, title: stage.eurTitle, valueCurrency: 'EUR', valueAmount: 200 },
    ]).map(async ({ stage, title, valueCurrency, valueAmount }) => {
      const id = await createDealFixture(request, token, {
        title,
        pipelineId: createdPipelineId,
        pipelineStageId: stage.id,
        valueCurrency,
        valueAmount,
        status: 'open',
      })
      dealIds.push(id)
    }))
    expect(results.filter((result) => result.status === 'rejected'), 'All 30 fixture deals should be created').toEqual([])
    const authContext = await browser.newContext({ baseURL })
    try {
      const authPage = await authContext.newPage()
      await login(authPage, 'admin')
      authCookies = await authContext.cookies()
    } finally {
      await authContext.close()
    }
  })

  test.beforeEach(async ({ context, page }) => {
    await context.addCookies(authCookies)
    await page.goto('/backend/customers/deals/pipeline')
    await expect(page.getByRole('button', { name: 'New stage', exact: true }).first()).toBeEnabled()
    await page.getByRole('button', { name: /^Pipeline:/ }).click()
    const pipelineDialog = page.getByRole('dialog').filter({
      has: page.getByText('Filter · Pipeline', { exact: true }),
    })
    await pipelineDialog.getByRole('radio', { name: pipelineName, exact: true }).click()
    await pipelineDialog.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(pipelineDialog).toBeHidden()
    await expect(page.getByRole('button', { name: 'Currency: All', exact: true })).toBeVisible()
  })

  test.afterAll(async ({ request }) => {
    const errors: unknown[] = []
    for (const [path, ids] of [
      ['/api/customers/deals', dealIds],
      ['/api/customers/pipeline-stages', stages.map((stage) => stage.id)],
      ['/api/customers/pipelines', pipelineId ? [pipelineId] : []],
    ] as const) {
      const results = await Promise.allSettled(ids.map(async (id) => {
        const response = await apiRequest(request, 'DELETE', path, { token, data: { id } })
        expect(response.status(), `Delete fixture ${path}/${id}`).toBe(200)
      }))
      for (const result of results) {
        if (result.status === 'rejected') errors.push(result.reason)
      }
    }
    expect(errors, 'Every owned deal, stage and pipeline should be deleted').toEqual([])
  })

  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      await testInfo.attach('failure', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' })
    }
  })

  test('EUR has no additional page and retains all-currency lane summaries', async ({ page }, testInfo) => {
    await expectSummaries(page, stages)

    await filterCurrency(page, 'EUR')
    for (const stage of stages) {
      const lane = getLane(page, stage)
      await expect(lane.getByRole('button', { name: /^Deal:/ })).toHaveCount(1)
      await expect(lane.getByRole('button', { name: `Deal: ${stage.eurTitle}`, exact: true })).toBeVisible()
      await expect(lane.getByRole('button', { name: `Load more deals in ${stage.label}`, exact: true })).toHaveCount(0)
    }
    await expectSummaries(page, stages)
    await testInfo.attach('eur-no-more-pages', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' })
  })

  test('USD loads exactly 27 cards and retains all-currency lane summaries', async ({ page }, testInfo) => {
    await filterCurrency(page, 'USD')
    const [smallStage, largeStage] = stages
    const smallLane = getLane(page, smallStage)
    const largeLane = getLane(page, largeStage)
    await expect(smallLane.getByRole('button', { name: /^Deal:/ })).toHaveCount(1)
    await expect(smallLane.getByRole('button', { name: `Deal: ${smallStage.usdTitles[0]}`, exact: true })).toBeVisible()
    await expect(smallLane.getByRole('button', { name: `Load more deals in ${smallStage.label}`, exact: true })).toHaveCount(0)
    await expect(largeLane.getByRole('button', { name: /^Deal:/ })).toHaveCount(25)
    const showMore = largeLane.getByRole('button', { name: `Load more deals in ${largeStage.label}`, exact: true })
    await expect(showMore).toHaveText('Show more (2)')
    await expectSummaries(page, stages)
    await testInfo.attach('usd-two-remaining', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' })
    await showMore.click()
    await expect(largeLane.getByRole('button', { name: /^Deal:/ })).toHaveCount(27)
    await expect(showMore).toHaveCount(0)
    expect((await largeLane.getByRole('heading', { level: 3 }).allTextContents()).sort()).toEqual([...largeStage.usdTitles].sort())
    await expect(largeLane.getByText('EUR', { exact: true })).toHaveCount(0)
    await expectSummaries(page, stages)
    await testInfo.attach('usd-all-27-loaded', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' })
  })
})
