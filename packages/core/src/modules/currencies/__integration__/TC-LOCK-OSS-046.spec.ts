import { test, expect } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createCurrencyFixture,
  deleteCurrenciesEntityIfExists,
  generateUniqueCurrencyCode,
} from '@open-mercato/core/modules/core/__integration__/helpers/currenciesFixtures'
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import {
  readUpdatedAt,
  putWithLock,
} from '@open-mercato/core/modules/core/__integration__/helpers/optimisticLockUi'

/**
 * TC-LOCK-OSS-046 (negative / additive contract) — manual cases NEG-01..05.
 *
 * Proves the OSS optimistic-lock feature (#2055, default-ON in this app) stays
 * strictly additive: the lock NEVER fails an honest writer and NEVER fires a
 * false 409.
 *
 *   NEG-01 additive: a header-LESS PUT and a header-LESS DELETE on a
 *          `makeCrudRoute` currency always succeed (no 409, status < 400) —
 *          the lock is opt-in via the `x-om-ext-optimistic-lock-expected-updated-at`
 *          header, so omitting it must not break legacy/header-unaware callers.
 *   NEG-05 back-to-back: a PUT carrying the record's CURRENT updated_at → 200 and
 *          advances updated_at; a SECOND PUT carrying that FRESH token → 200 (no
 *          false 409). This is the sequential-edit case the conflict guard must
 *          not regress (#2055 refreshes the token after each save).
 *   NEG-04 v1 dead route: the customers companies list routes detail to
 *          `companies-v2`; the legacy `/backend/customers/companies/<id>` (v1)
 *          page is NOT the live single-Save editor — it edits inline and has no
 *          header "Save" button. Lenient assertion only.
 *   NEG-02 opt-out (OM_OPTIMISTIC_LOCK=off): NOT runnable here — this shared app
 *          boots default-ON and a second app with the flag flipped cannot be
 *          booted from this suite. The opt-out is a pure function of the env
 *          parser + guard, so it is proven as a runnable UNIT test in
 *          packages/shared/src/lib/crud/__tests__/optimistic-lock.test.ts
 *          (the "NEG-02 … stale header is NOT enforced" case) instead of a
 *          dangling integration placeholder.
 *
 * Route under test (NEG-01/05): `packages/core/src/modules/currencies/api/currencies/route.ts`
 * (a `makeCrudRoute` CRUD surface). The lock header contract lives in
 * `packages/shared/src/lib/crud/optimistic-lock-headers.ts`.
 */

const CURRENCY_API_BASE = '/api/currencies/currencies'

const randomCode = generateUniqueCurrencyCode

test.describe('TC-LOCK-OSS-046: optimistic-lock negative / additive contract', () => {
  test('NEG-01: a header-less PUT and DELETE always succeed (no 409)', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    const code = randomCode()
    let currencyId: string | null = null
    try {
      currencyId = await createCurrencyFixture(page.request, token, {
        code,
        name: `QA Lock 046 NEG01 ${stamp}`,
      })

      // Header-less PUT (no optimistic-lock header) → additive path → must succeed.
      const putResponse = await apiRequest(page.request, 'PUT', CURRENCY_API_BASE, {
        token,
        data: { id: currencyId, code, name: `QA Lock 046 NEG01 put ${stamp}` },
      })
      expect(
        putResponse.status(),
        `header-less PUT must succeed (additive path), got ${putResponse.status()}`,
      ).toBeLessThan(400)

      // Header-less DELETE → additive path → must succeed.
      const deleteResponse = await apiRequest(
        page.request,
        'DELETE',
        `${CURRENCY_API_BASE}?id=${encodeURIComponent(currencyId)}`,
        { token },
      )
      expect(
        deleteResponse.status(),
        `header-less DELETE must succeed (additive path), got ${deleteResponse.status()}`,
      ).toBeLessThan(400)
      currencyId = null
    } finally {
      await deleteCurrenciesEntityIfExists(page.request, token, CURRENCY_API_BASE, currencyId)
    }
  })

  test('NEG-05: back-to-back PUTs with a refreshed token both succeed (no false 409)', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    const code = randomCode()
    let currencyId: string | null = null
    try {
      currencyId = await createCurrencyFixture(page.request, token, {
        code,
        name: `QA Lock 046 NEG05 ${stamp}`,
      })

      // First PUT carries the CURRENT updated_at → must succeed and bump updated_at.
      const currentToken = await readUpdatedAt(page.request, token, CURRENCY_API_BASE, currencyId)
      const firstResponse = await putWithLock(
        page.request,
        token,
        CURRENCY_API_BASE,
        { id: currencyId, code, name: `QA Lock 046 NEG05 first ${stamp}` },
        currentToken,
      )
      expect(
        firstResponse.status(),
        `first PUT with the current token must be 200, got ${firstResponse.status()}`,
      ).toBeLessThan(400)

      // Re-read the FRESH updated_at (the route returns { ok: true }, so read it back).
      const freshToken = await readUpdatedAt(page.request, token, CURRENCY_API_BASE, currencyId)
      expect(freshToken, 'first save should advance updated_at').not.toBe(currentToken)

      // Second PUT carries the FRESH token → must succeed (no false conflict).
      const secondResponse = await putWithLock(
        page.request,
        token,
        CURRENCY_API_BASE,
        { id: currencyId, code, name: `QA Lock 046 NEG05 second ${stamp}` },
        freshToken,
      )
      expect(
        secondResponse.status(),
        `second PUT with the fresh token must not 409, got ${secondResponse.status()}`,
      ).toBeLessThan(400)
    } finally {
      await deleteCurrenciesEntityIfExists(page.request, token, CURRENCY_API_BASE, currencyId)
    }
  })

  test('NEG-04: the v1 companies detail route is not the live single-Save editor', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let companyId: string | null = null
    try {
      companyId = await createCompanyFixture(page.request, token, `QA Lock 046 NEG04 ${stamp}`)

      await login(page, 'admin')
      await page.goto(`/backend/customers/companies/${companyId}`)

      // The v1 page edits inline (no header "Save" button); the live editor lives
      // under companies-v2. Lenient assertion: no top-level Save button is present.
      await page.waitForLoadState('domcontentloaded')
      const saveButton = page.getByRole('button', { name: /^save$/i })
      await expect(
        saveButton,
        'the legacy v1 companies page should not expose a header "Save" button',
      ).toHaveCount(0, { timeout: 15_000 })
    } finally {
      await deleteEntityIfExists(page.request, token, '/api/customers/companies', companyId)
    }
  })

  // NEG-02 opt-out (OM_OPTIMISTIC_LOCK=off): this shared app boots default-ON, so a
  // stale write always 409s here — the opt-out path cannot be exercised against it
  // (a second app with the env flag flipped cannot be booted from this suite).
  // The opt-out behavior is a pure function of the env parser + guard service, so it
  // is proven as a runnable UNIT test instead of an unrunnable integration placeholder:
  // see packages/shared/src/lib/crud/__tests__/optimistic-lock.test.ts → the
  // "NEG-02: with OM_OPTIMISTIC_LOCK=... a stale header is NOT enforced" case, which
  // asserts that a stale header (that 409s when the guard is ON) passes through ok
  // when the lock is disabled — the same 200/no-enforcement contract this case wanted.
})
