import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { fillControlledInput } from '@open-mercato/core/helpers/integration/ui'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { createCampaign, deleteCampaignIfExists, getCampaign, saveGraph, setEnabled } from './helpers/marketing'

const PROFILE_API = '/api/marketing_automation/customers'
const RULES_PATH = '/api/marketing_automation/score-rules'
const WATCHES_PATH = '/api/marketing_automation/watches'
const LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'
const NOBODY = '00000000-0000-4000-8000-000000000000'

type ProfileBody = {
  recentRuns?: Array<{ status: string; triggerEventId: string }>
  recentScoreEntries?: Array<{ points: number; reason: string | null }>
}

/**
 * Opens the profile and waits for the hydrated client's own profile request.
 *
 * The shell is server-rendered, so anything typed before hydration is wiped; the client asking for the profile is
 * the only reliable signal that the page is interactive.
 */
async function openProfile(page: Page, customerId: string): Promise<void> {
  const loaded = page.waitForResponse((response) =>
    response.url().includes(`${PROFILE_API}/`) && response.request().method() === 'GET')
  await page.goto(`/backend/marketing/customers/${customerId}`, { waitUntil: 'domcontentloaded' })
  await loaded
}

function kpiCard(page: Page, title: string) {
  return page.locator('p').filter({ hasText: new RegExp(`^${title}$`) }).locator('xpath=../..')
}

async function readProfile(request: APIRequestContext, token: string, customerId: string): Promise<ProfileBody | null> {
  const response = await apiRequest(request, 'GET', `${PROFILE_API}/${customerId}/profile`, { token })
  return readJsonSafe<ProfileBody>(response)
}

async function removeRuleByName(request: APIRequestContext, token: string, name: string): Promise<void> {
  const response = await apiRequest(request, 'GET', `${RULES_PATH}?pageSize=100`, { token })
  const body = await readJsonSafe<{ items?: Array<{ id: string; name: string; updatedAt: string }> }>(response)
  const rule = (body?.items ?? []).find((item) => item.name === name)
  if (!rule) return
  await apiRequest(request, 'DELETE', `${RULES_PATH}/${rule.id}`, { token, headers: { [LOCK_HEADER]: rule.updatedAt } })
}

async function disableAndDeleteCampaign(request: APIRequestContext, token: string, campaignId: string | null): Promise<void> {
  if (!campaignId) return
  await getCampaign(request, token, campaignId)
    .then((current) => current.isEnabled
      ? setEnabled(request, token, campaignId, { updatedAt: current.updatedAt, isEnabled: false })
      : undefined)
    .catch(() => undefined)
  await deleteCampaignIfExists(request, token, campaignId)
}

async function confirmDialog(page: Page, button: 'Confirm' | 'Cancel'): Promise<void> {
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: button }).click()
  await expect(dialog).toBeHidden()
}

/**
 * TC-MA-045: the customer marketing profile and the price-watch demand screen, as an operator uses them.
 *
 * Every record here is created by the test and removed in `finally`. The one enabled campaign is narrowed to a
 * display name only the fixture carries, and the one enabled score rule likewise — neither can touch anybody else.
 * The erasure runs only against the test's own fixture.
 */
test.describe('TC-MA-045 customer profile and demand screens', () => {
  test.describe.configure({ timeout: 90_000 })

  test('the profile shows score, tags, score history and campaign runs, and records a consent decision with a reason', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const marker = `QA Profile ${stamp}`
    const email = `qa-ma-045-${stamp}@example.com`
    const tagSlug = `qa-ma-045-${stamp}`
    const reason = `TC-MA-045 points ${stamp}`
    let personId: string | null = null
    let tagId: string | null = null
    let campaignId: string | null = null
    try {
      personId = await createPersonFixture(request, token, { firstName: 'QA', lastName: 'Profile', displayName: marker, primaryEmail: email })
      const tagCreated = await apiRequest(request, 'POST', '/api/customers/tags', { token, data: { label: tagSlug, slug: tagSlug } })
      expect(tagCreated.status(), 'tag create').toBeLessThan(400)
      tagId = (await readJsonSafe<{ id?: string }>(tagCreated))?.id ?? null
      expect(tagId).toBeTruthy()

      campaignId = await createCampaign(request, token, `TC-MA-045 profile ${stamp}`)
      const detail = await getCampaign(request, token, campaignId)
      const saved = await saveGraph(request, token, campaignId, {
        updatedAt: detail.updatedAt,
        name: detail.name,
        triggers: [{ kind: 'event', eventId: 'customers.tag.assigned' }],
        definition: {
          version: 1,
          audience: { operator: 'AND', rules: [{ field: 'customer.displayName', operator: '=', value: marker }] },
          steps: [{ id: 'step-points', type: 'add_points', params: { points: 5, reason } }],
        },
      })
      expect(saved.status(), await saved.text()).toBe(200)
      const afterSave = await getCampaign(request, token, campaignId)
      const enabled = await setEnabled(request, token, campaignId, { updatedAt: afterSave.updatedAt, isEnabled: true })
      expect(enabled.status(), await enabled.text()).toBe(200)

      const assigned = await apiRequest(request, 'POST', '/api/customers/tags/assign', { token, data: { tagId, entityId: personId } })
      expect(assigned.status(), 'tag assign').toBeLessThan(400)

      // The run is started by a worker, so the page is opened only once the profile has something to show.
      await expect.poll(async () => {
        const profile = await readProfile(request, token, personId!)
        return {
          run: profile?.recentRuns?.[0]?.status ?? null,
          points: profile?.recentScoreEntries?.[0]?.points ?? null,
        }
      }, { timeout: 45_000, intervals: [1_000] }).toEqual({ run: 'completed', points: 5 })

      await login(page, 'admin')
      await openProfile(page, personId)

      await expect(page.getByText(marker).first()).toBeVisible()
      await expect(page.getByText(email, { exact: true })).toBeVisible()

      const score = kpiCard(page, 'Lead score')
      await expect(score).toContainText('5')
      await expect(score).toContainText('Bronze · 95 to the next tier')
      await expect(kpiCard(page, 'Orders')).toContainText('Never ordered')
      await expect(kpiCard(page, 'Latest NPS')).toContainText('--')

      await expect(page.getByText('Tags', { exact: true })).toBeVisible()
      await expect(page.getByText(tagSlug, { exact: true })).toBeVisible()

      await expect(page.getByText('Recent score changes')).toBeVisible()
      await expect(page.getByText(`· ${reason}`)).toBeVisible()
      await expect(page.getByText('+5', { exact: true })).toBeVisible()

      await expect(page.getByText('Recent campaign runs')).toBeVisible()
      const runLink = page.getByRole('link', { name: 'customers.tag.assigned' })
      await expect(runLink).toBeVisible()
      await expect(runLink).toHaveAttribute('href', `/backend/marketing/campaigns/${campaignId}/runs`)
      await expect(page.getByRole('listitem').filter({ has: runLink })).toContainText('Completed')

      // Consent: nothing recorded yet, and a decision cannot be written down without saying why.
      await expect(page.getByText('No email preference recorded')).toBeVisible()
      const unsubscribe = page.getByRole('button', { name: 'Record unsubscribe' })
      const subscribe = page.getByRole('button', { name: 'Record consent' })
      await expect(unsubscribe).toBeDisabled()
      await expect(subscribe).toBeDisabled()

      const reasonInput = page.getByLabel('Why (recorded with the change)')
      await fillControlledInput(reasonInput, 'Asked on the phone')
      await expect(unsubscribe).toBeEnabled()
      await unsubscribe.click()
      await expect(page.getByText('Recorded, with your name against it.').first()).toBeVisible({ timeout: 20_000 })
      await expect(page.getByText('Unsubscribed from email')).toBeVisible({ timeout: 20_000 })
      await expect(reasonInput).toHaveValue('')
      await expect(unsubscribe).toBeDisabled()

      await fillControlledInput(reasonInput, 'Wrote to support to opt back in')
      await subscribe.click()
      await expect(page.getByText('Subscribed to email')).toBeVisible({ timeout: 20_000 })
    } finally {
      await disableAndDeleteCampaign(request, token, campaignId)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
      await deleteEntityIfExists(request, token, '/api/customers/tags', tagId)
    }
  })

  test('the explain panel names the gate that decided, and says so when a campaign cannot be explained', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let personId: string | null = null
    let campaignId: string | null = null
    try {
      personId = await createPersonFixture(request, token, { firstName: 'QA', lastName: 'Explain', displayName: `QA Explain ${stamp}` })
      campaignId = await createCampaign(request, token, `TC-MA-045 explain ${stamp}`)

      await login(page, 'admin')
      await openProfile(page, personId)

      await expect(page.getByText('Why did they not get a campaign?')).toBeVisible()
      const explain = page.getByRole('button', { name: 'Explain' })
      await expect(explain).toBeDisabled()

      /**
       * Chosen from a list, not typed.
       *
       * The control used to be a text box asking for a campaign id — a uuid a marketer has no way to know
       * and no reason to hold. It is a `Select` of campaign names now, which is also why the second half of
       * this test changed: an id that belongs to nothing is no longer something the screen can be asked
       * about, so the unexplainable case has to be reached the way it actually happens.
       */
      await page.getByRole('combobox', { name: 'Campaign' }).click()
      const option = page.getByRole('option', { name: `TC-MA-045 explain ${stamp}`, exact: true })
      await expect(option).toBeVisible()
      await option.press('Enter')

      await expect(explain).toBeEnabled()
      await explain.click()

      await expect(page.getByText('They would not receive it right now — The campaign is switched off decided.')).toBeVisible({ timeout: 20_000 })
      for (const gate of ['Audience', 'Consent', 'Customer pause', 'Quiet hours', 'Campaign frequency cap']) {
        await expect(page.getByText(gate, { exact: true })).toBeVisible()
      }

      /**
       * The unexplainable case, as it really arises: the campaign this page listed is gone.
       *
       * Somebody else deleted it between the dropdown loading and the question being asked. The selection is
       * still on screen, so the button is still enabled, and the screen has to say it could not explain that
       * one rather than leaving the previous answer standing under a stale name.
       */
      await deleteCampaignIfExists(request, token, campaignId)
      await explain.click()
      await expect(page.getByText('That campaign could not be explained for this customer.').first()).toBeVisible({ timeout: 20_000 })
      await expect(page.getByText(/They would not receive it right now/)).toBeHidden()
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })

  test('export downloads the subject access file, and erase asks first and then empties the profile', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const marker = `QA Erase ${stamp}`
    const ruleName = `QA TC-MA-045 erase rule ${stamp}`
    let personId: string | null = null
    try {
      personId = await createPersonFixture(request, token, { firstName: 'QA', lastName: 'Erase', displayName: marker })
      const rule = await apiRequest(request, 'POST', RULES_PATH, {
        token,
        data: {
          name: ruleName,
          points: 12,
          expression: { operator: 'AND', rules: [{ field: 'customer.displayName', operator: '=', value: marker }] },
        },
      })
      expect(rule.status(), await rule.text()).toBe(200)
      const rescored = await apiRequest(request, 'POST', `${PROFILE_API}/${personId}/rescore`, { token })
      expect(rescored.status(), await rescored.text()).toBe(200)
      const consent = await apiRequest(request, 'PUT', `${PROFILE_API}/${personId}/consent`, {
        token,
        data: { channel: 'email', state: 'unsubscribed', reason: 'TC-MA-045 before erasure' },
      })
      expect(consent.status(), await consent.text()).toBe(200)

      await login(page, 'admin')
      await openProfile(page, personId)
      await expect(kpiCard(page, 'Lead score')).toContainText('12')
      await expect(page.getByText(`· ${ruleName} +12`)).toBeVisible()
      await expect(page.getByText('Unsubscribed from email')).toBeVisible()

      const downloadStarted = page.waitForEvent('download')
      await page.getByRole('button', { name: 'Export data' }).click()
      const download = await downloadStarted
      expect(download.suggestedFilename()).toBe(`marketing-data-${personId}.json`)
      const exported = JSON.parse(await readFile(await download.path(), 'utf8')) as {
        subjectEntityId?: string
        scoreEntries?: unknown[]
        consent?: unknown[]
      }
      expect(exported.subjectEntityId).toBe(personId)
      expect(exported.scoreEntries?.length).toBeGreaterThan(0)
      expect(Array.isArray(exported.consent)).toBe(true)

      // Cancelling leaves everything as it was.
      await page.getByRole('button', { name: 'Erase data' }).click()
      await expect(page.getByRole('alertdialog')).toContainText('Erase this customer marketing data?')
      await confirmDialog(page, 'Cancel')
      await expect(kpiCard(page, 'Lead score')).toContainText('12')

      await page.getByRole('button', { name: 'Erase data' }).click()
      const reloaded = page.waitForResponse((response) =>
        response.url().includes(`${PROFILE_API}/${personId}/profile`) && response.request().method() === 'GET', { timeout: 30_000 })
      await confirmDialog(page, 'Confirm')
      await reloaded

      // The page reloads onto what is left: no points, no history — and the unsubscribe kept.
      await expect(page.getByText('No points awarded yet.')).toBeVisible({ timeout: 20_000 })
      await expect(kpiCard(page, 'Lead score')).not.toContainText('12')
      await expect(page.getByText('Unsubscribed from email')).toBeVisible()
      await expect(page.getByText('This customer has not entered a campaign yet.')).toBeVisible()
    } finally {
      await removeRuleByName(request, token, ruleName)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })

  test('a card with no value yet still explains why', async ({ page, request }) => {
    // KpiCard used to render only "--" for a null value and drop the footer, so these explanations never showed.
    const token = await getAuthToken(request, 'admin')
    let personId: string | null = null
    try {
      personId = await createPersonFixture(request, token, { firstName: 'QA', lastName: 'Empty', displayName: `QA Empty ${Date.now()}` })
      await login(page, 'admin')
      await openProfile(page, personId)
      await expect(kpiCard(page, 'Latest NPS')).toContainText('Never answered a survey')
      await expect(kpiCard(page, 'Projected value')).toContainText('Needs a second order before a rate can be read')
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })

  test('an unknown customer shows a not-found state with a way back', async ({ page }) => {
    await login(page, 'admin')
    await openProfile(page, NOBODY)
    await expect(page.getByText('This customer no longer exists.')).toBeVisible({ timeout: 20_000 })
    const back = page.getByRole('link', { name: 'Campaigns' }).last()
    await expect(back).toHaveAttribute('href', '/backend/marketing/campaigns')
  })

  test('the demand screen lists a watched product with how many are waiting and how many were told', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const sku = `QA-045-WATCH-${stamp}`
    let personId: string | null = null
    let watch: { id?: string; updatedAt?: string } | null = null
    try {
      personId = await createPersonFixture(request, token, { firstName: 'QA', lastName: 'Watcher', displayName: `QA Watcher ${stamp}` })
      const created = await apiRequest(request, 'POST', WATCHES_PATH, { token, data: { customerId: personId, sku, currencyCode: 'USD' } })
      expect(created.status(), await created.text()).toBe(200)
      watch = await readJsonSafe<{ id?: string; updatedAt?: string }>(created)

      await login(page, 'admin')
      const listed = page.waitForResponse((response) =>
        response.url().includes(WATCHES_PATH) && response.request().method() === 'GET')
      await page.goto('/backend/marketing/demand', { waitUntil: 'domcontentloaded' })
      await listed

      await expect(page.getByText('A customer watching a product is the clearest signal a shop gets.', { exact: false })).toBeVisible()
      await expect(page.getByRole('columnheader', { name: 'Product' })).toBeVisible()
      await expect(page.getByRole('columnheader', { name: 'Waiting' })).toBeVisible()
      await expect(page.getByRole('columnheader', { name: 'Already told' })).toBeVisible()

      const row = page.getByRole('row', { name: new RegExp(sku) })
      await expect(row).toBeVisible({ timeout: 20_000 })
      const cells = row.getByRole('cell')
      await expect(cells.filter({ hasText: sku })).toHaveCount(1)
      await expect(row).toContainText(/1\s*0/)

      // The same watch is listed on the customer's own profile, with the currency it was taken in.
      await openProfile(page, personId)
      await expect(page.getByText('Waiting for a price drop')).toBeVisible()
      await expect(page.getByText(sku, { exact: true })).toBeVisible()
    } finally {
      if (watch?.id && watch.updatedAt) {
        await apiRequest(request, 'DELETE', `${WATCHES_PATH}/${watch.id}`, { token, headers: { [LOCK_HEADER]: watch.updatedAt } })
      }
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })
})
