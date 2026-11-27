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

async function selectedDays(page: Page) {
  return page.evaluate(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const startOffset = 8 - (today.getDay() + 6) % 7
    return [startOffset, startOffset + 1].map((offset) => {
      const date = new Date(today)
      date.setDate(today.getDate() + offset)
      return {
        dateLabel: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        dateOnly: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
        numericDay: String(date.getDate()),
      }
    })
  })
}

function activitiesTab(page: Page, surface: Surface) {
  return page.getByRole('tab', { name: surface === 'company' ? /^Activity log/ : /^Activities\b/ })
}

async function openMeeting(page: Page) {
  await page.getByRole('button', { name: 'Schedule', exact: true }).first().click()
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
        await activitiesTab(page, surface).click()

        const [firstDay, secondDay] = await selectedDays(page)
        await expect(page.getByRole('heading', { name: 'Log activity', exact: true })).toBeVisible()
        const composer = page.getByRole('heading', { name: 'Log activity', exact: true }).locator('../..')
        for (const width of [390, 1440]) {
          await page.setViewportSize({ width, height: 900 })
          await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
          for (const button of await composer.getByRole('button').all()) {
            if (!await button.isVisible()) continue
            const bounds = await button.evaluate((element) => {
              const control = element.getBoundingClientRect()
              const range = document.createRange()
              range.selectNodeContents(element)
              const content = range.getBoundingClientRect()
              return {
                left: control.left, right: control.right,
                contentLeft: content.left, contentRight: content.right,
                hasText: Boolean(element.textContent?.trim()),
              }
            })
            expect(bounds.left).toBeGreaterThanOrEqual(0)
            expect(bounds.right).toBeLessThanOrEqual(width)
            if (bounds.hasText) {
              expect(bounds.contentLeft).toBeGreaterThanOrEqual(bounds.left - 1)
              expect(bounds.contentRight).toBeLessThanOrEqual(bounds.right + 1)
            }
          }
        }
        const showPreview = page.getByRole('button', { name: 'Show week preview', exact: true })
        if (await showPreview.isVisible()) await showPreview.click()
        await composer.getByRole('button', { name: 'Next week', exact: true }).click()
        await composer.getByRole('button', { name: firstDay.numericDay, exact: true }).click()
        const initial = await openMeeting(page)
        await expect(initial.getByRole('button', { name: firstDay.dateLabel, exact: true })).toBeVisible()
        for (const type of ['Call', 'Task', 'Email']) {
          const option = page.getByRole('dialog').getByRole('button', { name: type, exact: true })
          await option.click()
          await expect(option).toHaveAttribute('aria-pressed', 'true')
          await expect(page.getByRole('dialog').getByRole('button', { name: firstDay.dateLabel, exact: true })).toBeVisible()
        }
        await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).first().click()
        await composer.getByRole('button', { name: secondDay.numericDay, exact: true }).click()

        const dialog = await openMeeting(page)
        await expect(dialog.getByRole('button', { name: secondDay.dateLabel, exact: true })).toBeVisible()
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
        expect(storedLocal).toEqual({ dateOnly: secondDay.dateOnly, hours: 23, minutes: 30 })
        expect(stored!.scheduledAt!.slice(0, 10)).not.toBe(secondDay.dateOnly)

        await page.reload()
        await activitiesTab(page, surface).click()
        await page.getByRole('button', { name: new RegExp(title) }).first().click()
        const reopened = page.getByRole('dialog', { name: 'Edit activity', exact: true })
        await expect(reopened.getByRole('button', { name: secondDay.dateLabel, exact: true })).toBeVisible()
        await expect(reopened.getByRole('button', { name: '11:30 PM', exact: true })).toBeVisible()
        const screenshot = testInfo.outputPath(`${surface}-selected-day.png`)
        await page.screenshot({ path: screenshot, fullPage: true })
        await testInfo.attach(`${surface} selected day after reload`, { path: screenshot, contentType: 'image/png' })
        await reopened.getByRole('button', { name: 'Cancel', exact: true }).first().click()

        if (surface === 'deal') {
          await page.getByRole('button', { name: 'Schedule', exact: true }).last().click()
          const fallback = page.getByRole('dialog', { name: 'New meeting', exact: true })
          await expect(fallback.getByRole('button', { name: secondDay.dateLabel, exact: true })).toHaveCount(0)
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
