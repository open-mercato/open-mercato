import { expect, test, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createCompanyFixture, createDealFixture, deleteEntityIfExists, readJsonSafe } from '@open-mercato/core/helpers/integration/crmFixtures'

test.use({ timezoneId: 'Europe/Warsaw' })

async function selectActivityTime(page: Page, offsetDays: number): Promise<string> {
  const selection = await page.evaluate((offset) => {
    const current = new Date()
    const date = new Date(current)
    date.setDate(date.getDate() + offset)
    date.setHours(9, 30, 0, 0)
    return {
      month: date.toLocaleString('en-US', { month: 'long' }),
      day: date.getDate(),
      changeMonth: current.getMonth() !== date.getMonth(),
      timestamp: date.toISOString(),
    }
  }, offsetDays)

  const dateTime = page.getByRole('button', { name: 'Date and time', exact: true })
  await dateTime.click()
  const picker = page.getByRole('dialog').filter({ has: page.getByRole('grid') })
  if (selection.changeMonth) {
    await picker.getByRole('button', { name: offsetDays < 0 ? /previous month/i : /next month/i }).click()
  }
  await picker.getByRole('button', { name: new RegExp(`${selection.month} ${selection.day}(?!\\d)`) }).click()
  await picker.getByLabel('Hour').fill('09')
  await picker.getByLabel('Minute').fill('30')
  await picker.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(dateTime).not.toHaveText('Now')
  return selection.timestamp
}

test('logs a past meeting and plans future work from the same deal composer (#5108)', async ({ page, request }, testInfo) => {
  const token = await getAuthToken(request, 'admin')
  let companyId: string | null = null
  let dealId: string | null = null
  const interactionIds: string[] = []

  try {
    const stamp = Date.now()
    companyId = await createCompanyFixture(request, token, `CRM Activity QA ${stamp}`)
    dealId = await createDealFixture(request, token, { title: `Renewal ${stamp}`, companyIds: [companyId] })
    await login(page, 'admin')
    await page.goto(`/backend/customers/deals/${dealId}?tab=activities`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: 'Add activity', exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Schedule', exact: true }).click()
    const scheduler = page.getByRole('dialog', { name: 'New meeting', exact: true })
    await expect(scheduler).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(scheduler).toBeHidden()

    const description = page.getByRole('textbox', { name: 'Description' })
    const dateTime = page.getByRole('button', { name: 'Date and time', exact: true })
    const historyText = `Historical renewal meeting ${stamp}`
    const plannedText = `Upcoming renewal call ${stamp}`
    const taskText = `Prepare the renewal ${stamp}`

    const scenarios = [
      { label: 'Meeting', body: historyText, offset: -2, status: 'done', timestampField: 'occurredAt' },
      { label: 'Call', body: plannedText, offset: 2, status: 'planned', timestampField: 'scheduledAt' },
      { label: 'Task', body: taskText, offset: 2, status: 'planned', timestampField: 'scheduledAt' },
    ] as const

    for (const scenario of scenarios) {
      await page.getByRole('button', { name: scenario.label, exact: true }).first().click()
      await description.fill(scenario.body)
      const timestamp = await selectActivityTime(page, scenario.offset)
      const createResponse = page.waitForResponse((response) =>
        new URL(response.url()).pathname === '/api/customers/interactions' && response.request().method() === 'POST',
      )
      await page.getByRole('button', { name: 'Save activity', exact: true }).click()
      const response = await createResponse
      expect(response.ok(), `interaction create returned ${response.status()}`).toBeTruthy()
      const created: { id: string } = await response.json()
      interactionIds.push(created.id)

      const listResponse = await apiRequest(request, 'GET', `/api/customers/interactions?dealId=${dealId}`, { token })
      expect(listResponse.ok()).toBeTruthy()
      const list = await readJsonSafe<{ items: Array<{ id: string }> }>(listResponse)
      expect(list?.items.find((item) => item.id === created.id)).toMatchObject({
        entityId: companyId,
        dealId,
        status: scenario.status,
        occurredAt: null,
        scheduledAt: null,
        [scenario.timestampField]: timestamp,
      })
      await expect(dateTime).toHaveText('Now')
    }

    await expect(page.getByText(historyText, { exact: true }).locator('xpath=self::*[not(ancestor::*[@id="inline-activity-composer-week-preview"])]')).toBeVisible()
    await expect(page.getByRole('button', { name: new RegExp(`^${plannedText} `) })).toBeVisible()
    await expect(page.getByRole('button', { name: new RegExp(`^${taskText} `) })).toBeVisible()
    if (process.env.PW_CAPTURE_SCREENSHOTS === '1') {
      await page.screenshot({ path: testInfo.outputPath('activity-history-and-planned.png'), fullPage: true })
    }

    await page.setViewportSize({ width: 390, height: 844 })
    await dateTime.scrollIntoViewIfNeeded()
    await dateTime.focus()
    await page.keyboard.press('Enter')
    const picker = page.getByRole('dialog').filter({ has: page.getByRole('grid') })
    await expect(picker).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(picker).toBeHidden()
    await expect(dateTime).toBeFocused()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  } finally {
    for (const id of interactionIds) {
      await deleteEntityIfExists(request, token, '/api/customers/interactions', id)
    }
    await deleteEntityIfExists(request, token, '/api/customers/deals', dealId)
    await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
  }
})
