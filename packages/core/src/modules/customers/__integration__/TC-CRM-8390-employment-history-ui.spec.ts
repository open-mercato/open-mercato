import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createCompanyFixture, createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

export const integrationMeta = { dependsOnModules: ['auth', 'customers'] }

test.use({ locale: 'en-US', timezoneId: 'America/Los_Angeles' })

test('TC-CRM-8390 UI: ends employment, reloads company history, and links the person again', async ({ page, request }, testInfo) => {
  const token = await getAuthToken(request, 'admin')
  const stamp = randomUUID().slice(0, 8)
  const companyName = `Employment company ${stamp}`
  const displayName = `Employee ${stamp}`
  let companyId: string | null = null
  let personId: string | null = null
  try {
    companyId = await createCompanyFixture(request, token, companyName)
    personId = await createPersonFixture(request, token, {
      firstName: 'Employee', lastName: stamp, displayName, companyEntityId: companyId,
    })
    await login(page, 'admin')
    const activePeoplePath = `/api/customers/companies/${companyId}/people`
    const activePeopleLoaded = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return url.pathname === activePeoplePath && url.searchParams.get('employmentStatus') !== 'ended'
        && response.request().method() === 'GET' && response.ok()
    })
    await page.goto(`/backend/customers/companies-v2/${companyId}?tab=people`, { waitUntil: 'domcontentloaded' })
    await activePeopleLoaded
    const { endedOn, expectedDate, dayButton } = await page.evaluate(() => {
      const now = new Date()
      const previousMonth = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 15))
      const month = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(previousMonth)
      return {
        endedOn: previousMonth.toISOString().slice(0, 10),
        expectedDate: new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(previousMonth),
        dayButton: `${month} 15th, ${previousMonth.getUTCFullYear()}`,
      }
    })

    const peopleTab = page.getByRole('tab', { name: /^People\b/ })
    const personRow = page.getByRole('row').filter({ hasText: displayName })
    const activeActions = personRow.getByRole('button', { name: 'Open actions', exact: true })
    const history = page.getByRole('region', { name: 'Former employees' })
    const formerPerson = history.getByRole('link', { name: displayName, exact: true })
    const endDialog = page.getByRole('dialog', { name: 'End employment' })
    async function openEndDialog() {
      await activeActions.click()
      await page.getByRole('menuitem', { name: 'End employment', exact: true }).click()
      await expect(endDialog).toBeVisible()
    }

    await expect(peopleTab).toHaveAttribute('aria-selected', 'true')
    await expect(activeActions).toBeVisible()
    await openEndDialog()
    await page.keyboard.press('Escape')
    await expect(endDialog).toBeHidden()
    await expect(activeActions).toBeVisible()
    await expect(history).toBeHidden()

    await openEndDialog()
    const departureDate = endDialog.getByRole('button', { name: 'Departure date', exact: true })
    await departureDate.click()
    await page.getByRole('button', { name: /^Go to previous month:/ }).click()
    const calendarDay = page.getByRole('button', { name: new RegExp(dayButton) })
    await calendarDay.click()
    await expect(calendarDay).toBeHidden()
    await testInfo.attach('end-employment-dialog', { body: await endDialog.screenshot({ animations: 'disabled' }), contentType: 'image/png' })
    const endPath = `/api/customers/people/${personId}/companies/${companyId}/end`
    const endWrite = page.waitForRequest((submitted) => submitted.method() === 'POST' && new URL(submitted.url()).pathname === endPath)
    await departureDate.press('Control+Enter')
    const submitted = await endWrite
    expect(submitted.headers()[OPTIMISTIC_LOCK_HEADER_NAME]).toBeTruthy()
    expect(submitted.postDataJSON()).toEqual({ endedOn })
    await expect(endDialog).toBeHidden()
    await expect(activeActions).toBeHidden()
    await expect(formerPerson).toBeVisible()
    await expect(formerPerson).toHaveAttribute('href', new RegExp(`/backend/customers/people(?:-v2)?/${personId}(?:\\?.*)?$`))
    await expect(history.getByRole('cell', { name: expectedDate, exact: true })).toBeVisible()

    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(formerPerson).toBeVisible()
    await expect(activeActions).toBeHidden()
    await testInfo.attach('former-employees', { body: await history.screenshot({ animations: 'disabled' }), contentType: 'image/png' })

    await page.getByRole('button', { name: 'Link existing person', exact: true }).click()
    const linkDialog = page.getByRole('dialog')
    await linkDialog.getByPlaceholder(/Search all people/i).fill(displayName)
    await linkDialog.getByText(displayName, { exact: true }).first().click()
    await linkDialog.getByRole('button', { name: 'Link person', exact: true }).click()
    await expect(linkDialog).toBeHidden()
    await expect(activeActions).toBeVisible()
    await expect(history).toBeHidden()
  } finally {
    await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
  }
})
