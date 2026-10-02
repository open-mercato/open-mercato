import { expect, test } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { fillControlledInput } from '@open-mercato/core/helpers/integration/ui'
import {
  createCustomerCompanyFixture,
  createCustomerUserFixture,
  deleteCustomerCompanyFixture,
  deleteCustomerUserFixture,
  portalCookieHeaders,
  portalLogin,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import { createPersonFixture } from '@open-mercato/core/helpers/integration/crmFixtures'

const SETTINGS_PATH = '/api/marketing_automation/settings'
const READINESS_PATH = '/api/marketing_automation/readiness'
const PREFERENCES_PATH = '/api/marketing_automation/portal/preferences'
const OPTIMISTIC_LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'

/**
 * Links the portal account to a CRM PERSON, which is who marketing consent is about.
 *
 * `POST /admin/users` takes only `customerEntityId` (the company), so the person link is a second
 * call. This matters to the fixture and not just to the route: a portal user linked to a company
 * alone exercises nothing of the preference centre's real path, and this spec used to pass while
 * every save landed on a company-wide consent row.
 */
async function linkPersonToPortalUser(
  request: APIRequestContext,
  adminToken: string,
  userId: string,
  personEntityId: string,
): Promise<void> {
  const current = await apiRequest(request, 'GET', `/api/customer_accounts/admin/users/${userId}`, { token: adminToken })
  expect(current.status(), 'reading the portal user should succeed').toBe(200)
  const body = await readJsonSafe<{ updatedAt?: string | null }>(current)
  const updated = await apiRequest(request, 'PUT', `/api/customer_accounts/admin/users/${userId}`, {
    token: adminToken,
    data: { personEntityId },
    headers: body?.updatedAt ? { [OPTIMISTIC_LOCK_HEADER]: body.updatedAt } : {},
  })
  expect(updated.status(), 'linking the person to the portal user should succeed').toBe(200)
}

type Settings = {
  productUrlTemplate: string
  brandVoice: string
  referralUrlTemplate: string
  leadRoutingUserIds: string[]
  loyaltyTiers: Array<{ key: string; minPoints: number }>
  autoApplySplitWinner: boolean
  autoApplySplitWinnerMargin: number
  splitWinnerMetric: 'clicks' | 'revenue'
  valueHorizonYears: number
}

type Readiness = {
  checks: Array<{ id: string; severity: 'blocking' | 'recommended'; done: boolean; href?: string }>
  ready: boolean
  remaining: number
}

type Preferences = {
  consent?: 'subscribed' | 'unsubscribed' | null
  preference?: { maxPerWeek: number | null; pausedUntil: string | null; locale: string | null }
}

const CHECK_TITLES: Record<string, string> = {
  email_channel: 'Configure an email channel',
  tracking: 'Set a signing secret and a public URL',
  first_campaign: 'Create a campaign',
  publish: 'Publish it',
  first_run: 'Watch the first customer go through',
  schedules: 'Turn on the periodic jobs',
  segments: 'Name an audience you will reuse',
  content_blocks: 'Write a reusable block',
}

async function readSettings(request: APIRequestContext, token: string): Promise<Settings> {
  const response = await apiRequest(request, 'GET', SETTINGS_PATH, { token })
  expect(response.status()).toBe(200)
  const body = await readJsonSafe<Settings>(response)
  expect(body).not.toBeNull()
  return body as Settings
}

/** Puts back exactly what was read before the test, and always with auto-apply as it was (off, in practice). */
async function restoreSettings(request: APIRequestContext, token: string, snapshot: Settings | null): Promise<void> {
  if (!snapshot) return
  const response = await apiRequest(request, 'PUT', SETTINGS_PATH, { token, data: snapshot })
  expect(response.status(), 'settings must be restored').toBe(200)
}

/**
 * Opens the settings screen and waits until it has stopped reloading itself.
 *
 * The page loads on mount and again when the organisation scope version settles (and twice more in dev strict
 * mode); each load swaps the form for a spinner and back, wiping anything done in between. So this waits for the
 * GETs to go quiet rather than for the first one.
 */
async function openSettings(page: Page): Promise<void> {
  let lastLoadAt = Date.now()
  let pending = 0
  const onRequest = (request: { url(): string; method(): string }) => {
    if (request.url().includes(SETTINGS_PATH) && request.method() === 'GET') {
      pending += 1
      lastLoadAt = Date.now()
    }
  }
  const onDone = (request: { url(): string; method(): string }) => {
    if (request.url().includes(SETTINGS_PATH) && request.method() === 'GET') {
      pending = Math.max(0, pending - 1)
      lastLoadAt = Date.now()
    }
  }
  page.on('request', onRequest)
  page.on('requestfinished', onDone)
  page.on('requestfailed', onDone)
  try {
    await page.goto('/backend/marketing/settings', { waitUntil: 'domcontentloaded' })
    await expect.poll(() => pending === 0 && Date.now() - lastLoadAt > 1_500, { timeout: 20_000 }).toBe(true)
  } finally {
    page.off('request', onRequest)
    page.off('requestfinished', onDone)
    page.off('requestfailed', onDone)
  }
  await expect(page.locator('#product-url-template')).toBeVisible()
}

async function saveSettings(page: Page, expectedStatus: number): Promise<void> {
  const saved = page.waitForResponse((response) =>
    response.url().includes(SETTINGS_PATH) && response.request().method() === 'PUT')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  expect((await saved).status()).toBe(expectedStatus)
}

async function pickOption(page: Page, comboboxName: string, optionName: string): Promise<void> {
  await page.getByRole('combobox', { name: comboboxName }).click()
  const option = page.getByRole('option', { name: optionName, exact: true })
  await expect(option).toBeVisible()
  await option.press('Enter')
}

/**
 * TC-MA-047: the settings screen, the first-run checklist, and the customer's own preference centre.
 *
 * Settings are tenant-wide and read by other specs, so every settings test snapshots them through the API first
 * and puts them back verbatim in `finally`. Auto-apply-winner is switched on only for the length of one save and
 * reload, and switched off again from the screen before the test goes on.
 */
test.describe('TC-MA-047 settings, setup and portal preferences screens', () => {
  test.describe.configure({ timeout: 90_000 })

  test('an operator changes every setting, saves, and sees it after a reload', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const snapshot = await readSettings(request, token)
    const stamp = Date.now()
    const productTemplate = `https://qa.example/p/{sku}?m=${stamp}`
    const referralTemplate = `https://qa.example/r/{code}?m=${stamp}`
    const brandVoice = `QA voice ${stamp}. Plain and kind, no exclamation marks.`
    const tierKey = `qa-tier-${stamp}`
    const tierPoints = 900_000 + (stamp % 99_999)
    const nextMetric: Settings['splitWinnerMetric'] = snapshot.splitWinnerMetric === 'revenue' ? 'clicks' : 'revenue'
    const nextMetricLabel = nextMetric === 'revenue' ? 'Revenue per recipient' : 'Clicks per recipient'
    const nextHorizon = snapshot.valueHorizonYears === 2.5 ? 3 : 2.5
    const nextMargin = snapshot.autoApplySplitWinnerMargin === 0.45 ? 0.55 : 0.45

    const staffResponse = await apiRequest(request, 'GET', '/api/staff/team-members/assignable?pageSize=100', { token })
    const staffBody = await readJsonSafe<{ items?: Array<{ userId?: string; displayName?: string }> }>(staffResponse)
    const member = (staffBody?.items ?? []).find((entry) => entry.userId && entry.displayName) ?? null
    const memberWasInPool = member ? snapshot.leadRoutingUserIds.includes(member.userId as string) : false

    try {
      await login(page, 'admin')
      await openSettings(page)

      await fillControlledInput(page.locator('#product-url-template'), productTemplate)
      await fillControlledInput(page.locator('#referral-url-template'), referralTemplate)
      await fillControlledInput(page.locator('#brand-voice'), brandVoice)
      await fillControlledInput(page.locator('#value-horizon'), String(nextHorizon))

      if (member) {
        const routing = page.getByRole('checkbox', { name: member.displayName as string, exact: true })
        await expect(routing).toHaveAttribute('aria-checked', String(memberWasInPool))
        await routing.click()
        await expect(routing).toHaveAttribute('aria-checked', String(!memberWasInPool))
      } else {
        await expect(page.getByText('No assignable staff found in this organization.')).toBeVisible()
      }

      const tierCount = snapshot.loyaltyTiers.length
      await page.getByRole('button', { name: 'Add a tier' }).click()
      await fillControlledInput(page.locator(`#tier-key-${tierCount}`), tierKey)
      await fillControlledInput(page.locator(`#tier-points-${tierCount}`), String(tierPoints))

      await pickOption(page, 'Decide a test on', nextMetricLabel)
      await expect(page.getByRole('combobox', { name: 'Decide a test on' })).toContainText(nextMetricLabel)

      const margin = page.locator('#winner-margin')
      const autoApply = page.getByRole('checkbox', { name: 'Let a decisive test promote its own winner' })
      await expect(autoApply).toHaveAttribute('aria-checked', 'false')
      await expect(margin).toBeDisabled()
      await autoApply.click()
      await expect(autoApply).toHaveAttribute('aria-checked', 'true')
      await expect(margin).toBeEnabled()
      await fillControlledInput(margin, String(nextMargin))

      await saveSettings(page, 200)
      await expect(page.getByText('Settings saved.')).toBeVisible()

      const stored = await readSettings(request, token)
      expect(stored.productUrlTemplate).toBe(productTemplate)
      expect(stored.referralUrlTemplate).toBe(referralTemplate)
      expect(stored.brandVoice).toBe(brandVoice)
      expect(stored.splitWinnerMetric).toBe(nextMetric)
      expect(stored.autoApplySplitWinner).toBe(true)
      expect(stored.autoApplySplitWinnerMargin).toBe(nextMargin)
      expect(stored.valueHorizonYears).toBe(nextHorizon)
      expect(stored.loyaltyTiers).toContainEqual({ key: tierKey, minPoints: tierPoints })
      if (member) expect(stored.leadRoutingUserIds.includes(member.userId as string)).toBe(!memberWasInPool)

      await openSettings(page)
      await expect(page.locator('#product-url-template')).toHaveValue(productTemplate)
      await expect(page.locator('#referral-url-template')).toHaveValue(referralTemplate)
      await expect(page.locator('#brand-voice')).toHaveValue(brandVoice)
      await expect(page.locator('#value-horizon')).toHaveValue(String(nextHorizon))
      await expect(page.getByRole('combobox', { name: 'Decide a test on' })).toContainText(nextMetricLabel)
      await expect(autoApply).toHaveAttribute('aria-checked', 'true')
      await expect(margin).toHaveValue(String(nextMargin))
      if (member) {
        await expect(page.getByRole('checkbox', { name: member.displayName as string, exact: true }))
          .toHaveAttribute('aria-checked', String(!memberWasInPool))
      }
      const tierRow = page.locator('div.flex.items-end').filter({ has: page.locator(`input[value="${tierKey}"]`) })
      await expect(tierRow).toHaveCount(1)
      await expect(tierRow.getByRole('spinbutton')).toHaveValue(String(tierPoints))

      // Auto-apply off again straight away; the margin keeps its value and simply stops being editable.
      await autoApply.click()
      await expect(margin).toBeDisabled()
      await expect(margin).toHaveValue(String(nextMargin))
      await tierRow.getByRole('button', { name: 'Remove' }).click()
      await expect(page.locator(`input[value="${tierKey}"]`)).toHaveCount(0)
      await saveSettings(page, 200)
      await expect(page.getByText('Settings saved.')).toBeVisible()

      const after = await readSettings(request, token)
      expect(after.autoApplySplitWinner).toBe(false)
      expect(after.autoApplySplitWinnerMargin).toBe(nextMargin)
      expect(after.loyaltyTiers.find((tier) => tier.key === tierKey)).toBeUndefined()
    } finally {
      await restoreSettings(request, token, snapshot)
    }
  })

  test('an invalid setting is refused with the reason and nothing is written', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const snapshot = await readSettings(request, token)
    const stamp = Date.now()
    try {
      await login(page, 'admin')

      await openSettings(page)
      await fillControlledInput(page.locator('#product-url-template'), `https://qa.example/products/${stamp}`)
      await saveSettings(page, 400)
      await expect(page.getByText('productUrlTemplate: must contain {sku}')).toBeVisible()
      await expect(page.getByText('Settings saved.')).toHaveCount(0)

      await openSettings(page)
      await fillControlledInput(page.locator('#referral-url-template'), `https://qa.example/r/${stamp}`)
      await saveSettings(page, 400)
      await expect(page.getByText('referralUrlTemplate: must contain {code}')).toBeVisible()

      await openSettings(page)
      await fillControlledInput(page.locator('#value-horizon'), '9')
      await saveSettings(page, 400)
      await expect(page.getByText(/^valueHorizonYears:/)).toBeVisible()

      await openSettings(page)
      await page.getByRole('button', { name: 'Add a tier' }).click()
      await expect(page.locator(`#tier-key-${snapshot.loyaltyTiers.length}`)).toHaveValue('')
      await saveSettings(page, 400)
      await expect(page.getByText(/^loyaltyTiers\.\d+\.key:/)).toBeVisible()

      // A refused save writes nothing: the screen and the API still hold what was there before.
      expect(await readSettings(request, token)).toEqual(snapshot)
      await openSettings(page)
      await expect(page.locator('#product-url-template')).toHaveValue(snapshot.productUrlTemplate)
      await expect(page.locator('#referral-url-template')).toHaveValue(snapshot.referralUrlTemplate)
      await expect(page.locator('#value-horizon')).toHaveValue(String(snapshot.valueHorizonYears))
      await expect(page.locator(`#tier-key-${snapshot.loyaltyTiers.length}`)).toHaveCount(0)
    } finally {
      await restoreSettings(request, token, snapshot)
    }
  })

  test('a tier name can be typed key by key without losing focus', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const snapshot = await readSettings(request, token)
    try {
      await login(page, 'admin')
      await openSettings(page)
      await page.getByRole('button', { name: 'Add a tier' }).click()
      const input = page.locator(`#tier-key-${snapshot.loyaltyTiers.length}`)
      await input.click()
      await input.pressSequentially('platinum', { delay: 30 })
      await expect(input).toHaveValue('platinum')
    } finally {
      await restoreSettings(request, token, snapshot)
    }
  })

  test('what is typed right after the form appears survives the scope settling', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const snapshot = await readSettings(request, token)
    try {
      await login(page, 'admin')
      // Deliberately NOT openSettings: this types as soon as the first answer arrives, which is when the second load
      // used to swap the form for a spinner and back, wiping the field.
      const first = page.waitForResponse((response) =>
        response.url().includes(SETTINGS_PATH) && response.request().method() === 'GET')
      await page.goto('/backend/marketing/settings', { waitUntil: 'domcontentloaded' })
      await first
      const field = page.locator('#product-url-template')
      await expect(field).toBeVisible()
      const typed = 'https://shop.example/early/{sku}'
      await field.fill(typed)
      await page.waitForTimeout(2_500)
      await expect(field).toHaveValue(typed)
    } finally {
      await restoreSettings(request, token, snapshot)
    }
  })

  test('the getting-started checklist shows every check as the live state reports it', async ({ page }) => {
    await login(page, 'admin')
    const loaded = page.waitForResponse((candidate) =>
      candidate.url().includes(READINESS_PATH) && candidate.request().method() === 'GET')
    await page.goto('/backend/marketing/setup', { waitUntil: 'domcontentloaded' })
    const response = await loaded
    expect(response.status()).toBe(200)
    // Asserted against the answer THIS page received: other specs create and remove segments and blocks meanwhile.
    const readiness = (await response.json()) as Readiness
    expect(readiness.checks.map((check) => check.id)).toEqual(Object.keys(CHECK_TITLES))

    await expect(page.getByText(readiness.ready ? 'Ready to send' : 'Nothing will be delivered yet')).toBeVisible()
    for (const check of readiness.checks) {
      const row = page.getByRole('listitem').filter({ hasText: CHECK_TITLES[check.id] })
      await expect(row).toHaveCount(1)
      const badge = check.done ? 'Done' : check.severity === 'blocking' ? 'Required' : 'Recommended'
      await expect(row.getByText(badge, { exact: true })).toBeVisible()
      const open = row.getByRole('link', { name: 'Open' })
      if (!check.done && check.href) await expect(open).toHaveAttribute('href', check.href)
      else await expect(open).toHaveCount(0)
    }

    const rechecked = page.waitForResponse((candidate) =>
      candidate.url().includes(READINESS_PATH) && candidate.request().method() === 'GET')
    await page.getByRole('button', { name: 'Check again' }).click()
    const again = await rechecked
    expect(again.status()).toBe(200)
    const latest = (await again.json()) as Readiness
    for (const check of latest.checks) {
      await expect(page.getByRole('listitem').filter({ hasText: CHECK_TITLES[check.id] })).toHaveCount(1)
    }

    const firstOpen = latest.checks.find((check) => !check.done && check.href)
    if (firstOpen) {
      await page.getByRole('listitem').filter({ hasText: CHECK_TITLES[firstOpen.id] })
        .getByRole('link', { name: 'Open' }).click()
      await expect(page).toHaveURL(new RegExp(`${firstOpen.href}$`))
    }
  })

  /**
   * The preference centre refuses an account it cannot tie to one person.
   *
   * Consent is about a person, and `customerEntityId` is the company. Answering for a company-only
   * account would record one row shared by every portal user there — so the unsubscribe of whoever
   * clicked last would speak for all of them, and the mail would keep arriving for everyone else.
   */
  test('a portal account with no person link cannot record consent for the company', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenContext(adminToken)
    let companyId: string | null = null
    let userId: string | null = null
    try {
      companyId = await createCustomerCompanyFixture(request, adminToken, `QA MA-047 NoPerson ${Date.now()}`)
      const user = await createCustomerUserFixture(request, adminToken, { customerEntityId: companyId })
      userId = user.id
      const session = await portalLogin(request, { email: user.email, password: user.password, tenantId })

      const read = await request.get(PREFERENCES_PATH, { headers: portalCookieHeaders(session) })
      expect(read.status()).toBe(403)
      expect((await readJsonSafe<{ code?: string }>(read))?.code).toBe('marketing_automation.errors.portalNotLinked')

      const write = await request.put(PREFERENCES_PATH, {
        headers: { ...portalCookieHeaders(session), 'Content-Type': 'application/json' },
        data: { consent: 'unsubscribed' },
      })
      expect(write.status()).toBe(403)
    } finally {
      await deleteCustomerUserFixture(request, adminToken, userId)
      await deleteCustomerCompanyFixture(request, adminToken, companyId)
    }
  })

  test('a portal customer changes frequency, language, pause and subscription', async ({ page, request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenContext(adminToken)
    let companyId: string | null = null
    let userId: string | null = null
    try {
      const orgResponse = await apiRequest(
        request,
        'GET',
        `/api/directory/organizations?view=manage&ids=${encodeURIComponent(organizationId)}&tenantId=${encodeURIComponent(tenantId)}`,
        { token: adminToken },
      )
      const orgBody = await readJsonSafe<{ items?: Array<{ slug?: string | null }> }>(orgResponse)
      const orgSlug = orgBody?.items?.[0]?.slug ?? null
      test.skip(!orgSlug, 'The admin organization has no slug, so there is no portal URL to open.')

      companyId = await createCustomerCompanyFixture(request, adminToken, `QA MA-047 Portal ${Date.now()}`)
      const user = await createCustomerUserFixture(request, adminToken, { customerEntityId: companyId })
      userId = user.id
      const personEntityId = await createPersonFixture(request, adminToken, {
        firstName: 'MA047',
        lastName: `Portal ${Date.now()}`,
        displayName: `QA MA-047 Portal Person ${Date.now()}`,
        companyEntityId: companyId,
        primaryEmail: user.email,
      })
      await linkPersonToPortalUser(request, adminToken, userId, personEntityId)
      const session = await portalLogin(request, { email: user.email, password: user.password, tenantId })
      const readPreferences = async (): Promise<Preferences> => {
        const result = await request.get(PREFERENCES_PATH, { headers: portalCookieHeaders(session) })
        expect(result.status()).toBe(200)
        return (await readJsonSafe<Preferences>(result)) ?? {}
      }

      const baseUrl = process.env.BASE_URL || 'http://localhost:3000'
      await page.context().addCookies([
        { name: 'customer_auth_token', value: session.authToken, url: baseUrl, sameSite: 'Lax' },
        { name: 'customer_session_token', value: session.sessionToken, url: baseUrl, sameSite: 'Lax' },
      ])

      const openPreferences = async () => {
        const loaded = page.waitForResponse((response) =>
          response.url().includes(PREFERENCES_PATH) && response.request().method() === 'GET')
        await page.goto(`/${orgSlug}/portal/marketing-preferences`, { waitUntil: 'domcontentloaded' })
        expect((await loaded).status()).toBe(200)
        await expect(page.getByRole('heading', { name: 'Email preferences' })).toBeVisible()
      }
      const expectSaved = async (action: () => Promise<void>) => {
        const saved = page.waitForResponse((response) =>
          response.url().includes(PREFERENCES_PATH) && response.request().method() === 'PUT')
        await action()
        expect((await saved).status()).toBe(200)
        await expect(page.getByText('Saved. Thank you.')).toBeVisible()
      }

      // Tall enough that the demo notice and cookie bar pinned to the bottom never sit over the form.
      await page.setViewportSize({ width: 1280, height: 1600 })
      await openPreferences()
      const acceptCookies = page.getByRole('button', { name: 'Accept cookies' })
      if (await acceptCookies.isVisible().catch(() => false)) await acceptCookies.click()
      await expect(page.getByText('Subscribed', { exact: true })).toBeVisible()
      await expect(page.getByRole('combobox', { name: 'How often at most' })).toContainText('No limit from me')

      await expectSaved(() => pickOption(page, 'How often at most', 'At most 2 a week'))
      await expect(page.getByRole('combobox', { name: 'How often at most' })).toContainText('At most 2 a week')
      expect((await readPreferences()).preference?.maxPerWeek).toBe(2)

      await expectSaved(() => pickOption(page, 'Language', 'Polski'))
      expect((await readPreferences()).preference?.locale).toBe('pl')

      await expectSaved(() => page.getByRole('button', { name: 'Pause 30 days' }).click())
      await expect(page.getByText(/^Paused until /)).toBeVisible()
      const paused = (await readPreferences()).preference?.pausedUntil
      expect(paused).toBeTruthy()
      const pausedDays = (new Date(paused as string).getTime() - Date.now()) / 86_400_000
      expect(pausedDays).toBeGreaterThan(29)
      expect(pausedDays).toBeLessThan(31)

      await expectSaved(() => page.getByRole('button', { name: 'Resume now' }).click())
      await expect(page.getByRole('button', { name: 'Pause 90 days' })).toBeVisible()
      expect((await readPreferences()).preference?.pausedUntil ?? null).toBeNull()

      await expectSaved(() => page.getByRole('button', { name: 'Unsubscribe' }).click())
      await expect(page.getByText('Unsubscribed', { exact: true })).toBeVisible()
      expect((await readPreferences()).consent).toBe('unsubscribed')

      // What the customer chose survives a fresh visit.
      await openPreferences()
      await expect(page.getByText('Unsubscribed', { exact: true })).toBeVisible()
      await expect(page.getByRole('combobox', { name: 'How often at most' })).toContainText('At most 2 a week')
      await expect(page.getByRole('combobox', { name: 'Language' })).toContainText('Polski')

      await expectSaved(() => page.getByRole('button', { name: 'Start receiving them again' }).click())
      await expect(page.getByText('Subscribed', { exact: true })).toBeVisible()
      await expectSaved(() => pickOption(page, 'How often at most', 'No limit from me'))
      const final = await readPreferences()
      expect(final.consent).toBe('subscribed')
      expect(final.preference?.maxPerWeek ?? null).toBeNull()
    } finally {
      await deleteCustomerUserFixture(request, adminToken, userId)
      await deleteCustomerCompanyFixture(request, adminToken, companyId)
    }
  })
})
