import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { escapeRegExp, gridBlockName, seedShowWeekendsPreference, waitForCalendarLoaded } from './helpers/calendarFixtures'

export const integrationMeta = { dependsOnModules: ['customers', 'example'] }

test.use({ timezoneId: 'UTC' })
test.setTimeout(60_000)

type Interaction = { id: string; scheduledAt: string; timezone: string | null; title: string; recurrenceRule: string | null }

async function readInteraction(request: APIRequestContext, token: string, personId: string, interactionId: string): Promise<Interaction> {
  const response = await apiRequest(request, 'GET', `/api/customers/interactions?entityId=${personId}&limit=100`, { token })
  expect(response.status(), await response.text()).toBe(200)
  const body = await response.json() as { items: Interaction[] }
  const interaction = body.items.find((item) => item.id === interactionId)
  expect(interaction).toBeTruthy()
  return interaction!
}

test.describe('TC-CAL-014: explicit event timezone persistence and calendar rendering', () => {
  test('round-trips normal and Visit intervals with an explicit zone and rejects invalid zones', async ({ request }) => {
    let token: string | null = null
    let personId: string | null = null
    const interactionIds: string[] = []
    try {
      token = await getAuthToken(request, 'admin')
      personId = await createPersonFixture(request, token, { firstName: 'Timezone', lastName: String(Date.now()), displayName: 'QA Timezone contact' })
      for (const interactionType of ['meeting', 'visit']) {
        const response = await apiRequest(request, 'POST', '/api/customers/interactions', {
          token, data: { entityId: personId, interactionType, title: `${interactionType} timezone ${Date.now()}`,
            scheduledAt: '2026-09-29T09:15:00+02:00', durationMinutes: 165, timezone: 'Europe/Warsaw' },
        })
        expect(response.status(), await response.text()).toBe(201)
        const { id } = await response.json() as { id: string }
        interactionIds.push(id)
        expect(await readInteraction(request, token, personId, id)).toMatchObject({
          scheduledAt: '2026-09-29T07:15:00.000Z', timezone: 'Europe/Warsaw',
        })
        const renamed = await apiRequest(request, 'PUT', '/api/customers/interactions', {
          token, data: { id, title: `Updated ${interactionType} timezone` },
        })
        expect(renamed.status(), await renamed.text()).toBe(200)
        expect(await readInteraction(request, token, personId, id)).toMatchObject({
          scheduledAt: '2026-09-29T07:15:00.000Z', timezone: 'Europe/Warsaw',
        })
        const invalidUpdate = await apiRequest(request, 'PUT', '/api/customers/interactions', { token, data: { id, timezone: 'Invalid/Timezone' } })
        expect(invalidUpdate.status()).toBe(400)
        expect((await readInteraction(request, token, personId, id)).timezone).toBe('Europe/Warsaw')
      }
      const invalidCreate = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token, data: { entityId: personId, interactionType: 'meeting', title: 'Invalid timezone',
          scheduledAt: '2026-09-29T07:15:00Z', timezone: 'Invalid/Timezone' },
      })
      expect(invalidCreate.status()).toBe(400)
    } finally {
      for (const id of interactionIds) await deleteEntityIfExists(request, token, '/api/customers/interactions', id)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })

  test('restores the chosen timezone and local fields on edit, then saves a changed zone', async ({ page, request }) => {
    let token: string | null = null
    let personId: string | null = null
    let interactionId: string | null = null
    const title = `QA timezone edit ${Date.now()}`
    try {
      token = await getAuthToken(request, 'admin')
      personId = await createPersonFixture(request, token, { firstName: 'TimezoneEdit', lastName: String(Date.now()), displayName: 'QA TimezoneEdit contact' })
      const created = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token, data: { entityId: personId, interactionType: 'meeting', title,
          scheduledAt: '2026-09-29T07:15:00Z', durationMinutes: 165, timezone: 'Europe/Warsaw' },
      })
      expect(created.status(), await created.text()).toBe(201)
      interactionId = (await created.json() as { id: string }).id
      await page.clock.install({ time: new Date('2026-09-28T12:00:00Z') })
      await login(page, 'admin')
      await page.goto('/backend/calendar')
      await waitForCalendarLoaded(page)
      await page.locator('[data-calendar-search]').fill(title)
      await page.getByRole('button', { name: gridBlockName(title) }).click()
      await page.getByRole('button', { name: 'Edit', exact: true }).click()
      const editor = page.getByRole('dialog')
      await expect(editor.getByRole('combobox', { name: 'Time zone', exact: true })).toHaveText('Europe/Warsaw')
      await expect(editor.getByRole('combobox', { name: 'Starts', exact: true })).toContainText('09:15')
      await expect(editor.getByRole('combobox', { name: 'Ends', exact: true })).toContainText('12:00')
      await editor.getByRole('combobox', { name: 'Time zone', exact: true }).click()
      await page.getByRole('option', { name: 'UTC', exact: true }).click()
      await editor.getByRole('button', { name: 'Save event', exact: true }).click()
      await expect(editor).toBeHidden()
      expect(await readInteraction(request, token, personId, interactionId)).toMatchObject({
        scheduledAt: '2026-09-29T09:15:00.000Z', timezone: 'UTC',
      })
      await page.getByRole('button', { name: gridBlockName(title) }).click()
      await page.getByRole('button', { name: 'Edit', exact: true }).click()
      await expect(page.getByRole('dialog').getByRole('combobox', { name: 'Time zone', exact: true })).toHaveText('UTC')
      await expect(page.getByRole('dialog').getByRole('combobox', { name: 'Starts', exact: true })).toContainText('09:15')
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/interactions', interactionId)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })

  test('renders weekly occurrences at the same event-local wall time across Warsaw daylight saving', async ({ page, request }) => {
    let token: string | null = null
    let personId: string | null = null
    let interactionId: string | null = null
    const title = `QA timezone DST ${Date.now()}`
    try {
      token = await getAuthToken(request, 'admin')
      personId = await createPersonFixture(request, token, { firstName: 'TimezoneDst', lastName: String(Date.now()), displayName: 'QA TimezoneDst contact' })
      const created = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token, data: { entityId: personId, interactionType: 'meeting', title,
          scheduledAt: '2026-03-22T08:00:00Z', durationMinutes: 60, timezone: 'Europe/Warsaw',
          recurrenceRule: 'FREQ=WEEKLY;BYDAY=SU;COUNT=3' },
      })
      expect(created.status(), await created.text()).toBe(201)
      interactionId = (await created.json() as { id: string }).id
      expect(await readInteraction(request, token, personId, interactionId)).toMatchObject({
        timezone: 'Europe/Warsaw', recurrenceRule: 'FREQ=WEEKLY;BYDAY=SU;COUNT=3',
      })
      await page.clock.install({ time: new Date('2026-03-28T12:00:00Z') })
      await seedShowWeekendsPreference(page, getTokenScope(token).userId)
      await login(page, 'admin')
      await page.goto('/backend/calendar')
      await waitForCalendarLoaded(page)
      await page.locator('[data-calendar-search]').fill(title)
      const occurrence = page.getByRole('button', { name: new RegExp(`^${escapeRegExp(title)},.*7:00.*8:00`) })
      await expect(occurrence).toHaveCount(1)
      await occurrence.click()
      await page.getByRole('button', { name: 'Edit', exact: true }).click()
      await expect(page.getByRole('dialog').getByRole('combobox', { name: 'Time zone', exact: true })).toHaveText('Europe/Warsaw')
      await expect(page.getByRole('dialog').getByRole('combobox', { name: 'Starts', exact: true })).toContainText('09:00')
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/interactions', interactionId)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })
})
