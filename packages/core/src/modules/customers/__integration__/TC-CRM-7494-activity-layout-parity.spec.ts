import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createCompanyFixture,
  createDealFixture,
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'

/**
 * TC-CRM-7494: Person and company activity tabs share the deal activity layout
 * Issue: #7494 — the same CRM activity workflow rendered three different
 * compositions depending on the record. Person and company detail pages now
 * mount the shared `ActivityLogTab` (inline composer → planned activities →
 * history timeline), scoped to their own record.
 *
 * Verifies:
 *   1. Deal, person and company activity tabs render the same sections in the
 *      same order, each listing its own planned activity, with no "Add new" menu.
 *   2. Logging from the person composer and completing a planned activity refresh
 *      the timeline and the planned list in place (no navigation).
 *   3. A company without activities shows the composer and the empty history, no
 *      planned section, and keeps the layout inside a phone-width viewport.
 *   4. Company history search reaches a row whose only match is beyond the first
 *      page, through the API search, including on tenants with data encryption.
 *   5. A failed company history load shows an error, not an empty history, and
 *      recovers on retry.
 *   6. Company history can be sorted by name in both directions and back to newest.
 *   7. Person and company planned lists keep scheduled activities in a custom open
 *      status and leave out done and canceled ones.
 */

type InteractionInput = {
  entityId: string
  dealId?: string
  interactionType: 'call' | 'meeting' | 'note'
  title: string
  body: string
  status: string
  scheduledAt?: string
  occurredAt?: string
}

async function createInteraction(request: APIRequestContext, token: string, data: InteractionInput): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/customers/interactions', { token, data })
  expect(response.ok(), `POST /api/customers/interactions returned ${response.status()}`).toBeTruthy()
  const body = await response.json().catch(() => null) as { id?: string } | null
  if (body?.id) return body.id
  const operationHeader = response.headers()['x-om-operation'] ?? ''
  const encoded = operationHeader.startsWith('omop:') ? operationHeader.slice('omop:'.length) : ''
  const parsed = encoded ? (JSON.parse(decodeURIComponent(encoded)) as { resourceId?: string }) : null
  expect(parsed?.resourceId, 'create response should expose the interaction id').toBeTruthy()
  return parsed!.resourceId!
}

async function deleteInteraction(request: APIRequestContext, token: string | null, id: string | null): Promise<void> {
  if (!token || !id) return
  await apiRequest(request, 'DELETE', `/api/customers/interactions?id=${encodeURIComponent(id)}`, { token }).catch(() => {})
}

function composerHeading(page: Page) {
  return page.getByRole('heading', { name: /^Log activity$/ }).first()
}

function plannedTitle(page: Page) {
  // The header div also holds the count badge, so match the label without end anchor.
  return page.getByText(/Planned activities/).first()
}

function historyTitle(page: Page) {
  return page.getByText(/Interaction history/).first()
}

function sortControl(page: Page) {
  return page.getByRole('combobox', { name: /^Sort order$/ })
}

function historyPath(companyId: string): string {
  return `/backend/customers/companies-v2/${companyId}?tab=activity-log`
}

// A planned row is a button named by its title first; history rows start with
// their time label, so this stays scoped to the planned section.
function plannedRow(page: Page, title: string) {
  return page.getByRole('button', { name: new RegExp(`^${title} `) })
}

async function expectSharedActivityLayout(page: Page, plannedActivityTitle: string): Promise<void> {
  await expect(composerHeading(page)).toBeVisible({ timeout: 30_000 })
  await expect(plannedTitle(page)).toBeVisible({ timeout: 30_000 })
  await expect(historyTitle(page)).toBeVisible({ timeout: 30_000 })
  await expect(plannedRow(page, plannedActivityTitle)).toBeVisible()

  const [composerBox, plannedBox, historyBox] = await Promise.all([
    composerHeading(page).boundingBox(),
    plannedTitle(page).boundingBox(),
    historyTitle(page).boundingBox(),
  ])
  expect(composerBox && plannedBox && historyBox, 'all three sections should be laid out').toBeTruthy()
  expect(composerBox!.y).toBeLessThan(plannedBox!.y)
  expect(plannedBox!.y).toBeLessThan(historyBox!.y)

  await expect(page.getByRole('button', { name: /^Add new$/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Save activity$/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Schedule$/ }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /^Call$/ }).first()).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByPlaceholder(/what happened\?/i)).toBeVisible()
  await expect(page.getByPlaceholder(/^Search/i).first()).toBeVisible()
}

// The composer's week preview repeats this week's titles, so history rows are read outside it.
const historyText = (page: Page, text: string | RegExp) =>
  page.getByText(text, { exact: typeof text === 'string' })
    .locator('xpath=self::*[not(ancestor::*[@id="inline-activity-composer-week-preview"])]')

test.describe('TC-CRM-7494: shared activity layout on person and company pages', () => {
  test('deal, person and company activity tabs render the same sections scoped to their record', async ({ page, request }) => {
    test.slow()
    const stamp = Date.now()
    let token: string | null = null
    let companyId: string | null = null
    let personId: string | null = null
    let dealId: string | null = null
    const interactionIds: string[] = []

    try {
      token = await getAuthToken(request, 'admin')
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-7494 Co ${stamp}`)
      personId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: `TC7494-${stamp}`,
        displayName: `QA TC-CRM-7494 Person ${stamp}`,
        companyEntityId: companyId,
      })
      dealId = await createDealFixture(request, token, { title: `QA TC-CRM-7494 Deal ${stamp}`, companyIds: [companyId] })

      const inOneHour = new Date(Date.now() + 60 * 60 * 1000).toISOString()
      const companyPlanned = `QA 7494 company call ${stamp}`
      const personPlanned = `QA 7494 person call ${stamp}`
      const dealPlanned = `QA 7494 deal call ${stamp}`
      interactionIds.push(await createInteraction(request, token, {
        entityId: companyId, interactionType: 'call', title: companyPlanned, body: 'Company follow-up', status: 'planned', scheduledAt: inOneHour,
      }))
      interactionIds.push(await createInteraction(request, token, {
        entityId: personId, interactionType: 'call', title: personPlanned, body: 'Person follow-up', status: 'planned', scheduledAt: inOneHour,
      }))
      interactionIds.push(await createInteraction(request, token, {
        entityId: companyId, dealId, interactionType: 'call', title: dealPlanned, body: 'Deal follow-up', status: 'planned', scheduledAt: inOneHour,
      }))

      await login(page, 'admin')

      await page.goto(`/backend/customers/deals/${dealId}?tab=activities`, { waitUntil: 'domcontentloaded' })
      await expectSharedActivityLayout(page, dealPlanned)
      // The deal planned list is deal-scoped: the company's own planned call stays out of it
      // (the entity-wide history below may still list it, as it did before).
      await expect(plannedRow(page, companyPlanned)).toHaveCount(0)

      await page.goto(`/backend/customers/people-v2/${personId}?tab=activities`, { waitUntil: 'domcontentloaded' })
      await expectSharedActivityLayout(page, personPlanned)
      await expect(plannedRow(page, companyPlanned)).toHaveCount(0)
      await expect(sortControl(page)).toBeVisible()

      await page.goto(`/backend/customers/companies-v2/${companyId}?tab=activity-log`, { waitUntil: 'domcontentloaded' })
      await expectSharedActivityLayout(page, companyPlanned)
      await expect(sortControl(page)).toBeVisible()
      // Entity-wide: the deal-linked call owned by the company is listed too, the person's is not.
      await expect(plannedRow(page, dealPlanned)).toBeVisible()
      await expect(plannedRow(page, personPlanned)).toHaveCount(0)
    } finally {
      for (const id of interactionIds) await deleteInteraction(request, token, id)
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })

  test('logging and completing activities on a person refresh the tab in place', async ({ page, request }) => {
    test.slow()
    const stamp = Date.now()
    let token: string | null = null
    let personId: string | null = null
    const interactionIds: string[] = []

    try {
      token = await getAuthToken(request, 'admin')
      personId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: `TC7494b-${stamp}`,
        displayName: `QA TC-CRM-7494 Logger ${stamp}`,
      })
      const plannedTitleText = `QA 7494 planned meeting ${stamp}`
      interactionIds.push(await createInteraction(request, token, {
        entityId: personId, interactionType: 'meeting', title: plannedTitleText, body: 'Planned', status: 'planned',
        scheduledAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      }))

      await login(page, 'admin')
      await page.goto(`/backend/customers/people-v2/${personId}?tab=activities`, { waitUntil: 'domcontentloaded' })
      await expectSharedActivityLayout(page, plannedTitleText)
      await page.evaluate(() => { (window as unknown as { __tc7494: boolean }).__tc7494 = true })

      const loggedText = `QA 7494 inline note ${stamp}`
      const createdPromise = page.waitForResponse((response) =>
        response.url().includes('/api/customers/interactions') && response.request().method() === 'POST')
      await page.getByPlaceholder(/what happened\?/i).fill(loggedText)
      await page.getByRole('button', { name: /^Save activity$/ }).click()
      const created = await createdPromise
      expect(created.status(), await created.text()).toBe(201)
      const createdBody = await created.json().catch(() => null) as { id?: string } | null
      if (createdBody?.id) interactionIds.push(createdBody.id)
      await expect(page.getByText(loggedText, { exact: true }).first()).toBeVisible({ timeout: 15_000 })
      await expect(page.getByPlaceholder(/what happened\?/i)).toHaveValue('')

      const completedPromise = page.waitForResponse((response) =>
        response.url().includes('/api/customers/interactions/complete') && response.request().method() === 'POST')
      await page.getByRole('button', { name: /^Mark done$/ }).first().click()
      const completed = await completedPromise
      expect(completed.ok(), await completed.text()).toBeTruthy()
      await expect(plannedTitle(page)).toHaveCount(0, { timeout: 15_000 })
      await expect(page.getByText(plannedTitleText, { exact: true }).first()).toBeVisible()

      const stillSamePage = await page.evaluate(() => (window as unknown as { __tc7494?: boolean }).__tc7494 === true)
      expect(stillSamePage, 'mutations must refresh in place without a full reload').toBe(true)
      expect(page.url()).toContain(`/backend/customers/people-v2/${personId}`)
    } finally {
      for (const id of interactionIds) await deleteInteraction(request, token, id)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })

  test('a company without activities shows the composer and empty history inside a phone viewport', async ({ page, request }) => {
    test.slow()
    const stamp = Date.now()
    let token: string | null = null
    let companyId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-7494 Empty ${stamp}`)

      await login(page, 'admin')
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(`/backend/customers/companies-v2/${companyId}?tab=activity-log`, { waitUntil: 'domcontentloaded' })

      await expect(composerHeading(page)).toBeVisible({ timeout: 30_000 })
      await expect(historyTitle(page)).toBeVisible({ timeout: 30_000 })
      await expect(plannedTitle(page)).toHaveCount(0)
      await expect(page.getByText(/No activit/i).first()).toBeVisible()
      await expect(page.getByRole('button', { name: /^Add new$/ })).toHaveCount(0)

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(overflow, 'activity tab must not overflow a phone-width viewport').toBeLessThanOrEqual(1)
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })

  test('person and company planned lists keep custom open statuses and leave out terminal ones', async ({ page, request }) => {
    test.slow()
    const stamp = Date.now()
    const scheduledAt = new Date(Date.now() + 86_400_000).toISOString()
    const interactionIds: string[] = []
    let token: string | null = null
    let companyId: string | null = null
    let personId: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-7494 Status Co ${stamp}`)
      personId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: `Status ${stamp}`,
        displayName: `QA Status ${stamp}`,
        companyEntityId: companyId,
      })
      const records = [
        { entityId: personId, path: `/backend/customers/people-v2/${personId}?tab=activities`, label: 'Person' },
        { entityId: companyId, path: historyPath(companyId), label: 'Company' },
      ]
      for (const record of records) {
        const titleFor = (status: string) => `QA ${record.label} ${status} ${stamp}`
        for (const status of ['in_progress', 'done', 'canceled']) {
          interactionIds.push(await createInteraction(request, token, {
            entityId: record.entityId,
            interactionType: 'call',
            title: titleFor(status),
            body: 'Status coverage',
            status,
            scheduledAt,
          }))
        }
      }

      await login(page, 'admin')
      for (const record of records) {
        const titleFor = (status: string) => `QA ${record.label} ${status} ${stamp}`
        await page.goto(record.path, { waitUntil: 'domcontentloaded' })
        await expect(plannedRow(page, titleFor('in_progress'))).toBeVisible({ timeout: 30_000 })
        await expect(plannedRow(page, titleFor('done'))).toHaveCount(0)
        await expect(plannedRow(page, titleFor('canceled'))).toHaveCount(0)
      }
    } finally {
      for (const id of interactionIds) await deleteInteraction(request, token, id)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })

  test('company history search reaches a row whose only match is beyond the first page', async ({ page, request }) => {
    test.setTimeout(180_000)
    const stamp = Date.now()
    let token: string | null = null
    let companyId: string | null = null
    const interactionIds: string[] = []

    try {
      token = await getAuthToken(request, 'admin')
      const authToken = token
      companyId = await createCompanyFixture(request, authToken, `QA TC-CRM-7494 Search ${stamp}`)
      const ownerId = companyId
      const matchTitle = `QA 7494 needle ${stamp}`
      const fillerTitle = (index: number) => `QA 7494 filler ${index} ${stamp}`
      interactionIds.push(await createInteraction(request, authToken, {
        entityId: ownerId, interactionType: 'note', title: matchTitle, body: 'Oldest', status: 'done',
        occurredAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      }))
      const fillerIndexes = Array.from({ length: 50 }, (_, index) => index)
      for (let start = 0; start < fillerIndexes.length; start += 10) {
        const created = await Promise.all(fillerIndexes.slice(start, start + 10).map((index) => createInteraction(request, authToken, {
          entityId: ownerId, interactionType: 'note', title: fillerTitle(index), body: 'Filler', status: 'done',
          occurredAt: new Date(Date.now() - (index + 1) * 60 * 60 * 1000).toISOString(),
        })))
        interactionIds.push(...created)
      }

      await login(page, 'admin')
      await page.goto(historyPath(ownerId), { waitUntil: 'domcontentloaded' })
      await expect(historyText(page, fillerTitle(0))).toBeVisible({ timeout: 30_000 })
      const match = historyText(page, matchTitle)
      await expect(match).toHaveCount(0)

      const searched = page.waitForResponse((response) => {
        const url = new URL(response.url())
        return url.pathname === '/api/customers/interactions'
          && url.searchParams.get('search') === matchTitle
          && !url.searchParams.has('cursor')
      })
      await page.getByRole('searchbox', { name: /Search interaction history/i }).fill(matchTitle)
      expect((await searched).ok()).toBeTruthy()

      await expect(async () => {
        const loadMore = page.getByRole('button', { name: /^Load more$/ })
        if (await match.count() === 0 && await loadMore.count() > 0) await loadMore.click()
        await expect(match).toBeVisible({ timeout: 2_000 })
      }).toPass({ timeout: 30_000 })
      await expect(historyText(page, fillerTitle(0))).toHaveCount(0)
    } finally {
      await Promise.all(interactionIds.map((id) => deleteInteraction(request, token, id)))
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })

  test('a failed company history load shows an error and recovers on retry', async ({ page, request }) => {
    test.slow()
    const stamp = Date.now()
    let token: string | null = null
    let companyId: string | null = null
    const interactionIds: string[] = []

    try {
      token = await getAuthToken(request, 'admin')
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-7494 Failure ${stamp}`)
      const rowTitle = `QA 7494 restored ${stamp}`
      interactionIds.push(await createInteraction(request, token, {
        entityId: companyId, interactionType: 'note', title: rowTitle, body: 'Restored', status: 'done',
        occurredAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      }))

      let historyFails = true
      await page.route((url) => url.pathname === '/api/customers/interactions', async (route) => {
        const url = new URL(route.request().url())
        const isHistoryRead = route.request().method() === 'GET' && url.searchParams.get('limit') === '50'
        if (historyFails && isHistoryRead) {
          await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Injected failure' }) })
          return
        }
        await route.fallback()
      })

      await login(page, 'admin')
      await page.goto(historyPath(companyId), { waitUntil: 'domcontentloaded' })

      const failure = page.getByRole('alert').filter({ hasText: /Failed to load activities/ })
      await expect(failure).toBeVisible({ timeout: 30_000 })
      await expect(page.getByText(/No activities match/)).toHaveCount(0)

      historyFails = false
      await failure.getByRole('button', { name: /^Retry$/ }).click()

      await expect(historyText(page, rowTitle)).toBeVisible({ timeout: 15_000 })
      await expect(failure).toHaveCount(0)
    } finally {
      for (const id of interactionIds) await deleteInteraction(request, token, id)
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })

  test('company history sorts by name in both directions and back to newest', async ({ page, request }) => {
    test.slow()
    const stamp = Date.now()
    let token: string | null = null
    let companyId: string | null = null
    const interactionIds: string[] = []

    try {
      token = await getAuthToken(request, 'admin')
      const authToken = token
      companyId = await createCompanyFixture(request, authToken, `QA TC-CRM-7494 Sort ${stamp}`)
      const ownerId = companyId
      const titled = (name: string) => `QA 7494 sort ${name} ${stamp}`
      const hoursAgo = { Mike: 1, Zulu: 2, Alpha: 3 }
      for (const [name, hours] of Object.entries(hoursAgo)) {
        interactionIds.push(await createInteraction(request, authToken, {
          entityId: ownerId, interactionType: 'note', title: titled(name), body: name, status: 'done',
          occurredAt: new Date(Date.now() - hours * 60 * 60 * 1000).toISOString(),
        }))
      }

      await login(page, 'admin')
      await page.goto(historyPath(ownerId), { waitUntil: 'domcontentloaded' })

      const rows = historyText(page, new RegExp(`^QA 7494 sort \\w+ ${stamp}$`))
      const expectOrder = (names: string[]) => expect.poll(() => rows.allTextContents(), { timeout: 15_000 })
        .toEqual(names.map(titled))
      const chooseSort = async (option: RegExp) => {
        await sortControl(page).click()
        await page.getByRole('option', { name: option }).click()
      }

      await expectOrder(['Mike', 'Zulu', 'Alpha'])
      await chooseSort(/Name Z-A/)
      await expectOrder(['Zulu', 'Mike', 'Alpha'])
      await chooseSort(/Name A-Z/)
      await expectOrder(['Alpha', 'Mike', 'Zulu'])
      await chooseSort(/newest/)
      await expectOrder(['Mike', 'Zulu', 'Alpha'])
    } finally {
      for (const id of interactionIds) await deleteInteraction(request, token, id)
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })
})
