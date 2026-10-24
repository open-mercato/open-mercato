import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createCompanyFixture,
  createDealFixture,
  createPersonFixture,
  deleteEntityIfExists,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/crmFixtures'

type Surface = 'company' | 'person' | 'deal'
type Interaction = { id: string; title: string | null; scheduledAt: string | null }

const activityMenus = [
  { label: 'New meeting', type: 'Meeting' },
  { label: 'Log call', type: 'Call' },
  { label: 'New task', type: 'Task' },
  { label: 'Compose email', type: 'Email' },
] as const

async function selectedDays(page: Page, surface: Surface) {
  return page.evaluate((currentSurface) => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const first = new Date(today)
    const second = new Date(today)
    if (currentSurface === 'deal') {
      const mondayOffset = (today.getDay() + 6) % 7
      first.setDate(today.getDate() - mondayOffset + 8)
      second.setDate(today.getDate() - mondayOffset + 9)
    } else {
      first.setDate(today.getDate() + 1)
      second.setDate(today.getDate() - 1)
    }
    const labels = (date: Date) => ({
      dateLabel: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      dateOnly: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
      stripLabel: `${date.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()} ${String(date.getDate()).padStart(2, '0')}`,
      numericDay: String(date.getDate()),
    })
    return { first: labels(first), second: labels(second) }
  }, surface)
}

async function openMeeting(page: Page, surface: Surface) {
  if (surface === 'deal') {
    await page.getByRole('button', { name: 'Schedule', exact: true }).first().click()
  } else {
    await page.getByRole('button', { name: 'Add new', exact: true }).click()
    await page.getByRole('button', { name: 'New meeting', exact: true }).click()
  }
  return page.getByRole('dialog', { name: 'New meeting', exact: true })
}

test.describe('TC-CRM-7478: schedule activities on the selected local day', () => {
  test.use({ timezoneId: 'America/Los_Angeles' })

  for (const surface of ['company', 'person', 'deal'] as const) {
    test(`${surface}: preserves the latest selected day through save and reopen`, async ({ page, request }, testInfo) => {
      let token: string | null = null
      let companyId: string | null = null
      let personId: string | null = null
      let dealId: string | null = null
      let entityId: string | null = null
      let interactionId: string | null = null
      const title = `QA 7478 ${surface} ${randomUUID()}`

      try {
        token = await getAuthToken(request, 'admin')
        companyId = await createCompanyFixture(request, token, title)
        entityId = companyId
        let detailPath = `/backend/customers/companies-v2/${companyId}`
        if (surface === 'person') {
          personId = await createPersonFixture(request, token, {
            firstName: 'Selected', lastName: 'Day', displayName: title, companyEntityId: companyId,
          })
          entityId = personId
          detailPath = `/backend/customers/people-v2/${personId}`
        } else if (surface === 'deal') {
          dealId = await createDealFixture(request, token, { title, companyIds: [companyId] })
          detailPath = `/backend/customers/deals/${dealId}`
        }

        await login(page, 'admin')
        await page.goto(detailPath)
        await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
        if (surface === 'company') {
          await page.getByRole('tab', { name: /^Activity log/ }).click()
        } else {
          await page.getByRole('tab', { name: /^Activities\b/ }).click()
        }

        const days = await selectedDays(page, surface)
        if (surface === 'deal') {
          await expect(page.getByRole('heading', { name: 'Log activity', exact: true })).toBeVisible()
          const showPreview = page.getByRole('button', { name: 'Show week preview', exact: true })
          if (await showPreview.isVisible()) await showPreview.click()
          await page.getByRole('button', { name: 'Next week', exact: true }).click()
          await page.getByRole('button', { name: days.first.numericDay, exact: true }).click()
          const initial = await openMeeting(page, surface)
          await expect(initial.getByRole('button', { name: days.first.dateLabel, exact: true })).toBeVisible()
          await initial.getByRole('button', { name: 'Cancel', exact: true }).first().click()
          await page.getByRole('button', { name: days.second.numericDay, exact: true }).click()
        } else {
          await page.getByRole('button', { name: days.first.stripLabel, exact: true }).click()
          for (const menu of activityMenus) {
            await page.getByRole('button', { name: 'Add new', exact: true }).click()
            await page.getByRole('button', { name: menu.label, exact: true }).click()
            const initial = page.getByRole('dialog', { name: menu.label, exact: true })
            await expect(initial.getByRole('button', { name: days.first.dateLabel, exact: true })).toBeVisible()
            await expect(initial.getByRole('button', { name: menu.type, exact: true })).toHaveAttribute('aria-pressed', 'true')
            await initial.getByRole('button', { name: 'Cancel', exact: true }).first().click()
          }
          await page.getByRole('button', { name: days.second.stripLabel, exact: true }).click()
        }

        const dialog = await openMeeting(page, surface)
        await expect(dialog.getByRole('button', { name: days.second.dateLabel, exact: true })).toBeVisible()
        await dialog.getByRole('textbox', { name: 'Activity title...', exact: true }).fill(title)
        await dialog.getByRole('button', { name: /^\d{2}:\d{2} [AP]M$/ }).click()
        const timePicker = page.getByRole('dialog', { name: 'Time picker', exact: true })
        await timePicker.getByRole('button', { name: '23:30', exact: true }).click()
        await timePicker.getByRole('button', { name: 'Apply', exact: true }).click()
        const saved = page.waitForResponse((response) =>
          new URL(response.url()).pathname === '/api/customers/interactions' && response.request().method() === 'POST',
        )
        await dialog.getByRole('button', { name: 'Save activity', exact: true }).click()
        const response = await saved
        const created: unknown = await response.json()
        interactionId = created && typeof created === 'object' && 'id' in created && typeof created.id === 'string'
          ? created.id
          : null
        expect(response.status()).toBe(201)
        expect(interactionId).toBeTruthy()
        await expect(dialog).toBeHidden()

        const listedResponse = await apiRequest(request, 'GET', `/api/customers/interactions?entityId=${entityId}&limit=100`, { token })
        expect(listedResponse.ok()).toBeTruthy()
        const listed = await readJsonSafe<{ items?: Interaction[] }>(listedResponse)
        const stored = listed?.items?.find((interaction) => interaction.id === interactionId)
        expect(stored?.scheduledAt).toBeTruthy()
        const storedLocal = await page.evaluate((timestamp) => {
          const date = new Date(timestamp)
          return {
            dateOnly: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
            hours: date.getHours(), minutes: date.getMinutes(),
          }
        }, stored!.scheduledAt!)
        expect(storedLocal).toEqual({ dateOnly: days.second.dateOnly, hours: 23, minutes: 30 })
        expect(stored!.scheduledAt!.slice(0, 10)).not.toBe(days.second.dateOnly)

        await page.reload()
        if (surface === 'company') await page.getByRole('tab', { name: /^Activity log/ }).click()
        if (surface !== 'deal') {
          await page.getByRole('button', { name: days.second.stripLabel, exact: true }).click()
        }
        await page.getByRole('button', { name: new RegExp(title) }).first().click()
        const reopened = page.getByRole('dialog', { name: 'Edit activity', exact: true })
        await expect(reopened.getByRole('button', { name: days.second.dateLabel, exact: true })).toBeVisible()
        await expect(reopened.getByRole('button', { name: '11:30 PM', exact: true })).toBeVisible()
        const screenshot = testInfo.outputPath(`${surface}-selected-day.png`)
        await page.screenshot({ path: screenshot, fullPage: true })
        await testInfo.attach(`${surface} selected day after reload`, { path: screenshot, contentType: 'image/png' })
        await reopened.getByRole('button', { name: 'Cancel', exact: true }).first().click()

        if (surface === 'deal') {
          await page.getByRole('button', { name: 'Schedule', exact: true }).last().click()
          const fallback = page.getByRole('dialog', { name: 'New meeting', exact: true })
          await expect(fallback.getByRole('button', { name: days.second.dateLabel, exact: true })).toHaveCount(0)
          await expect(fallback.getByRole('button', { name: /^\w{3} \d{1,2}, \d{4}$/ })).toBeVisible()
          await fallback.getByRole('button', { name: 'Cancel', exact: true }).first().click()
        }
      } finally {
        try {
          await deleteEntityIfExists(request, token, '/api/customers/interactions', interactionId)
          if (token && entityId) {
            const remainingResponse = await apiRequest(request, 'GET', `/api/customers/interactions?entityId=${entityId}&limit=100`, { token })
            const remaining = await readJsonSafe<{ items?: Interaction[] }>(remainingResponse)
            for (const interaction of remaining?.items ?? []) {
              if (interaction.title === title) await deleteEntityIfExists(request, token, '/api/customers/interactions', interaction.id)
            }
          }
        } finally {
          await deleteEntityIfExists(request, token, '/api/customers/deals', dealId)
          await deleteEntityIfExists(request, token, '/api/customers/people', personId)
          await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
        }
      }
    })
  }
})
