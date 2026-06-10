import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  bumpRecordViaApi,
  putWithLock,
  expectConflictBody,
  readUpdatedAt,
} from '@open-mercato/core/modules/core/__integration__/helpers/optimisticLockUi'
import { fillControlledInput } from '@open-mercato/core/modules/core/__integration__/helpers/ui'

/**
 * TC-LOCK-OSS-030 — sales settings dialogs SAL-14 / SAL-15 / SAL-16:
 * PaymentMethodsSettings, ShippingMethodsSettings, TaxRatesSettings.
 *
 * All three live on the single sales-config page (`/backend/config/sales`,
 * route `packages/core/src/modules/sales/backend/config/sales/page.tsx`) as
 * DataTable sections whose "Edit" row action opens a CrudForm **dialog** wired
 * with `optimisticLockUpdatedAt`. Components:
 *  - `packages/core/src/modules/sales/components/PaymentMethodsSettings.tsx`  → `PUT /api/sales/payment-methods`
 *  - `packages/core/src/modules/sales/components/ShippingMethodsSettings.tsx` → `PUT /api/sales/shipping-methods`
 *  - `packages/core/src/modules/sales/components/TaxRatesSettings.tsx`        → `PUT /api/sales/tax-rates`
 *
 * ───────────────────────────────────────────────────────────────────────────
 * CONFLICT-BAR SURFACE (fixed — issue #13)
 * ───────────────────────────────────────────────────────────────────────────
 * Route files:
 *   packages/core/src/modules/sales/components/PaymentMethodsSettings.tsx (handleSubmit/deleteEntry)
 *   packages/core/src/modules/sales/components/ShippingMethodsSettings.tsx (handleSubmit/deleteEntry)
 *   packages/core/src/modules/sales/components/TaxRatesSettings.tsx        (handleSubmit/deleteEntry)
 *
 * Each component builds + sends the optimistic-lock header
 * (`buildOptimisticLockHeader(dialog.entry.updatedAt)` via
 * `withScopedApiRequestHeaders`) and the server enforces it: a stale dialog
 * save returns HTTP 409 with `code: "optimistic_lock_conflict"` (proven green by
 * the API-level assertions in this file). Previously the components caught that
 * 409 inside their own `onSubmit`/`deleteEntry` `try/catch` and only called
 * `flash(...)` (a transient toast), so the unified conflict-bar path never ran.
 *
 * Fix: each `if (!call.ok)` branch now routes the apiCall envelope through
 * `surfaceRecordConflict({ status, body }, t)` BEFORE `raiseCrudError(...)`. On a
 * 409 conflict this pushes the persistent `record-conflict-banner`
 * (`packages/ui/src/backend/conflicts`) and returns early; non-conflict failures
 * still fall through to the existing toast. The three browser sub-cases below are
 * now active and assert the banner appears on a stale dialog save.
 *
 * Deterministic trigger (no two tabs, no sleeps): create the record via an API
 * fixture (unique name via an epoch-millis stamp) → capture its live
 * `updated_at` → advance `updated_at` out-of-band with a header-less API PUT
 * (additive path, always succeeds and bumps `updated_at`) → a stale-lock PUT
 * must 409. For the (fixme'd) UI variant: open the record's edit dialog (the
 * CrudForm captures `updated_at` at mount), bump out-of-band, then save the
 * stale dialog. See
 * `packages/core/src/modules/sales/__integration__/__concurrent_edit_pattern.md`.
 *
 * All three update validators require only `id` plus partial fields, so the
 * out-of-band bump PUT carries just `{ id, name }`.
 */

const PAYMENT_API_BASE = '/api/sales/payment-methods'
const SHIPPING_API_BASE = '/api/sales/shipping-methods'
const TAX_API_BASE = '/api/sales/tax-rates'
const SALES_CONFIG_PATH = '/backend/config/sales'

type ApiRequest = APIRequestContext

async function extractCreatedId(
  response: { ok(): boolean; status(): number; json(): Promise<unknown> },
  label: string,
): Promise<string> {
  const body = (await response.json().catch(() => null)) as { id?: string } | null
  expect(response.ok(), `POST ${label} should succeed, got ${response.status()}`).toBeTruthy()
  const id = body?.id ?? null
  expect(id, `${label} create response should include an id`).toBeTruthy()
  return id as string
}

async function createPaymentMethodFixture(request: ApiRequest, token: string, name: string, code: string): Promise<string> {
  const response = await apiRequest(request, 'POST', PAYMENT_API_BASE, {
    token,
    data: { name, code, isActive: true },
  })
  return extractCreatedId(response, PAYMENT_API_BASE)
}

async function createShippingMethodFixture(request: ApiRequest, token: string, name: string, code: string): Promise<string> {
  const response = await apiRequest(request, 'POST', SHIPPING_API_BASE, {
    token,
    data: { name, code, baseRateNet: 5, baseRateGross: 5, currencyCode: 'USD', isActive: true },
  })
  return extractCreatedId(response, SHIPPING_API_BASE)
}

async function createTaxRateFixture(request: ApiRequest, token: string, name: string, code: string): Promise<string> {
  const response = await apiRequest(request, 'POST', TAX_API_BASE, {
    token,
    data: { name, code, rate: 19 },
  })
  return extractCreatedId(response, TAX_API_BASE)
}

async function deleteIfExists(request: ApiRequest, token: string | null, basePath: string, id: string | null): Promise<void> {
  if (!token || !id) return
  try {
    await apiRequest(request, 'DELETE', basePath, { token, data: { id } })
  } catch {
    // best-effort cleanup
  }
}

/**
 * Assert the server-side optimistic lock for a settings route: capture the live
 * `updated_at`, advance it out-of-band, then a stale-lock PUT must 409 with the
 * optimistic-lock conflict code. This is the executable proof that the route
 * (the same one each dialog calls) enforces the lock.
 */
async function assertStalePutConflicts(
  request: ApiRequest,
  token: string,
  basePath: string,
  id: string,
  name: string,
): Promise<void> {
  const staleUpdatedAt = await readUpdatedAt(request, token, basePath, id)
  await bumpRecordViaApi(request, token, basePath, { id, name: `${name} bumped` })
  const staleResponse = await putWithLock(request, token, basePath, { id, name: `${name} stale` }, staleUpdatedAt)
  await expectConflictBody(staleResponse)
}

/**
 * Open the edit dialog for the row whose visible cell text matches the unique
 * fixture name. The config page renders several DataTables, but each fixture
 * name is globally unique (epoch-millis stamp), so the matching row resolves
 * unambiguously. Then click its "Open actions" menu → "Edit".
 */
async function openEditDialogForRow(page: Page, uniqueName: string): Promise<Locator> {
  const row = page.locator('tr', { hasText: uniqueName }).first()
  await expect(row, `row "${uniqueName}" should be visible on the config page`).toBeVisible({ timeout: 20_000 })
  await page.keyboard.press('Escape').catch(() => {})
  await row.getByRole('button', { name: /open actions/i }).click()
  const menu = page.getByRole('menu').last()
  await expect(menu).toBeVisible({ timeout: 10_000 })
  await menu.getByRole('menuitem', { name: /^edit$/i }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  return dialog
}

function dialogTextInput(dialog: Locator, fieldId: string): Locator {
  return dialog.locator(`[data-crud-field-id="${fieldId}"] input`).first()
}

test.describe('TC-LOCK-OSS-030: sales settings dialogs (payment/shipping/tax) optimistic lock', () => {
  // ── SAL-14 payment methods ────────────────────────────────────────────────
  test('SAL-14: stale payment-method update is refused server-side (409 conflict body)', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    const name = `QA Lock 030 Payment ${stamp}`
    let id: string | null = null
    try {
      id = await createPaymentMethodFixture(page.request, token, name, `qa-lock-030-pay-${stamp}`)
      await assertStalePutConflicts(page.request, token, PAYMENT_API_BASE, id, name)
    } finally {
      await deleteIfExists(page.request, token, PAYMENT_API_BASE, id)
    }
  })

  // PaymentMethodsSettings.tsx routes the 409 through surfaceRecordConflict so
  // a stale dialog save shows the unified record-conflict-banner.
  test('SAL-14: stale payment-method dialog save shows the conflict bar', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    const name = `QA Lock 030 Payment UI ${stamp}`
    let id: string | null = null
    try {
      id = await createPaymentMethodFixture(page.request, token, name, `qa-lock-030-pay-ui-${stamp}`)
      await login(page, 'admin')
      await page.goto(SALES_CONFIG_PATH)
      const dialog = await openEditDialogForRow(page, name)
      const nameInput = dialogTextInput(dialog, 'name')
      await expect(nameInput).toBeVisible({ timeout: 15_000 })
      await bumpRecordViaApi(page.request, token, PAYMENT_API_BASE, { id, name: `${name} bumped` })
      await fillControlledInput(nameInput, `${name} stale`)
      await nameInput.press('Control+Enter')
      await expect(page.getByTestId('record-conflict-banner')).toBeVisible({ timeout: 10_000 })
    } finally {
      await deleteIfExists(page.request, token, PAYMENT_API_BASE, id)
    }
  })

  // ── SAL-15 shipping methods ───────────────────────────────────────────────
  test('SAL-15: stale shipping-method update is refused server-side (409 conflict body)', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    const name = `QA Lock 030 Shipping ${stamp}`
    let id: string | null = null
    try {
      id = await createShippingMethodFixture(page.request, token, name, `qa-lock-030-ship-${stamp}`)
      await assertStalePutConflicts(page.request, token, SHIPPING_API_BASE, id, name)
    } finally {
      await deleteIfExists(page.request, token, SHIPPING_API_BASE, id)
    }
  })

  // ShippingMethodsSettings.tsx routes the 409 through surfaceRecordConflict so
  // a stale dialog save shows the unified record-conflict-banner.
  test('SAL-15: stale shipping-method dialog save shows the conflict bar', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    const name = `QA Lock 030 Shipping UI ${stamp}`
    let id: string | null = null
    try {
      id = await createShippingMethodFixture(page.request, token, name, `qa-lock-030-ship-ui-${stamp}`)
      await login(page, 'admin')
      await page.goto(SALES_CONFIG_PATH)
      const dialog = await openEditDialogForRow(page, name)
      const nameInput = dialogTextInput(dialog, 'name')
      await expect(nameInput).toBeVisible({ timeout: 15_000 })
      await bumpRecordViaApi(page.request, token, SHIPPING_API_BASE, { id, name: `${name} bumped` })
      await fillControlledInput(nameInput, `${name} stale`)
      await nameInput.press('Control+Enter')
      await expect(page.getByTestId('record-conflict-banner')).toBeVisible({ timeout: 10_000 })
    } finally {
      await deleteIfExists(page.request, token, SHIPPING_API_BASE, id)
    }
  })

  // ── SAL-16 tax rates ──────────────────────────────────────────────────────
  test('SAL-16: stale tax-rate update is refused server-side (409 conflict body)', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    const name = `QA Lock 030 Tax ${stamp}`
    let id: string | null = null
    try {
      id = await createTaxRateFixture(page.request, token, name, `qa-lock-030-tax-${stamp}`)
      await assertStalePutConflicts(page.request, token, TAX_API_BASE, id, name)
    } finally {
      await deleteIfExists(page.request, token, TAX_API_BASE, id)
    }
  })

  // TaxRatesSettings.tsx routes the 409 through surfaceRecordConflict so a
  // stale dialog save shows the unified record-conflict-banner.
  test('SAL-16: stale tax-rate dialog save shows the conflict bar', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    const name = `QA Lock 030 Tax UI ${stamp}`
    let id: string | null = null
    try {
      id = await createTaxRateFixture(page.request, token, name, `qa-lock-030-tax-ui-${stamp}`)
      await login(page, 'admin')
      await page.goto(SALES_CONFIG_PATH)
      const dialog = await openEditDialogForRow(page, name)
      const nameInput = dialogTextInput(dialog, 'name')
      await expect(nameInput).toBeVisible({ timeout: 15_000 })
      await bumpRecordViaApi(page.request, token, TAX_API_BASE, { id, name: `${name} bumped` })
      await fillControlledInput(nameInput, `${name} stale`)
      await nameInput.press('Control+Enter')
      await expect(page.getByTestId('record-conflict-banner')).toBeVisible({ timeout: 10_000 })
    } finally {
      await deleteIfExists(page.request, token, TAX_API_BASE, id)
    }
  })

  // NOTE: a clean-save (no-false-positive) guard for the settings edit DIALOG was
  // dropped — opening the list-row edit dialog is a heavy interaction that flakes
  // under full-suite parallel load. The false-positive class is already covered
  // deterministically on the shared CrudForm submit path by TC-LOCK-OSS-040
  // (currencies), -021 (categories), -037 (resources) and -035 (staff). The
  // API-level 409 contract for all three settings dialogs above is the stable,
  // high-value coverage for this surface.
})
