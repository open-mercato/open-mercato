import { expect, test } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import {
  createCampaign,
  deleteCampaignIfExists,
  getCampaign,
  listRuns,
  minimalGraph,
  saveGraph,
  setEnabled,
} from './helpers/marketing'

const SETTLE = { timeout: 30_000, intervals: [500, 1000, 2000] }
const UNKNOWN_CAMPAIGN = '11111111-1111-4111-8111-111111111111'

type RunSummary = { id: string; subjectEntityId: string | null; status: string }

async function createTag(request: APIRequestContext, token: string, label: string): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/customers/tags', { token, data: { label, slug: label } })
  expect(response.status(), 'tag create').toBeLessThan(400)
  return ((await readJsonSafe<{ id?: string }>(response))?.id) as string
}

async function runsOf(request: APIRequestContext, token: string, campaignId: string): Promise<RunSummary[]> {
  const body = await readJsonSafe<{ items?: RunSummary[] }>(await listRuns(request, token, campaignId))
  return body?.items ?? []
}

async function openRuns(page: Page, campaignId: string): Promise<void> {
  const listed = page.waitForResponse((response) =>
    response.url().includes(`/api/marketing_automation/campaigns/${campaignId}/runs`) && response.request().method() === 'GET')
  await page.goto(`/backend/marketing/campaigns/${campaignId}/runs`, { waitUntil: 'domcontentloaded' })
  await listed
}

async function openResults(page: Page, campaignId: string): Promise<void> {
  const loaded = page.waitForResponse((response) =>
    response.url().includes(`/api/marketing_automation/campaigns/${campaignId}/tracking`) && response.request().method() === 'GET')
  await page.goto(`/backend/marketing/campaigns/${campaignId}/results`, { waitUntil: 'domcontentloaded' })
  await loaded
}

/**
 * TC-MA-043: the campaign results and runs screens.
 *
 * The live campaign here listens for a tag being assigned and its audience is this test's own customer by display
 * name, so no other customer in the installation can enter it. It ends on a long wait, which parks the run in
 * `waiting` — a state the screen can be asserted on without racing the worker.
 */
test.describe('TC-MA-043 campaign results and runs screens', () => {
  test.describe.configure({ timeout: 90_000 })

  test('a campaign nobody has entered shows empty results and runs, and each screen links to the other', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const name = `TC-MA-043 empty ${Date.now()}`
    let campaignId: string | null = null
    try {
      campaignId = await createCampaign(request, token, name)
      const detail = await getCampaign(request, token, campaignId)
      expect((await saveGraph(request, token, campaignId, minimalGraph(detail.updatedAt, name))).status()).toBe(200)

      await login(page, 'admin')
      await openResults(page, campaignId)

      await expect(page.getByText(name, { exact: true })).toBeVisible()
      for (const kpi of ['Sent', 'Opened', 'Clicked', 'Attributed revenue']) {
        await expect(page.getByText(kpi, { exact: true }).first()).toBeVisible()
      }
      await expect(page.getByText('unique recipients').first()).toBeVisible()
      await expect(page.getByText(/linear split, \d+-day window/)).toBeVisible()
      await expect(page.getByText('A/B results')).toBeVisible()
      await expect(page.getByText('This campaign has no A/B split, or nobody has entered one yet.')).toBeVisible()
      // Nothing has happened, so the sections that only make sense with activity stay out of the way.
      await expect(page.getByText('Funnel', { exact: true })).toHaveCount(0)
      await expect(page.getByText('Step by step', { exact: true })).toHaveCount(0)
      await expect(page.getByText('Over time', { exact: true })).toHaveCount(0)
      await expect(page.getByText('What they clicked', { exact: true })).toHaveCount(0)

      const runsListed = page.waitForResponse((response) =>
        response.url().includes(`/api/marketing_automation/campaigns/${campaignId}/runs`) && response.request().method() === 'GET')
      await page.getByRole('link', { name: 'Runs', exact: true }).last().click()
      await expect(page).toHaveURL(new RegExp(`/backend/marketing/campaigns/${campaignId}/runs$`))
      await runsListed

      await expect(page.getByText(name, { exact: true })).toBeVisible()
      await expect(page.getByText('This campaign has not run yet.')).toBeVisible()
      await expect(page.getByText('A run appears here for every customer the campaign starts for.')).toBeVisible()
      for (const filter of ['All', 'Waiting', 'Running', 'Completed', 'Given up']) {
        await expect(page.getByRole('button', { name: filter, exact: true })).toBeVisible()
      }
      for (const column of ['Status', 'Customer', 'Trigger', 'Progress', 'Started', 'Resumes', 'Attempts']) {
        await expect(page.getByRole('columnheader', { name: column, exact: true })).toBeVisible()
      }

      await page.getByRole('link', { name: 'Results', exact: true }).last().click()
      await expect(page).toHaveURL(new RegExp(`/backend/marketing/campaigns/${campaignId}/results$`))
      await expect(page.getByText('A/B results')).toBeVisible({ timeout: 20_000 })
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('a real run is listed, filtered by status, opened step by step, and counted in the results', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const marker = `QA Results Runs ${stamp}`
    const name = `TC-MA-043 live ${stamp}`
    let personId: string | null = null
    let tagId: string | null = null
    let campaignId: string | null = null
    try {
      personId = await createPersonFixture(request, token, { firstName: 'QA', lastName: 'ResultsRuns', displayName: marker })
      tagId = await createTag(request, token, `qa-results-runs-${stamp}`)

      campaignId = await createCampaign(request, token, name)
      const detail = await getCampaign(request, token, campaignId)
      const saved = await saveGraph(request, token, campaignId, {
        updatedAt: detail.updatedAt,
        name,
        triggers: [{ kind: 'event', eventId: 'customers.tag.assigned' }],
        definition: {
          version: 1,
          audience: { operator: 'AND', rules: [{ field: 'customer.displayName', operator: '=', value: marker }] },
          steps: [
            {
              id: 'sp1',
              type: 'split',
              params: {
                variants: [
                  { key: 'a', weight: 1, steps: [{ id: 'pts-a', type: 'add_points', params: { points: 1, reason: 'TC-MA-043' } }] },
                  { key: 'b', weight: 1, steps: [{ id: 'pts-b', type: 'add_points', params: { points: 1, reason: 'TC-MA-043' } }] },
                ],
              },
            },
            { id: 'hold', type: 'wait', params: { minutes: 10080 } },
            { id: 'pts-end', type: 'add_points', params: { points: 1, reason: 'TC-MA-043' } },
          ],
        },
      })
      expect(saved.status()).toBe(200)
      const afterSave = await getCampaign(request, token, campaignId)
      expect((await setEnabled(request, token, campaignId, { updatedAt: afterSave.updatedAt, isEnabled: true })).status()).toBe(200)

      const assigned = await apiRequest(request, 'POST', '/api/customers/tags/assign', { token, data: { tagId, entityId: personId } })
      expect(assigned.status()).toBeLessThan(400)

      await expect.poll(async () => {
        const runs = await runsOf(request, token, campaignId!)
        return runs.filter((run) => run.subjectEntityId === personId).map((run) => run.status).join(',')
      }, SETTLE).toBe('waiting')

      await login(page, 'admin')
      await openRuns(page, campaignId)

      await expect(page.getByText(name, { exact: true })).toBeVisible()
      // By name, not by a uuid prefix: the column shows who the run is about, and the assertion says so.
      const row = page.getByRole('row').filter({ hasText: marker })
      await expect(row).toHaveCount(1)
      await expect(row).toContainText('Waiting')
      // The trigger reads as a sentence. The event id stays in the title attribute for whoever is
      // debugging, and this asserts the thing an operator actually sees.
      await expect(row).toContainText('Tag added to a customer')
      await expect(row.getByTitle('customers.tag.assigned')).toHaveCount(1)
      await expect(row).toContainText(/\d+ done, 0 skipped/)
      await expect(row.getByRole('cell').nth(5)).not.toHaveText('—')
      const profileLink = row.getByRole('link', { name: marker })
      await expect(profileLink).toHaveAttribute('href', `/backend/marketing/customers/${personId}`)
      await expect(profileLink).toHaveAttribute('title', 'Open the customer profile')

      await row.getByRole('button', { name: 'Steps' }).click()
      const stepLog = page.locator('ol').filter({ hasText: 'Add score points' })
      await expect(stepLog).toBeVisible()
      await expect(stepLog.getByText('done').first()).toBeVisible()
      await expect(stepLog).toContainText('+1 points')
      await row.getByRole('button', { name: 'Steps' }).click()
      await expect(stepLog).toBeHidden()

      const filterTo = async (label: string) => {
        const refetched = page.waitForResponse((response) =>
          response.url().includes(`/api/marketing_automation/campaigns/${campaignId}/runs`) && response.request().method() === 'GET')
        await page.getByRole('button', { name: label, exact: true }).click()
        await refetched
      }
      await filterTo('Completed')
      await expect(row).toHaveCount(0)
      await expect(page.getByText('This campaign has not run yet.')).toBeVisible()
      await filterTo('Waiting')
      await expect(row).toHaveCount(1)
      await filterTo('Given up')
      await expect(row).toHaveCount(0)
      await filterTo('All')
      await expect(row).toHaveCount(1)

      const resultsLoaded = page.waitForResponse((response) =>
        response.url().includes(`/api/marketing_automation/campaigns/${campaignId}/tracking`) && response.request().method() === 'GET')
      await page.getByRole('link', { name: 'Results', exact: true }).last().click()
      await resultsLoaded
      await expect(page).toHaveURL(new RegExp(`/backend/marketing/campaigns/${campaignId}/results$`))

      await expect(page.getByText('Funnel', { exact: true })).toBeVisible()
      await expect(page.getByText('People, not messages — one person going through the campaign once counts once at each stage.')).toBeVisible()
      /**
       * The funnel is drawn as a funnel.
       *
       * The rate lives on the JOIN between two bands — the place the drop happens — and not only in the
       * table underneath. One person entered and one was messaged, so the first join carries everybody.
       */
      await expect(page.getByText('100.0% carried on').first()).toBeVisible()
      const enteredRow = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'Entered', exact: true }) })
      await expect(enteredRow.getByRole('cell').nth(1)).toHaveText('1')

      await expect(page.getByText('Step by step', { exact: true })).toBeVisible()
      await expect(page.getByRole('columnheader', { name: 'Of the first step' })).toBeVisible()
      const laneRows = page.getByRole('row').filter({ hasText: /pts-(a|b)\s*add_points\s*in lane (a|b)/ })
      await expect(laneRows).toHaveCount(2)
      const walkedLane = laneRows.filter({ has: page.getByRole('cell', { name: '1', exact: true }) })
      await expect(walkedLane).toHaveCount(1)

      const splitCard = page.locator('div.rounded-md').filter({ hasText: 'sp1' }).filter({ has: page.getByRole('columnheader', { name: 'Variant' }) })
      await expect(splitCard).toBeVisible()
      await expect(splitCard).toContainText('Not enough data yet')
      await expect(splitCard.getByRole('button', { name: 'End the test, keep this variant' })).toHaveCount(0)
      for (const column of ['Variant', 'Entered', 'Sent', 'Reached', 'Open rate', 'Click rate', 'Revenue', 'Per recipient']) {
        await expect(splitCard.getByRole('columnheader', { name: column, exact: true })).toBeVisible()
      }
      const variantRows = splitCard.getByRole('row').filter({ has: page.getByRole('cell', { name: /^(a|b)$/ }) })
      await expect(variantRows).toHaveCount(2)
      await expect(variantRows.filter({ has: page.getByRole('cell', { name: '1', exact: true }) })).toHaveCount(1)
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
      await deleteEntityIfExists(request, token, '/api/customers/tags', tagId)
    }
  })

  test('the customer link on a run opens the profile, and the profile leads back to the runs', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const marker = `QA Runs Profile ${stamp}`
    const name = `TC-MA-043 profile ${stamp}`
    let personId: string | null = null
    let tagId: string | null = null
    let campaignId: string | null = null
    try {
      personId = await createPersonFixture(request, token, { firstName: 'QA', lastName: 'RunsProfile', displayName: marker })
      tagId = await createTag(request, token, `qa-runs-profile-${stamp}`)

      campaignId = await createCampaign(request, token, name)
      const detail = await getCampaign(request, token, campaignId)
      const saved = await saveGraph(request, token, campaignId, {
        updatedAt: detail.updatedAt,
        name,
        triggers: [{ kind: 'event', eventId: 'customers.tag.assigned' }],
        definition: {
          version: 1,
          audience: { operator: 'AND', rules: [{ field: 'customer.displayName', operator: '=', value: marker }] },
          steps: [{ id: 'pts', type: 'add_points', params: { points: 1, reason: 'TC-MA-043' } }],
        },
      })
      expect(saved.status()).toBe(200)
      const afterSave = await getCampaign(request, token, campaignId)
      expect((await setEnabled(request, token, campaignId, { updatedAt: afterSave.updatedAt, isEnabled: true })).status()).toBe(200)

      const assigned = await apiRequest(request, 'POST', '/api/customers/tags/assign', { token, data: { tagId, entityId: personId } })
      expect(assigned.status()).toBeLessThan(400)
      await expect.poll(async () => {
        const runs = await runsOf(request, token, campaignId!)
        return runs.filter((run) => run.subjectEntityId === personId).map((run) => run.status).join(',')
      }, SETTLE).toBe('completed')

      await login(page, 'admin')
      await openRuns(page, campaignId)
      const row = page.getByRole('row').filter({ hasText: marker })
      await expect(row).toContainText('Completed')
      await expect(row).toContainText('1 done, 0 skipped')

      await row.getByRole('link', { name: marker }).click()
      await expect(page).toHaveURL(new RegExp(`/backend/marketing/customers/${personId}$`))
      await expect(page.getByText('Recent campaign runs')).toBeVisible({ timeout: 20_000 })

      const backToRuns = page.getByRole('link', { name: 'customers.tag.assigned' })
      await expect(backToRuns).toHaveAttribute('href', `/backend/marketing/campaigns/${campaignId}/runs`)
      const relisted = page.waitForResponse((response) =>
        response.url().includes(`/api/marketing_automation/campaigns/${campaignId}/runs`) && response.request().method() === 'GET')
      await backToRuns.click()
      await relisted
      await expect(page).toHaveURL(new RegExp(`/backend/marketing/campaigns/${campaignId}/runs$`))
      await expect(page.getByText(name, { exact: true })).toBeVisible()
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
      await deleteEntityIfExists(request, token, '/api/customers/tags', tagId)
    }
  })

  test('a campaign that cannot be read says so on both screens, and the runs screen offers a retry', async ({ page }) => {
    await login(page, 'admin')

    await openResults(page, UNKNOWN_CAMPAIGN)
    await expect(page.getByText('Could not load the results.')).toBeVisible()
    await expect(page.getByText('A/B results')).toHaveCount(0)

    await openRuns(page, UNKNOWN_CAMPAIGN)
    await expect(page.getByText('The runs could not be loaded.')).toBeVisible()

    const retried = page.waitForResponse((response) =>
      response.url().includes(`/api/marketing_automation/campaigns/${UNKNOWN_CAMPAIGN}/runs`) && response.request().method() === 'GET')
    await page.getByRole('button', { name: 'Try again' }).click()
    expect((await retried).status()).toBe(404)
    await expect(page.getByText('The runs could not be loaded.')).toBeVisible()
  })

  test('a runs list that failed to load does not also claim the campaign has not run', async ({ page }) => {
    await login(page, 'admin')
    await openRuns(page, UNKNOWN_CAMPAIGN)
    await expect(page.getByText('The runs could not be loaded.')).toBeVisible()
    await expect(page.getByText('This campaign has not run yet.')).toHaveCount(0)
  })
})
