import { expect, test } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createLedgerBrowserFixture } from './ledgerBrowserFixture'

test('generates fiscal periods, locks and unlocks them, and surfaces a stale edit', async ({ page, browser, request, baseURL }) => {
  const fixture = await createLedgerBrowserFixture(request, baseURL)
  try {
    await fixture.login(page, ['ledger.periods.view', 'ledger.periods.manage'])
    const main = page.getByRole('main')
    await page.goto('/backend/ledger/fiscal-periods')
    await main.getByRole('link', { name: 'Generate 12 months' }).click()
    await main.getByRole('button', { name: 'Pick a date' }).click()
    const monthLabel = (await page.getByRole('button', { name: /open month and year navigation/ }).innerText()).trim()
    const [month, year] = monthLabel.split(' ')
    const calendar = page.getByRole('grid', { name: monthLabel })
    await calendar.getByRole('button', { name: new RegExp(`${month} 1st, ${year}$`) }).click()
    await page.getByRole('button', { name: 'Apply', exact: true }).click()
    const [generated] = await Promise.all([
      page.waitForResponse((response) => response.url().endsWith('/api/ledger/fiscal-periods/generate') && response.request().method() === 'POST'),
      main.getByRole('button', { name: 'Generate', exact: true }).first().click(),
    ])
    expect(generated.status()).toBe(201)
    const { startDate } = generated.request().postDataJSON() as { startDate: string }
    await expect(main.getByRole('heading', { name: 'Fiscal Periods' })).toBeVisible()

    const { token, headers } = fixture
    const list = await apiRequest(request, 'GET', '/api/ledger/fiscal-periods', { token, headers })
    const periods = await readJsonSafe<{ items: Array<{ id: string; startDate: string }> }>(list)
    expect(periods?.items).toHaveLength(12)
    const generatedPeriod = periods?.items.find((period) => period.startDate === startDate)
    if (!generatedPeriod) throw new Error('[internal] Generated period is missing')
    const periodId = generatedPeriod.id
    const row = main.getByRole('row').filter({ has: page.getByRole('cell', { name: startDate, exact: true }) })
    await expect(row.getByRole('cell', { name: 'Open', exact: true })).toBeVisible()

    async function lockThroughBrowser() {
      await row.getByRole('button', { name: 'Open actions' }).click()
      await page.getByRole('menuitem', { name: 'Lock', exact: true }).click()
      const confirm = page.getByRole('alertdialog', { name: 'Lock this fiscal period?' })
      const [locked] = await Promise.all([
        page.waitForResponse((response) => response.url().endsWith(`/fiscal-periods/${periodId}/lock`) && response.request().method() === 'POST'),
        confirm.getByRole('button', { name: 'Confirm' }).click(),
      ])
      return locked.status()
    }

    expect(await lockThroughBrowser()).toBe(200)
    await expect(row.getByRole('cell', { name: 'Locked', exact: true })).toBeVisible()
    await row.getByRole('button', { name: 'Open actions' }).click()
    await page.getByRole('menuitem', { name: 'Unlock', exact: true }).click()
    await expect(row.getByRole('cell', { name: 'Open', exact: true })).toBeVisible()

    const concurrentLock = await apiRequest(request, 'POST', `/api/ledger/fiscal-periods/${periodId}/lock`, { token, headers })
    expect(concurrentLock.status()).toBe(200)
    expect(await lockThroughBrowser()).toBe(409)
    const conflict = page.getByRole('alert').filter({ hasText: /record was modified by someone else/i })
    await expect(conflict).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('ledger-period-conflict.png') })

    const viewer = await browser.newPage({ baseURL })
    try {
      await fixture.login(viewer, ['ledger.periods.view'])
      await viewer.goto('/backend/ledger/fiscal-periods')
      const content = viewer.getByRole('main')
      const viewerRow = content.getByRole('row').filter({ has: viewer.getByRole('cell', { name: startDate, exact: true }) })
      await expect(viewerRow.getByRole('cell', { name: 'Locked', exact: true })).toBeVisible()
      await expect(content.getByRole('link', { name: 'Generate 12 months' })).toHaveCount(0)
      await expect(content.getByRole('link', { name: 'New fiscal period' })).toHaveCount(0)
      await expect(viewerRow.getByRole('button', { name: 'Open actions' })).toHaveCount(0)
    } finally {
      await viewer.close()
    }
  } finally {
    await fixture.cleanup()
  }
})
