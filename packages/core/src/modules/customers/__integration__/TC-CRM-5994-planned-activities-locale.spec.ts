import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  createCompanyFixture,
  createDealFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

test.use({ locale: 'pl-PL', timezoneId: 'UTC' })

test('TC-CRM-5994: planned deal activities show Polish date labels', async ({ page, request }) => {
  const token = await getAuthToken(request, 'admin')
  const fixtureSuffix = randomUUID()
  const interactionsPath = '/api/customers/interactions'
  const activities = [
    { title: 'Rozmowa z klientem', scheduledAt: '2026-06-16T10:30:00.000Z', dateLabel: 'Jutro 10:30' },
    { title: 'Spotkanie z klientem', scheduledAt: '2026-06-19T15:45:00.000Z', dateLabel: 'pt., 19 cze, 15:45' },
  ]
  let companyId: string | null = null
  let dealId: string | null = null
  const activityIds: string[] = []

  try {
    companyId = await createCompanyFixture(request, token, `QA 5994 Company ${fixtureSuffix}`)
    dealId = await createDealFixture(request, token, { title: `QA 5994 Deal ${fixtureSuffix}`, companyIds: [companyId] })

    for (const { title, scheduledAt } of activities) {
      const response = await apiRequest(request, 'POST', interactionsPath, {
        token,
        data: { entityId: companyId, dealId, interactionType: 'call', title, status: 'planned', scheduledAt },
      })
      expect(response.status(), `Could not create planned activity "${title}"`).toBe(201)
      const activity = await readJsonSafe<{ id?: string }>(response)
      activityIds.push(expectId(activity?.id, 'The created planned activity should have an ID'))
    }

    await login(page, 'admin')
    await page.context().addCookies([{ name: 'locale', value: 'pl', url: new URL(page.url()).origin }])
    await page.clock.setFixedTime(new Date('2026-06-15T12:00:00.000Z'))
    await page.goto(`/backend/customers/deals/${dealId}?tab=activities`, { waitUntil: 'domcontentloaded' })

    await expect(page.getByText(/^Zaplanowane aktywności\s*2$/)).toBeVisible()
    for (const { title, dateLabel } of activities) {
      const activityRow = page.getByRole('button', { name: new RegExp(`^${title} `) })
      await expect(activityRow.getByText(dateLabel, { exact: true })).toBeVisible()
    }
    await expect(page.getByText(/\bTomorrow\b/)).toHaveCount(0)
  } finally {
    for (const activityId of activityIds) await deleteEntityIfExists(request, token, interactionsPath, activityId)
    await deleteEntityIfExists(request, token, '/api/customers/deals', dealId)
    await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
  }
})
