import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  createProductFixture,
  createVariantFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures'
import {
  deleteGeneralEntityIfExists,
  getTokenScope,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createCrudFixture,
  ensureRoleFeatures,
  fetchBalance,
  fetchMovements,
  postAction,
  toNumber,
} from './helpers/wmsFixtures'
import {
  fillCombobox,
  waitForInventoryMutationScope,
  WMS_INVENTORY_MUTATION_FEATURES,
} from './helpers/wmsUi'

export const integrationMeta = {
  dependsOnModules: ['wms', 'catalog'],
}

/**
 * WMS-P1-INT-13 / Source: .ai/specs/2026-04-15-wms-phase-1-core-inventory.md
 * UI adjust and 3-step cycle count from /backend/wms/inventory
 */
test.describe('TC-WMS-INVENTORY-UI-001: Inventory console mutations', () => {
  test('posts a positive adjust and refreshes balances in the console', async ({ page, request }) => {
    test.slow()

    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    const suffix = randomUUID().slice(0, 8)

    const restoreAdminAcl = await ensureRoleFeatures(
      request,
      superadminToken,
      scope.tenantId,
      'admin',
      [...WMS_INVENTORY_MUTATION_FEATURES],
    )

    let productId: string | null = null
    let warehouseId: string | null = null
    let locationId: string | null = null
    let profileId: string | null = null
    const warehouseName = `TC-WMS-INV-UI Warehouse ${suffix}`
    const warehouseCode = `TCIUIW${suffix}`
    const locationCode = `BIN-${suffix}`
    const variantSku = `TCIUI-V-${suffix}`
    const adjustDelta = 7

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `TC-WMS-INV-UI Adjust ${suffix}`,
        sku: `TCIUI-P-${suffix}`,
      })
      const variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `TC-WMS-INV-UI Variant ${suffix}`,
        sku: variantSku,
      })

      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: warehouseName,
        code: warehouseCode,
        city: 'Lodz',
        country: 'PL',
        timezone: 'Europe/Warsaw',
        isActive: true,
      })

      locationId = await createCrudFixture(request, adminToken, '/api/wms/locations', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        code: locationCode,
        type: 'bin',
        capacityUnits: 100,
        capacityWeight: 500,
        isActive: true,
      })

      profileId = await createCrudFixture(request, adminToken, '/api/wms/inventory-profiles', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        catalogProductId: productId,
        catalogVariantId: variantId,
        defaultUom: 'pcs',
        defaultStrategy: 'fifo',
      })

      await login(page, 'admin')
      await page.goto('/backend/wms/inventory')
      await waitForInventoryMutationScope(page)

      await page.getByRole('button', { name: 'Adjust inventory' }).click()
      const adjustDialog = page.getByRole('dialog').filter({ hasText: /Adjust inventory/i }).first()
      await expect(adjustDialog).toBeVisible()

      await fillCombobox(page, 'Search variant or SKU', variantSku, {
        scope: adjustDialog,
        suggestionsApiPath: '/api/catalog/variants',
      })
      await fillCombobox(page, 'Select warehouse', warehouseName, {
        scope: adjustDialog,
        waitForEnabledPlaceholder: 'Select location',
      })
      await fillCombobox(page, 'Select location', locationCode, {
        scope: adjustDialog,
        suggestionsApiPath: '/api/wms/locations',
      })

      await adjustDialog.locator('input[inputmode="decimal"]').fill(String(adjustDelta))
      await adjustDialog.getByRole('combobox').click()
      await page.getByRole('option', { name: 'Found stock' }).click()
      await adjustDialog.getByRole('button', { name: 'Save adjustment' }).click()

      await expect(page.getByText('Inventory adjusted').first()).toBeVisible({ timeout: 10_000 })
      await expect(adjustDialog).toHaveCount(0)

      const balanceRow = page.getByRole('row').filter({ hasText: variantSku }).first()
      await expect(balanceRow).toBeVisible({ timeout: 15_000 })
      await expect(balanceRow).toContainText(String(adjustDelta))

      const balance = await fetchBalance(request, adminToken, warehouseId, variantId)
      expect(toNumber(balance?.quantity_on_hand)).toBe(adjustDelta)
    } finally {
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/inventory-profiles', profileId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', locationId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await restoreAdminAcl()
    }
  })

  test('runs the 3-step cycle count wizard and updates balances and movements', async ({
    page,
    request,
  }) => {
    test.slow()

    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    const suffix = randomUUID().slice(0, 8)

    const restoreAdminAcl = await ensureRoleFeatures(
      request,
      superadminToken,
      scope.tenantId,
      'admin',
      [...WMS_INVENTORY_MUTATION_FEATURES],
    )

    let productId: string | null = null
    let warehouseId: string | null = null
    let zoneId: string | null = null
    let locationId: string | null = null
    let profileId: string | null = null
    const warehouseName = `TC-WMS-INV-UI CC Warehouse ${suffix}`
    const warehouseCode = `TCIUICW${suffix}`
    const zoneName = `Inbound Zone ${suffix}`
    const zoneCode = `ZONE-${suffix}`
    const locationCode = `CC-${suffix}`
    const variantSku = `TCIUI-CC-${suffix}`
    const baselineQty = 5
    const countedQty = 2

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `TC-WMS-INV-UI Cycle ${suffix}`,
        sku: `TCIUI-CCP-${suffix}`,
      })
      const variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `TC-WMS-INV-UI Cycle Variant ${suffix}`,
        sku: variantSku,
      })

      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: warehouseName,
        code: warehouseCode,
        city: 'Krakow',
        country: 'PL',
        timezone: 'Europe/Warsaw',
        isActive: true,
      })

      zoneId = await createCrudFixture(request, adminToken, '/api/wms/zones', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        code: zoneCode,
        name: zoneName,
        priority: 10,
      })

      locationId = await createCrudFixture(request, adminToken, '/api/wms/locations', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        code: locationCode,
        type: 'bin',
        capacityUnits: 100,
        capacityWeight: 500,
        isActive: true,
      })

      profileId = await createCrudFixture(request, adminToken, '/api/wms/inventory-profiles', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        catalogProductId: productId,
        catalogVariantId: variantId,
        defaultUom: 'pcs',
        defaultStrategy: 'fifo',
      })

      await postAction(request, adminToken, '/api/wms/inventory/adjust', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        locationId,
        catalogVariantId: variantId,
        delta: baselineQty,
        reason: 'Cycle count UI seed',
        referenceType: 'manual',
        referenceId: randomUUID(),
        performedBy: scope.userId,
      })

      await login(page, 'admin')
      await page.goto('/backend/wms/inventory')
      await waitForInventoryMutationScope(page)

      await page.getByRole('button', { name: 'Cycle count' }).click()
      const cycleDialog = page.getByRole('dialog').filter({ hasText: /Cycle count/i }).first()
      await expect(cycleDialog).toBeVisible()

      await fillCombobox(page, 'Select warehouse', warehouseName, {
        scope: cycleDialog,
        waitForEnabledPlaceholder: 'Select zone',
      })
      // Zone options load asynchronously only after the warehouse is selected, so
      // wait for the zone suggestions API before picking — otherwise fillCombobox's
      // keyboard fallback leaves the typed text without committing form.zoneId, and
      // the field silently reverts to empty on blur (wizard then can't advance).
      await fillCombobox(page, 'Select zone', zoneName, {
        scope: cycleDialog,
        suggestionsApiPath: '/api/wms/zones',
      })

      // Expected SKUs only reaches >= 1 once the async scope estimate resolves
      // successfully, so this poll also confirms the estimate has settled before we
      // continue.
      await expect
        .poll(async () => {
          const value = await cycleDialog.locator('input[type="number"]').first().inputValue()
          return Number(value)
        })
        .toBeGreaterThanOrEqual(1)

      // handleSetupContinue validates and advances purely client-side (no API call)
      // and silently returns on any field that has not yet committed in the submit
      // handler's render closure; a concurrent estimate patchForm then clears the
      // field error, so a single swallowed click leaves the wizard stuck on step 1
      // with no visible error. Retry the click until the wizard transitions.
      const step2Heading = cycleDialog.getByText('Step 2 of 3 · Scan and tally items')
      await expect(async () => {
        await cycleDialog.getByRole('button', { name: 'Start counting' }).click()
        await expect(step2Heading).toBeVisible({ timeout: 2_000 })
      }).toPass({ timeout: 20_000 })

      await fillCombobox(page, 'Search variant or SKU', variantSku, {
        scope: cycleDialog,
        suggestionsApiPath: '/api/catalog/variants',
      })
      await fillCombobox(page, 'Select location', locationCode, {
        scope: cycleDialog,
        suggestionsApiPath: '/api/wms/locations',
      })

      const countedInput = cycleDialog.locator('input[inputmode="numeric"]')
      await countedInput.fill(String(countedQty))

      // handleCountContinue validates client-side and only fetches system on-hand
      // before advancing, so it silently returns when a combobox/counted value has
      // not yet committed in the submit handler's render closure. Retry the click
      // until the wizard reaches step 3 (the balance fetch is read-only/idempotent).
      const step3Heading = cycleDialog.getByText('Step 3 of 3 · Review variances and commit')
      await expect(async () => {
        await cycleDialog.getByRole('button', { name: 'Review variances' }).click()
        await expect(step3Heading).toBeVisible({ timeout: 2_000 })
      }).toPass({ timeout: 20_000 })
      await expect(cycleDialog.getByText('-3', { exact: true })).toBeVisible()

      await cycleDialog.getByRole('button', { name: 'Commit & count next' }).click()
      await expect(page.getByText(/Cycle count posted/i).first()).toBeVisible({ timeout: 10_000 })
      // After committing, the wizard resets to step 2 (multi-line mode); close it via "Finish session"
      await cycleDialog.getByRole('button', { name: /Finish session/i }).click()
      await expect(cycleDialog).toHaveCount(0)

      const balanceRow = page.getByRole('row').filter({ hasText: variantSku }).first()
      await expect(balanceRow).toBeVisible({ timeout: 15_000 })
      await expect(balanceRow).toContainText(String(countedQty))

      const balance = await fetchBalance(request, adminToken, warehouseId, variantId)
      expect(toNumber(balance?.quantity_on_hand)).toBe(countedQty)

      const movements = await fetchMovements(request, adminToken, {
        warehouseId,
        catalogVariantId: variantId,
        type: 'cycle_count',
      })
      expect(movements.length).toBeGreaterThanOrEqual(1)
      expect(toNumber(movements[0]?.quantity)).toBe(countedQty - baselineQty)
    } finally {
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/inventory-profiles', profileId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', locationId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/zones', zoneId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await restoreAdminAcl()
    }
  })
})
