import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { fillControlledInput } from '@open-mercato/core/helpers/integration/ui'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { createCampaign, deleteCampaignIfExists } from './helpers/marketing'

const HOOKS_PATH = '/api/marketing_automation/inbound-hooks'
const JOBS_PATH = '/api/marketing_automation/jobs'
const RULES_PATH = '/api/marketing_automation/score-rules'
const SETTINGS_PATH = '/api/marketing_automation/settings'
const ROUTING_PATH = '/api/marketing_automation/lead-routing'
const REFERRALS_PATH = '/api/marketing_automation/referrals'
const LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'

type Hook = { id: string; name: string; url: string | null; hasUrl: boolean; revokedAt: string | null; updatedAt: string }
type JobRun = { id: string; kind: string; status: string; campaignId: string | null; counters: Record<string, number> | null }

async function listHooks(request: APIRequestContext, token: string, campaignId: string): Promise<Hook[]> {
  const response = await apiRequest(request, 'GET', `${HOOKS_PATH}?campaignId=${campaignId}`, { token })
  return (await readJsonSafe<{ items?: Hook[] }>(response))?.items ?? []
}

async function removeHooksOf(request: APIRequestContext, token: string, campaignId: string | null): Promise<void> {
  if (!campaignId) return
  for (const hook of await listHooks(request, token, campaignId)) {
    await apiRequest(request, 'DELETE', `${HOOKS_PATH}/${hook.id}`, { token, headers: { [LOCK_HEADER]: hook.updatedAt } })
  }
}

async function createHook(request: APIRequestContext, token: string, campaignId: string, name: string): Promise<Hook> {
  const response = await apiRequest(request, 'POST', HOOKS_PATH, { token, data: { campaignId, name } })
  expect(response.status(), 'hook create').toBe(200)
  return (await readJsonSafe<Hook>(response)) as Hook
}

/** The list GET is the hydration signal: the shell is server-rendered, so typing before it lands is wiped. */
async function openScreen(page: Page, url: string, apiPath: string): Promise<void> {
  const listed = page.waitForResponse((response) =>
    response.url().includes(apiPath) && response.request().method() === 'GET')
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await listed
}

async function readLeadRoutingPool(request: APIRequestContext, token: string): Promise<string[]> {
  const response = await apiRequest(request, 'GET', SETTINGS_PATH, { token })
  expect(response.ok(), 'settings read').toBe(true)
  return (await readJsonSafe<{ leadRoutingUserIds?: string[] }>(response))?.leadRoutingUserIds ?? []
}

async function writeLeadRoutingPool(request: APIRequestContext, token: string, pool: string[]): Promise<void> {
  const response = await apiRequest(request, 'PUT', SETTINGS_PATH, { token, data: { leadRoutingUserIds: pool } })
  expect(response.status(), 'settings write').toBe(200)
}

/**
 * TC-MA-046: the inbound hooks, job history, lead routing and referrals screens.
 *
 * Every record is this spec's own. The campaigns stay disabled, the score rule that provokes a job pass is off
 * and narrowed to a name no other customer has, and the lead-routing pool — tenant configuration — is put back
 * exactly as it was found.
 */
test.describe('TC-MA-046 hooks, jobs, lead routing and referrals screens', () => {
  test.describe.configure({ timeout: 90_000 })

  test('an operator creates a hook for a campaign, copies its URL, revokes and restores it', async ({ page, request, context }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const campaignName = `QA TC-MA-046 hooks ${stamp}`
    const hookName = `QA hook ${stamp}`
    let campaignId: string | null = null
    try {
      campaignId = await createCampaign(request, token, campaignName)
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await login(page, 'admin')
      await openScreen(page, '/backend/marketing/inbound-hooks', HOOKS_PATH)

      await expect(page.getByText('New hook')).toBeVisible()
      const createButton = page.getByRole('button', { name: 'Create hook' })
      await expect(createButton).toBeDisabled()

      await page.locator('#hook-campaign').click()
      await page.getByRole('option', { name: campaignName }).click()
      await expect(page.locator('#hook-campaign')).toContainText(campaignName)
      await expect(createButton).toBeDisabled()
      await fillControlledInput(page.locator('#hook-name'), hookName)
      await expect(createButton).toBeEnabled()
      await createButton.click()

      const row = page.getByRole('row', { name: new RegExp(hookName) })
      await expect(row).toBeVisible({ timeout: 20_000 })
      await expect(page.locator('#hook-name')).toHaveValue('')
      await expect(row.getByRole('link', { name: campaignName })).toHaveAttribute('href', `/backend/marketing/campaigns/${campaignId}`)
      await expect(row).toContainText('Live')
      await expect(row).toContainText('Never used')

      const [created] = await listHooks(request, token, campaignId)
      expect(created?.name).toBe(hookName)
      if (created.url) {
        await row.getByRole('button', { name: 'Copy URL' }).click()
        await expect(page.getByText('URL copied.')).toBeVisible()
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(created.url)
      } else {
        await expect(row).toContainText('No signing secret configured')
        await expect(row.getByRole('button', { name: 'Copy URL' })).toHaveCount(0)
      }

      await row.getByRole('button', { name: 'Revoke' }).click()
      const dialog = page.getByRole('alertdialog')
      await expect(dialog).toContainText('Revoke this hook?')
      await dialog.getByRole('button', { name: 'Cancel' }).click()
      await expect(dialog).toBeHidden()
      await expect(row).toContainText('Live')
      expect((await listHooks(request, token, campaignId))[0]?.revokedAt).toBeNull()

      await row.getByRole('button', { name: 'Revoke' }).click()
      await dialog.getByRole('button', { name: 'Confirm' }).click()
      await expect(dialog).toBeHidden()
      await expect(row).toContainText('Revoked', { timeout: 20_000 })
      await expect(row.getByRole('button', { name: 'Restore' })).toBeVisible()
      expect((await listHooks(request, token, campaignId))[0]?.revokedAt).toBeTruthy()

      await row.getByRole('button', { name: 'Restore' }).click()
      await expect(row).toContainText('Live', { timeout: 20_000 })
      await expect(row.getByRole('button', { name: 'Revoke' })).toBeVisible()
      expect((await listHooks(request, token, campaignId))[0]?.revokedAt).toBeNull()
    } finally {
      await removeHooksOf(request, token, campaignId)
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('a removed hook leaves the screen', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const hookName = `QA removed hook ${stamp}`
    let campaignId: string | null = null
    try {
      campaignId = await createCampaign(request, token, `QA TC-MA-046 removed hook ${stamp}`)
      const hook = await createHook(request, token, campaignId, hookName)

      await login(page, 'admin')
      await openScreen(page, '/backend/marketing/inbound-hooks', HOOKS_PATH)
      const row = page.getByRole('row', { name: new RegExp(hookName) })
      await expect(row).toBeVisible({ timeout: 20_000 })

      const removed = await apiRequest(request, 'DELETE', `${HOOKS_PATH}/${hook.id}`, {
        token,
        headers: { [LOCK_HEADER]: hook.updatedAt },
      })
      expect(removed.status()).toBe(200)

      await openScreen(page, '/backend/marketing/inbound-hooks', HOOKS_PATH)
      await expect(page.getByRole('button', { name: 'Create hook' })).toBeVisible()
      await expect(row).toHaveCount(0)
    } finally {
      await removeHooksOf(request, token, campaignId)
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('a reader without campaign management rights sees that a URL exists but not the URL', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const hookName = `QA hidden hook ${stamp}`
    let campaignId: string | null = null
    try {
      campaignId = await createCampaign(request, token, `QA TC-MA-046 hidden hook ${stamp}`)
      const hook = await createHook(request, token, campaignId, hookName)
      test.skip(!hook.hasUrl, 'no signing secret configured in this environment')

      await login(page, 'employee')
      await openScreen(page, '/backend/marketing/inbound-hooks', HOOKS_PATH)
      const row = page.getByRole('row', { name: new RegExp(hookName) })
      await expect(row).toBeVisible({ timeout: 20_000 })
      await expect(row).toContainText('URL hidden — needs campaign management rights')
      await expect(row.getByRole('button', { name: 'Copy URL' })).toHaveCount(0)
      await expect(page.getByText(hook.url as string)).toHaveCount(0)
      // Nor controls the API would refuse: no create form, no revoke.
      await expect(page.getByRole('button', { name: 'Create hook' })).toHaveCount(0)
      await expect(row.getByRole('button', { name: 'Revoke' })).toHaveCount(0)
    } finally {
      await removeHooksOf(request, token, campaignId)
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('the job history shows a new score-rules pass with its kind, status and counters after Refresh', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const marker = `QA TC-MA-046 jobs ${Date.now()}`
    let rule: { id: string; updatedAt: string } | null = null
    try {
      const before = await readJsonSafe<{ items?: JobRun[] }>(
        await apiRequest(request, 'GET', `${JOBS_PATH}?kind=rule_scores&limit=100`, { token }),
      )
      const knownIds = new Set((before?.items ?? []).map((item) => item.id))

      await login(page, 'admin')
      await openScreen(page, '/backend/marketing/jobs', JOBS_PATH)
      for (const header of ['Job', 'Started', 'Status', 'Result', 'Campaign']) {
        await expect(page.getByRole('columnheader', { name: header, exact: true })).toBeVisible()
      }

      const created = await apiRequest(request, 'POST', RULES_PATH, {
        token,
        data: {
          name: marker,
          points: 1,
          isEnabled: false,
          expression: { operator: 'AND', rules: [{ field: 'customer.displayName', operator: '=', value: marker }] },
        },
      })
      expect(created.status(), 'rule create').toBe(200)
      rule = await readJsonSafe<{ id: string; updatedAt: string }>(created)

      let pass: JobRun | undefined
      await expect.poll(async () => {
        const listed = await readJsonSafe<{ items?: JobRun[] }>(
          await apiRequest(request, 'GET', `${JOBS_PATH}?kind=rule_scores&limit=20`, { token }),
        )
        pass = (listed?.items ?? []).find((item) => !knownIds.has(item.id) && item.status === 'ok')
        return Boolean(pass)
      }, { timeout: 30_000, intervals: [500, 1000, 2000] }).toBe(true)
      const counters = pass?.counters ?? {}
      expect(Object.keys(counters).sort()).toEqual(['changed', 'checked', 'failed'])

      const refreshed = page.waitForResponse((response) =>
        response.url().includes(JOBS_PATH) && response.request().method() === 'GET')
      await page.getByRole('button', { name: 'Refresh' }).click()
      await refreshed

      const row = page.getByRole('row')
        .filter({ hasText: 'Score rules' })
        .filter({ hasText: 'Finished' })
        .filter({ hasText: `checked: ${counters.checked}` })
        .filter({ hasText: `changed: ${counters.changed}` })
        .filter({ hasText: `failed: ${counters.failed}` })
        .first()
      await expect(row).toBeVisible({ timeout: 20_000 })
      await expect(row.getByRole('link', { name: 'Open' })).toHaveCount(0)
      await expect(row).not.toContainText('rule_scores')
    } finally {
      if (rule) {
        const read = await apiRequest(request, 'GET', `${RULES_PATH}/${rule.id}`, { token })
        const current = read.ok() ? await readJsonSafe<{ updatedAt: string }>(read) : null
        if (current?.updatedAt) {
          await apiRequest(request, 'DELETE', `${RULES_PATH}/${rule.id}`, { token, headers: { [LOCK_HEADER]: current.updatedAt } })
        }
      }
    }
  })

  test('lead routing lists each rep in the pool with their load and this week\'s leads', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const busyRep = randomUUID()
    const idleRep = randomUUID()
    const leadName = `QA Routed Lead ${stamp}`
    const previousPool = await readLeadRoutingPool(request, token)
    let leadId: string | null = null
    try {
      const created = await apiRequest(request, 'POST', '/api/customers/people', {
        token,
        data: { firstName: 'QA', lastName: `Routed${stamp}`, displayName: leadName, ownerUserId: busyRep },
      })
      expect(created.ok(), 'lead create').toBe(true)
      const body = await readJsonSafe<{ id?: string; entityId?: string; personId?: string }>(created)
      leadId = body?.id ?? body?.entityId ?? body?.personId ?? null
      expect(leadId).toBeTruthy()

      await writeLeadRoutingPool(request, token, [busyRep, idleRep])

      await login(page, 'admin')
      await openScreen(page, '/backend/marketing/lead-routing', ROUTING_PATH)
      await expect(page.getByText('New leads from the last 7 days. Each new lead goes to whoever currently has the fewest.')).toBeVisible({ timeout: 20_000 })

      const busySection = page.locator('div').filter({ has: page.getByText(busyRep, { exact: true }) })
        .filter({ hasText: 'Carrying' }).last()
      await expect(busySection).toContainText('Carrying 1 leads in total')
      await expect(busySection.getByRole('link', { name: leadName })).toHaveAttribute('href', `/backend/marketing/customers/${leadId}`)

      const idleSection = page.locator('div').filter({ has: page.getByText(idleRep, { exact: true }) })
        .filter({ hasText: 'Carrying' }).last()
      await expect(idleSection).toContainText('Carrying 0 leads in total')
      await expect(idleSection).toContainText('Nothing new this week.')
      await expect(idleSection.getByRole('link')).toHaveCount(0)
    } finally {
      await writeLeadRoutingPool(request, token, previousPool)
      await deleteEntityIfExists(request, token, '/api/customers/people', leadId)
    }
  })

  test('lead routing with an empty pool says where to pick the reps', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const previousPool = await readLeadRoutingPool(request, token)
    try {
      await writeLeadRoutingPool(request, token, [])
      await login(page, 'admin')
      await openScreen(page, '/backend/marketing/lead-routing', ROUTING_PATH)
      await expect(page.getByText('No sales reps in the pool')).toBeVisible({ timeout: 20_000 })
      await expect(page.getByText(/Pick the reps on the marketing settings screen/)).toBeVisible()
    } finally {
      await writeLeadRoutingPool(request, token, previousPool)
    }
  })

  test('the referrals screen lists a code with its referrer, claims and purchases', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let referrerId: string | null = null
    let referredId: string | null = null
    try {
      referrerId = await createPersonFixture(request, token, {
        firstName: 'QA', lastName: `Referrer${stamp}`, displayName: `QA UI Referrer ${stamp}`,
        primaryEmail: `qa-ma-046-ref-a-${stamp}@example.com`,
      })
      referredId = await createPersonFixture(request, token, {
        firstName: 'QA', lastName: `Referred${stamp}`, displayName: `QA UI Referred ${stamp}`,
        primaryEmail: `qa-ma-046-ref-b-${stamp}@example.com`,
      })
      const issued = await apiRequest(request, 'POST', REFERRALS_PATH, { token, data: { customerId: referrerId } })
      expect(issued.status()).toBe(200)
      const code = (await readJsonSafe<{ code?: string }>(issued))?.code as string
      expect(code).toBeTruthy()
      const claimed = await apiRequest(request, 'POST', `${REFERRALS_PATH}/claim`, { token, data: { code, customerId: referredId } })
      expect(claimed.status()).toBe(200)

      await login(page, 'admin')
      await openScreen(page, '/backend/marketing/referrals', REFERRALS_PATH)
      for (const header of ['Code', 'Referrer', 'Used the code', 'Bought', 'Issued']) {
        await expect(page.getByRole('columnheader', { name: header, exact: true })).toBeVisible()
      }

      const row = page.getByRole('row').filter({ hasText: code })
      await expect(row).toHaveCount(1, { timeout: 20_000 })
      /**
       * The referrer is named, not labelled.
       *
       * Every cell in this column used to read "Open profile", so the column could not answer the question the
       * screen exists for — who brings customers in — without opening each row in turn.
       */
      await expect(row.getByRole('link', { name: `QA UI Referrer ${stamp}` }))
        .toHaveAttribute('href', `/backend/marketing/customers/${referrerId}`)
      const cells = row.getByRole('cell')
      await expect(cells.nth(0)).toHaveText(code)
      await expect(cells.nth(2)).toHaveText('1')
      await expect(cells.nth(3)).toHaveText('0')

      // Deleting the referrer takes the code off the screen and out of use, without retiring it: a delete can be undone.
      await deleteEntityIfExists(request, token, '/api/customers/people', referrerId)
      const listed = await readJsonSafe<{ items?: Array<{ code?: string }> }>(
        await apiRequest(request, 'GET', `${REFERRALS_PATH}?limit=100`, { token }),
      )
      expect((listed?.items ?? []).some((item) => item.code === code)).toBe(false)
      const lateClaimer = await createPersonFixture(request, token, {
        firstName: 'QA', lastName: `Late${stamp}`, displayName: `QA UI Late ${stamp}`,
      })
      try {
        const late = await apiRequest(request, 'POST', `${REFERRALS_PATH}/claim`, { token, data: { code, customerId: lateClaimer } })
        expect(late.status()).toBe(404)
      } finally {
        await deleteEntityIfExists(request, token, '/api/customers/people', lateClaimer)
      }
      await openScreen(page, '/backend/marketing/referrals', REFERRALS_PATH)
      await expect(page.getByRole('row').filter({ hasText: code })).toHaveCount(0)
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', referredId)
      await deleteEntityIfExists(request, token, '/api/customers/people', referrerId)
    }
  })
})
