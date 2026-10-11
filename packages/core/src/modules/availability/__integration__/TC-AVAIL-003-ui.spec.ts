import { test, expect } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteGeneralEntityIfExists, expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { bumpRecordViaApi, expectConflictBanner } from '@open-mercato/core/helpers/integration/optimisticLockUi'
import { fillControlledInput } from '@open-mercato/core/helpers/integration/ui'

/**
 * TC-AVAIL-003 — browser-driven admin UI: policy create, view-only rendering,
 * the optimistic-lock conflict bar, and the admin check tool.
 *
 * Covers §12 "UI paths" and the US-A1/US-A2/US-B1 keyboard/permission/
 * empty-state ACs that only a real browser can exercise (CrudForm field
 * wiring, the readOnly footer, the live resolution-chain preview panel).
 */

const POLICIES_API_BASE = '/api/availability/policies'
const CATALOG_PRODUCTS_API_BASE = '/api/catalog/products'

test.describe('TC-AVAIL-003: Availability admin UI', () => {
  test('creates a policy from the browser and shows a success flash', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()

    let productId: string | null = null
    let policyId: string | null = null
    try {
      const createProduct = await apiRequest(request, 'POST', CATALOG_PRODUCTS_API_BASE, {
        token,
        data: { ...getTokenContext(token), title: `QA AVAIL 003 Product ${stamp}`, sku: `qa-avail-003-${stamp}` },
      })
      test.skip(createProduct.status() >= 400, `catalog product fixture create failed with ${createProduct.status()}`)
      productId = expectId((await readJsonSafe<{ id?: string }>(createProduct))?.id, 'catalog product id')

      await login(page, 'admin')
      await page.goto('/backend/availability/policies/create')

      await fillControlledInput(page.locator('#availability-policy-product-id'), productId)
      // The live resolution-chain preview (US-A2) appears once a product id is entered,
      // and a brand-new product with no policy rows resolves every field to "module default".
      const preview = page.getByTestId('availability-resolution-preview')
      await expect(preview).toBeVisible({ timeout: 15_000 })
      await expect(preview).toContainText('module default', { timeout: 15_000 })

      await page.locator('[data-crud-field-id="allowBackorder"] button[role="checkbox"]').click()
      await fillControlledInput(page.locator('[data-crud-field-id="backorderLeadTimeDays"] input').first(), '5')

      await page.getByRole('button', { name: /create policy/i }).first().click()
      await expect(page.getByText('Availability policy created', { exact: true }).first()).toBeVisible({ timeout: 15_000 })

      await expect
        .poll(
          async () => {
            const listResponse = await apiRequest(request, 'GET', `${POLICIES_API_BASE}?productId=${productId}`, { token })
            if (!listResponse.ok()) return null
            const body = await readJsonSafe<{ items?: Array<{ id?: string; allowBackorder?: boolean }> }>(listResponse)
            return body?.items?.[0] ?? null
          },
          { timeout: 30_000 },
        )
        .toEqual(expect.objectContaining({ allowBackorder: true }))

      const listResponse = await apiRequest(request, 'GET', `${POLICIES_API_BASE}?productId=${productId}`, { token })
      const body = await readJsonSafe<{ items?: Array<{ id?: string }> }>(listResponse)
      policyId = body?.items?.[0]?.id ?? null
    } finally {
      await deleteGeneralEntityIfExists(request, token, POLICIES_API_BASE, policyId)
      await deleteGeneralEntityIfExists(request, token, CATALOG_PRODUCTS_API_BASE, productId)
    }
  })

  test('a view-only role sees the form as read-only with no Save action', async ({ page, request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const stamp = Date.now()

    let productId: string | null = null
    let policyId: string | null = null
    try {
      const createProduct = await apiRequest(request, 'POST', CATALOG_PRODUCTS_API_BASE, {
        token: adminToken,
        data: { ...getTokenContext(adminToken), title: `QA AVAIL 003b Product ${stamp}`, sku: `qa-avail-003b-${stamp}` },
      })
      test.skip(createProduct.status() >= 400, `catalog product fixture create failed with ${createProduct.status()}`)
      productId = expectId((await readJsonSafe<{ id?: string }>(createProduct))?.id, 'catalog product id')

      const createPolicy = await apiRequest(request, 'POST', POLICIES_API_BASE, {
        token: adminToken,
        data: { ...getTokenContext(adminToken), productId },
      })
      expect(createPolicy.status()).toBe(201)
      policyId = expectId((await readJsonSafe<{ id?: string }>(createPolicy))?.id, 'policy id')

      await login(page, 'employee')
      await page.goto(`/backend/availability/policies/${policyId}`)

      await expect(page.getByRole('button', { name: /save changes/i })).toHaveCount(0)
    } finally {
      await deleteGeneralEntityIfExists(request, adminToken, POLICIES_API_BASE, policyId)
      await deleteGeneralEntityIfExists(request, adminToken, CATALOG_PRODUCTS_API_BASE, productId)
    }
  })

  test('a stale edit shows the optimistic-lock conflict bar', async ({ page, request }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()

    let productId: string | null = null
    let policyId: string | null = null
    try {
      const createProduct = await apiRequest(request, 'POST', CATALOG_PRODUCTS_API_BASE, {
        token,
        data: { ...getTokenContext(token), title: `QA AVAIL 003c Product ${stamp}`, sku: `qa-avail-003c-${stamp}` },
      })
      test.skip(createProduct.status() >= 400, `catalog product fixture create failed with ${createProduct.status()}`)
      productId = expectId((await readJsonSafe<{ id?: string }>(createProduct))?.id, 'catalog product id')

      const createPolicy = await apiRequest(request, 'POST', POLICIES_API_BASE, {
        token,
        data: { ...getTokenContext(token), productId, lowStockThreshold: 3 },
      })
      expect(createPolicy.status()).toBe(201)
      policyId = expectId((await readJsonSafe<{ id?: string }>(createPolicy))?.id, 'policy id')

      await login(page, 'admin')
      await page.goto(`/backend/availability/policies/${policyId}`)

      const thresholdInput = page.locator('[data-crud-field-id="lowStockThreshold"] input').first()
      await expect(thresholdInput).toHaveValue('3', { timeout: 15_000 })

      // Advance updated_at out-of-band so the browser form's captured token is now stale.
      await bumpRecordViaApi(page.request, token, POLICIES_API_BASE, { id: policyId, lowStockThreshold: 9 })

      await fillControlledInput(thresholdInput, '4')
      await page.getByRole('button', { name: /save changes/i }).first().click()

      await expectConflictBanner(page)
    } finally {
      await deleteGeneralEntityIfExists(request, token, POLICIES_API_BASE, policyId)
      await deleteGeneralEntityIfExists(request, token, CATALOG_PRODUCTS_API_BASE, productId)
    }
  })

  test('the admin check tool reproduces not_tracked for a real product and an inline error for an unknown one', async ({ page, request }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()

    let productId: string | null = null
    try {
      const createProduct = await apiRequest(request, 'POST', CATALOG_PRODUCTS_API_BASE, {
        token,
        data: { ...getTokenContext(token), title: `QA AVAIL 003d Product ${stamp}`, sku: `qa-avail-003d-${stamp}` },
      })
      test.skip(createProduct.status() >= 400, `catalog product fixture create failed with ${createProduct.status()}`)
      productId = expectId((await readJsonSafe<{ id?: string }>(createProduct))?.id, 'catalog product id')

      await login(page, 'admin')
      await page.goto('/backend/availability/check')

      await fillControlledInput(page.getByLabel(/product id/i), productId)
      await page.getByRole('button', { name: /run check/i }).click()

      const result = page.getByTestId('availability-check-result')
      await expect(result).toBeVisible({ timeout: 15_000 })
      await expect(result).toContainText('Not tracked')

      await fillControlledInput(page.getByLabel(/product id/i), '00000000-0000-4000-8000-999999999999')
      await page.getByRole('button', { name: /run check/i }).click()
      await expect(page.getByTestId('availability-check-error')).toBeVisible({ timeout: 15_000 })
    } finally {
      await deleteGeneralEntityIfExists(request, token, CATALOG_PRODUCTS_API_BASE, productId)
    }
  })
})
