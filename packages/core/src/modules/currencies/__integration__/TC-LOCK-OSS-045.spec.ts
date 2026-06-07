import { test, expect } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createCurrencyFixture,
  deleteCurrenciesEntityIfExists,
  generateUniqueCurrencyCode,
} from '@open-mercato/core/modules/core/__integration__/helpers/currenciesFixtures'
import {
  bumpRecordViaApi,
  expectConflictBanner,
  clickConflictRefresh,
  dismissConflictBanner,
  putWithLock,
  expectConflictBody,
  CONFLICT_BANNER_TESTID,
} from '@open-mercato/core/modules/core/__integration__/helpers/optimisticLockUi'
import { isStandaloneIntegration } from '@open-mercato/core/helpers/integration/standaloneEnv'
import { fillControlledInput } from '@open-mercato/core/modules/core/__integration__/helpers/ui'

/**
 * TC-LOCK-OSS-045 (browser UI) — conflict-bar UX suite (UX-01..07).
 *
 * Reuses the SIMPLE currencies optimistic-lock trigger from TC-LOCK-OSS-040 to
 * raise the unified "Record changed" conflict bar, then asserts the bar's UX
 * contract on `data-testid="record-conflict-banner"`:
 *   - UX-01 bar visible with title "Record changed"
 *   - UX-02 Refresh button present + clears/refetches the bar
 *   - UX-03 bar persists (no auto-vanish after a wait)
 *   - UX-04 navigating to an unrelated route auto-clears the bar
 *   - UX-05 Dismiss (X) clears the bar
 *   - UX-06 'de' locale renders the translated title ("Datensatz geändert"),
 *           never the en string or the raw 'record_modified' token
 *   - UX-07 the 409 body carries code optimistic_lock_conflict +
 *           currentUpdatedAt + expectedUpdatedAt (direct putWithLock)
 *
 * Bar source: `packages/ui/src/backend/conflicts/RecordConflictBanner.tsx`
 * (title default `t('ui.forms.conflict.title', 'Record changed')`; the de
 * dictionary maps that key to "Datensatz geändert").
 *
 * Pattern: create currency via API fixture → load the edit page (form captures
 * `updated_at`) → advance `updated_at` out-of-band via a header-less API PUT →
 * edit + save in the browser (stale header → 409 → conflict bar).
 */

const CURRENCY_API_BASE = '/api/currencies/currencies'

const randomCode = generateUniqueCurrencyCode

/**
 * Create a currency fixture with a unique three-letter code, retrying on the
 * rare random-code collision (the ISO-4217 code space is small and demo data
 * may already occupy some codes). Returns `{ id, code }`.
 */
async function createUniqueCurrency(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  name: string,
): Promise<{ id: string; code: string }> {
  let lastError: unknown = null
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = randomCode()
    try {
      const id = await createCurrencyFixture(request, token, { code, name })
      return { id, code }
    } catch (error) {
      lastError = error
    }
  }
  throw lastError ?? new Error('[internal] failed to create a unique currency fixture')
}

/**
 * Raise the conflict bar on the currency edit page using the proven simple
 * trigger. Returns the live currency id (caller deletes it in finally).
 */
async function raiseConflictBar(
  page: import('@playwright/test').Page,
  token: string,
  stamp: number,
  currencyId: string,
  code: string,
): Promise<void> {
  await page.goto(`/backend/currencies/${currencyId}`, { waitUntil: 'commit' })

  const nameInput = page.locator('[data-crud-field-id="name"] input').first()
  const loaded = await nameInput
    .waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true)
    .catch(() => false)
  if (!loaded) {
    await page.reload({ waitUntil: 'commit' }).catch(() => {})
    await expect(nameInput).toBeVisible({ timeout: 15_000 })
  }

  // Advance updated_at out-of-band → the browser form now holds a stale token.
  await bumpRecordViaApi(page.request, token, CURRENCY_API_BASE, {
    id: currencyId,
    code,
    name: `QA Lock 045 bumped ${stamp}`,
  })

  // Edit + save in the browser → stale header → 409 → conflict bar.
  await fillControlledInput(nameInput, `QA Lock 045 stale ${stamp}`)
  await nameInput.press('Control+Enter')

  await expectConflictBanner(page)
}

test.describe('TC-LOCK-OSS-045: conflict-bar UX suite (currencies)', () => {
  test('UX-01: bar is visible with title "Record changed"', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let currencyId: string | null = null
    try {
      const fixture = await createUniqueCurrency(page.request, token, `QA Lock 045 UX01 ${stamp}`)
      currencyId = fixture.id
      await login(page, 'admin')
      await raiseConflictBar(page, token, stamp, currencyId, fixture.code)

      const banner = page.getByTestId(CONFLICT_BANNER_TESTID)
      await expect(banner).toBeVisible()
      await expect(banner).toContainText('Record changed')
    } finally {
      await deleteCurrenciesEntityIfExists(page.request, token, CURRENCY_API_BASE, currencyId)
    }
  })

  test('UX-02: Refresh button is present and clears/refetches the bar', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let currencyId: string | null = null
    try {
      const fixture = await createUniqueCurrency(page.request, token, `QA Lock 045 UX02 ${stamp}`)
      currencyId = fixture.id
      await login(page, 'admin')
      await raiseConflictBar(page, token, stamp, currencyId, fixture.code)

      const banner = page.getByTestId(CONFLICT_BANNER_TESTID)
      await expect(banner.getByRole('button', { name: /refresh/i })).toBeVisible()

      // Refresh re-fetches the latest server state (reload) and clears the bar.
      await clickConflictRefresh(page)
      await expect(page.getByTestId(CONFLICT_BANNER_TESTID)).toHaveCount(0, { timeout: 15_000 })
    } finally {
      await deleteCurrenciesEntityIfExists(page.request, token, CURRENCY_API_BASE, currencyId)
    }
  })

  test('UX-03: bar persists and does not auto-vanish after a wait', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let currencyId: string | null = null
    try {
      const fixture = await createUniqueCurrency(page.request, token, `QA Lock 045 UX03 ${stamp}`)
      currencyId = fixture.id
      await login(page, 'admin')
      await raiseConflictBar(page, token, stamp, currencyId, fixture.code)

      // Unlike the undo bar, the conflict bar must NOT auto-dismiss.
      await page.waitForTimeout(4_000)
      await expect(page.getByTestId(CONFLICT_BANNER_TESTID)).toBeVisible()
    } finally {
      await deleteCurrenciesEntityIfExists(page.request, token, CURRENCY_API_BASE, currencyId)
    }
  })

  test('UX-04: navigating to an unrelated route auto-clears the bar', async ({ page }) => {
    test.slow()
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let currencyId: string | null = null
    try {
      const fixture = await createUniqueCurrency(page.request, token, `QA Lock 045 UX04 ${stamp}`)
      currencyId = fixture.id
      await login(page, 'admin')
      await raiseConflictBar(page, token, stamp, currencyId, fixture.code)

      await page.goto('/backend', { waitUntil: 'commit' })
      await expect(page.getByTestId(CONFLICT_BANNER_TESTID)).toHaveCount(0, { timeout: 15_000 })
    } finally {
      await deleteCurrenciesEntityIfExists(page.request, token, CURRENCY_API_BASE, currencyId)
    }
  })

  test('UX-05: Dismiss (X) clears the bar', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let currencyId: string | null = null
    try {
      const fixture = await createUniqueCurrency(page.request, token, `QA Lock 045 UX05 ${stamp}`)
      currencyId = fixture.id
      await login(page, 'admin')
      await raiseConflictBar(page, token, stamp, currencyId, fixture.code)

      await dismissConflictBanner(page)
      await expect(page.getByTestId(CONFLICT_BANNER_TESTID)).toHaveCount(0, { timeout: 10_000 })
    } finally {
      await deleteCurrenciesEntityIfExists(page.request, token, CURRENCY_API_BASE, currencyId)
    }
  })

  test('UX-06: de locale renders the translated bar title, not the en string or raw token', async ({ page }) => {
    test.skip(isStandaloneIntegration(), 'Standalone smoke runs do not publish the de UI dictionary bundle.')

    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let currencyId: string | null = null
    try {
      const fixture = await createUniqueCurrency(page.request, token, `QA Lock 045 UX06 ${stamp}`)
      currencyId = fixture.id
      const code = fixture.code
      await login(page, 'admin')

      // Switch locale to German via the locale endpoint (sets the `locale` cookie).
      const localeResponse = await page.request.post('/api/auth/locale', {
        headers: { 'content-type': 'application/json' },
        data: { locale: 'de' },
      })
      expect(localeResponse.ok(), 'switching locale to de should succeed').toBeTruthy()

      await raiseConflictBar(page, token, stamp, currencyId, code)

      const banner = page.getByTestId(CONFLICT_BANNER_TESTID)
      // de dictionary: ui.forms.conflict.title => "Datensatz geändert".
      await expect(banner).toContainText('Datensatz geändert')
      await expect(banner).not.toContainText('Record changed')
      await expect(banner).not.toContainText('record_modified')
    } finally {
      // Restore English so the locale cookie does not leak into other specs.
      await page.request.post('/api/auth/locale', {
        headers: { 'content-type': 'application/json' },
        data: { locale: 'en' },
      }).catch(() => {})
      await deleteCurrenciesEntityIfExists(page.request, token, CURRENCY_API_BASE, currencyId)
    }
  })

  test('UX-07: 409 body has optimistic_lock_conflict code + currentUpdatedAt + expectedUpdatedAt', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let currencyId: string | null = null
    try {
      const fixture = await createUniqueCurrency(page.request, token, `QA Lock 045 UX07 ${stamp}`)
      currencyId = fixture.id
      const code = fixture.code

      // Advance updated_at out-of-band, then issue a stale-header PUT directly.
      const staleIso = new Date(Date.now() - 60_000).toISOString()
      await bumpRecordViaApi(page.request, token, CURRENCY_API_BASE, {
        id: currencyId,
        code,
        name: `QA Lock 045 UX07 bumped ${stamp}`,
      })

      const response = await putWithLock(
        page.request,
        token,
        CURRENCY_API_BASE,
        { id: currencyId, code, name: `QA Lock 045 UX07 stale ${stamp}` },
        staleIso,
      )

      const body = await expectConflictBody(response)
      expect(typeof body.currentUpdatedAt, 'body should expose currentUpdatedAt').toBe('string')
      expect(typeof body.expectedUpdatedAt, 'body should expose expectedUpdatedAt').toBe('string')
      expect(body.expectedUpdatedAt, 'expectedUpdatedAt echoes the stale header').toBe(staleIso)
    } finally {
      await deleteCurrenciesEntityIfExists(page.request, token, CURRENCY_API_BASE, currencyId)
    }
  })
})
