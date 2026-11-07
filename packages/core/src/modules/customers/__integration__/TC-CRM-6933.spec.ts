import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  createCompanyFixture,
  createDealFixture,
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'

/**
 * TC-CRM-6933: "Mark done" in the interaction history refreshes sibling panels
 * Issue: https://github.com/open-mercato/open-mercato/issues/6933
 *
 * ActivitiesSection must call the page's `onDataRefresh` after a successful
 * mark-done so panels fed by their own fetch (deal "Planned activities",
 * person v2 Activities card) update without a reload, and must leave them
 * untouched when the request fails.
 */

const DAY_MS = 24 * 60 * 60 * 1000

async function createPlannedCall(
  request: APIRequestContext,
  token: string,
  data: { entityId: string; title: string; scheduledAt: string; dealId?: string },
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/customers/interactions', {
    token,
    data: { ...data, interactionType: 'call', status: 'planned' },
  })
  expect(response.ok(), `interaction create should succeed: ${response.status()}`).toBeTruthy()
  const body = (await response.json().catch(() => null)) as { id?: string } | null
  expect(body?.id, 'interaction create should expose an id').toBeTruthy()
  return body!.id as string
}

function historySection(page: Page) {
  return page
    .locator('div')
    .filter({ has: page.getByRole('searchbox', { name: 'Search interaction history' }) })
    .last()
}

function historyMarkDoneButton(page: Page, title: string) {
  return historySection(page)
    .locator('div[role="button"]')
    .filter({ hasText: title })
    .getByRole('button', { name: 'Mark done' })
}

function plannedActivitiesPanel(page: Page) {
  return page
    .locator('div.rounded-lg.border')
    .filter({ hasText: 'Planned activities' })
    .last()
}

async function markDocument(page: Page) {
  await page.evaluate(() => {
    ;(window as unknown as { __tc6933?: boolean }).__tc6933 = true
  })
}

async function expectSameDocument(page: Page) {
  expect(
    await page.evaluate(() => (window as unknown as { __tc6933?: boolean }).__tc6933 === true),
    'page must not reload',
  ).toBe(true)
}

test.describe('TC-CRM-6933: Mark done in interaction history refreshes sibling panels', () => {
  let token: string | null = null
  let companyId: string | null = null
  let personId: string | null = null
  let dealId: string | null = null
  const interactionIds: string[] = []
  const stamp = Date.now()
  const personName = `QA TC-CRM-6933 ${stamp}`
  const callA = `QA 6933 deal call A ${stamp}`
  const callB = `QA 6933 deal call B ${stamp}`
  const overdueCall = `QA 6933 overdue call ${stamp}`

  test.beforeEach(async ({ request }) => {
    token = await getAuthToken(request)
    companyId = await createCompanyFixture(request, token, `QA TC-CRM-6933 Co ${stamp}`)
    personId = await createPersonFixture(request, token, {
      firstName: 'QA',
      lastName: `TC6933-${stamp}`,
      displayName: personName,
      companyEntityId: companyId,
    })
    dealId = await createDealFixture(request, token, {
      title: `QA TC-CRM-6933 deal ${stamp}`,
      companyIds: [companyId],
      personIds: [personId],
    })
    const now = Date.now()
    interactionIds.push(
      await createPlannedCall(request, token, {
        entityId: personId,
        dealId,
        title: callA,
        scheduledAt: new Date(now + 2 * DAY_MS).toISOString(),
      }),
      await createPlannedCall(request, token, {
        entityId: personId,
        dealId,
        title: callB,
        scheduledAt: new Date(now + 3 * DAY_MS).toISOString(),
      }),
      await createPlannedCall(request, token, {
        entityId: personId,
        title: overdueCall,
        scheduledAt: new Date(now - DAY_MS).toISOString(),
      }),
    )
  })

  test.afterEach(async ({ request }) => {
    for (const id of interactionIds.splice(0)) {
      await deleteEntityIfExists(request, token, '/api/customers/interactions', id)
    }
    await deleteEntityIfExists(request, token, '/api/customers/deals', dealId)
    await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    dealId = null
    personId = null
    companyId = null
  })

  async function openDealActivities(page: Page) {
    await login(page, 'admin')
    await page.goto(`/backend/customers/deals/${dealId}?tab=activities`)
    await page.getByLabel('Choose customer record').selectOption(personId!)
    await expect(historyMarkDoneButton(page, callA)).toBeVisible()
  }

  test('deal page: Planned activities drops the completed call without a reload', async ({ page }) => {
    await openDealActivities(page)
    const panel = plannedActivitiesPanel(page)
    await expect(panel).toContainText(callA)
    await expect(panel).toContainText(callB)

    await markDocument(page)
    await historyMarkDoneButton(page, callA).click()

    await expect(page.getByText('Activity marked done')).toBeVisible()
    await expect(panel).not.toContainText(callA)
    await expect(panel).toContainText(callB)
    await expect(historyMarkDoneButton(page, callA)).toHaveCount(0)
    await expectSameDocument(page)
  })

  test('deal page: failed mark done only flashes an error', async ({ page }) => {
    await openDealActivities(page)
    const panel = plannedActivitiesPanel(page)
    await expect(panel).toContainText(callA)
    const panelTextBefore = await panel.innerText()

    await page.route('**/api/customers/interactions/complete', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"forced"}' }),
    )
    await markDocument(page)
    await historyMarkDoneButton(page, callA).click()

    await expect(page.getByText('Could not mark activity as done')).toBeVisible()
    await expect(page.getByText('Activity marked done')).toHaveCount(0)
    expect(await panel.innerText()).toBe(panelTextBefore)
    await expect(historyMarkDoneButton(page, callA)).toBeVisible()
    await expectSameDocument(page)
  })

  test('person v2: Activities card overdue badge clears without a reload', async ({ page }) => {
    await login(page, 'admin')
    await page.goto(`/backend/customers/people-v2/${personId}?tab=activities`)
    await expect(page.getByText('1 overdue', { exact: true })).toBeVisible()
    await expect(historyMarkDoneButton(page, overdueCall)).toBeVisible()

    await markDocument(page)
    await historyMarkDoneButton(page, overdueCall).click()

    await expect(page.getByText('Activity marked done')).toBeVisible()
    await expect(page.getByText('1 overdue', { exact: true })).toHaveCount(0)
    await expectSameDocument(page)
  })
})
