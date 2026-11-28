import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createProductFixture, createVariantFixture, deleteCatalogProductIfExists } from '@open-mercato/core/helpers/integration/catalogFixtures'
import { deleteGeneralEntityIfExists, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createCrudFixture, ensureRoleFeatures, postAction, toNumber } from './helpers/wmsFixtures'
import { ensureEnglishLocale, fillCombobox, waitForInventoryMutationScope, WMS_IMPORT_FEATURES } from './helpers/wmsUi'

export const integrationMeta = {
  dependsOnModules: ['wms', 'catalog'],
}

type BalanceRow = { lot_id?: string | null; quantity_on_hand?: string | number | null }

test.describe('TC-WMS-TRACK-001: adjust, cycle count and import keep lot-tracked stock in its lot', () => {
  test('refuses adjust, cycle count and import rows without a lot and shows the reason in the adjust dialog', async ({ page, request }) => {
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    const scopeIds = { organizationId: scope.organizationId, tenantId: scope.tenantId }
    const suffix = randomUUID().slice(0, 8)
    const restoreAdminAcl = await ensureRoleFeatures(request, superadminToken, scope.tenantId, 'admin', [...WMS_IMPORT_FEATURES])

    let productId: string | null = null
    let warehouseId: string | null = null
    let locationId: string | null = null
    let profileId: string | null = null
    let lotId: string | null = null
    let stockedAdjust: Record<string, unknown> | null = null
    const warehouseName = `TC-WMS-TRACK-001 Warehouse ${suffix}`
    const locationCode = `BIN-${suffix}`
    const variantSku = `TCWTRK-V-${suffix}`

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `TC-WMS-TRACK-001 Product ${suffix}`,
        sku: `TCWTRK-P-${suffix}`,
      })
      const variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `TC-WMS-TRACK-001 Variant ${suffix}`,
        sku: variantSku,
      })
      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        ...scopeIds,
        name: warehouseName,
        code: `TCWTRK${suffix}`,
        isActive: true,
      })
      locationId = await createCrudFixture(request, adminToken, '/api/wms/locations', {
        ...scopeIds,
        warehouseId,
        code: locationCode,
        type: 'bin',
        isActive: true,
      })
      profileId = await createCrudFixture(request, adminToken, '/api/wms/inventory-profiles', {
        ...scopeIds,
        catalogProductId: productId,
        catalogVariantId: variantId,
        defaultUom: 'pcs',
        defaultStrategy: 'fifo',
        trackLot: true,
      })
      lotId = await createCrudFixture(request, adminToken, '/api/wms/lots', {
        ...scopeIds,
        catalogVariantId: variantId,
        sku: variantSku,
        lotNumber: `LOT-${suffix}`,
      })
      const bucket = { ...scopeIds, warehouseId, locationId, catalogVariantId: variantId, performedBy: scope.userId }
      const adjustBody = { ...bucket, reason: 'TC-WMS-TRACK-001', referenceType: 'manual' }

      await postAction(request, adminToken, '/api/wms/inventory/adjust', { ...adjustBody, lotId, delta: 50, referenceId: randomUUID() })
      stockedAdjust = { ...adjustBody, lotId, delta: -50 }
      const adjustWithoutLot = await apiRequest(request, 'POST', '/api/wms/inventory/adjust', {
        token: adminToken,
        data: { ...adjustBody, delta: 20, referenceId: randomUUID() },
      })
      expect(adjustWithoutLot.status()).toBe(422)
      await expect(readJsonSafe(adjustWithoutLot)).resolves.toMatchObject({ error: 'lot_required' })
      const countWithoutLot = await apiRequest(request, 'POST', '/api/wms/inventory/cycle-count', {
        token: adminToken,
        data: { ...bucket, countedQuantity: 20, autoAdjust: true, reason: 'TC-WMS-TRACK-001', referenceId: randomUUID() },
      })
      expect(countWithoutLot.status()).toBe(422)
      await expect(readJsonSafe(countWithoutLot)).resolves.toMatchObject({ error: 'lot_required' })

      const importPreview = await apiRequest(request, 'POST', '/api/wms/inventory/import/validate', {
        token: adminToken,
        data: { ...scopeIds, rows: [{ warehouseCode: `TCWTRK${suffix}`, locationCode, sku: variantSku, quantity: '3' }] },
      })
      expect(importPreview.status()).toBe(200)
      await expect(readJsonSafe(importPreview)).resolves.toMatchObject({
        ok: false,
        rows: [{ status: 'error', errors: ['lot_required'] }],
      })

      const balancesResponse = await apiRequest(request, 'GET', `/api/wms/inventory/balances?locationId=${locationId}&catalogVariantId=${variantId}`, { token: adminToken })
      expect(balancesResponse.ok()).toBeTruthy()
      const balances = (await readJsonSafe<{ items?: BalanceRow[] }>(balancesResponse))?.items ?? []
      expect(balances.map((row) => [row.lot_id ?? null, toNumber(row.quantity_on_hand)])).toEqual([[lotId, 50]])

      await ensureEnglishLocale(page)
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
        suggestionsApiPath: '/api/wms/warehouses',
        waitForEnabledPlaceholder: 'Select location',
      })
      await fillCombobox(page, 'Select location', locationCode, {
        scope: adjustDialog,
        suggestionsApiPath: '/api/wms/locations',
      })
      await adjustDialog.locator('input[inputmode="decimal"]').fill('5')
      await adjustDialog.getByRole('combobox').filter({ hasText: 'Select reason' }).click()
      await page.getByRole('option', { name: 'Found stock' }).click()
      const responsePromise = page.waitForResponse(
        (response) => response.request().method() === 'POST' && response.url().includes('/api/wms/inventory/adjust'),
      )
      await adjustDialog.getByRole('button', { name: 'Save adjustment' }).click()
      expect((await responsePromise).status()).toBe(422)
      await expect(page.getByText('Lot number is required for this variant.').first()).toBeVisible({ timeout: 10_000 })
    } finally {
      try {
        if (stockedAdjust) {
          await apiRequest(request, 'POST', '/api/wms/inventory/adjust', {
            token: adminToken,
            data: { ...stockedAdjust, referenceId: randomUUID() },
          })
        }
        await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/inventory-profiles', profileId)
        await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/lots', lotId)
        await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', locationId)
        await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
        await deleteCatalogProductIfExists(request, adminToken, productId)
      } finally {
        await restoreAdminAcl()
      }
    }
  })
})
