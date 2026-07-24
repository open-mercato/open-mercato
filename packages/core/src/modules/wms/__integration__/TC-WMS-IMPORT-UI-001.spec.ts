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
  toNumber,
} from './helpers/wmsFixtures'
import { waitForInventoryMutationScope, WMS_IMPORT_FEATURES } from './helpers/wmsUi'

export const integrationMeta = {
  dependsOnModules: ['wms', 'catalog'],
}

/**
 * UI coverage for ImportInventoryDialog validate → apply flow.
 * API contract covered by TC-WMS-025-inventory-import-api.spec.ts
 */
test.describe('TC-WMS-IMPORT-UI-001: Inventory CSV import UI', () => {
  test('uploads CSV, validates, applies import, and refreshes balances', async ({ page, request }) => {
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
      [...WMS_IMPORT_FEATURES],
    )

    let productId: string | null = null
    let warehouseId: string | null = null
    let locationId: string | null = null
    const warehouseCode = `TCIUIW${suffix}`
    const locationCode = `BIN-${suffix}`
    const variantSku = `TCIUI-IMP-${suffix}`
    const importQty = 25

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `TC-WMS-IMPORT-UI ${suffix}`,
        sku: `TCIUI-IMP-P-${suffix}`,
      })
      const variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `TC-WMS-IMPORT-UI Variant ${suffix}`,
        sku: variantSku,
      })

      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `TC-WMS-IMPORT-UI Warehouse ${suffix}`,
        code: warehouseCode,
        city: 'Poznan',
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

      const csvContent = [
        'warehouse_code,location_code,sku,quantity',
        `${warehouseCode},${locationCode},${variantSku},${importQty}`,
      ].join('\n')

      await login(page, 'admin')
      await page.goto('/backend/wms/inventory')
      await waitForInventoryMutationScope(page)

      await page.getByRole('button', { name: 'Import CSV' }).click()
      const importDialog = page.getByRole('dialog').filter({ hasText: /Import CSV/i }).first()
      await expect(importDialog).toBeVisible()

      await importDialog.locator('input[type="file"]').setInputFiles({
        name: `wms-import-${suffix}.csv`,
        mimeType: 'text/csv',
        buffer: Buffer.from(csvContent),
      })
      await expect(importDialog.getByText(`wms-import-${suffix}.csv`)).toBeVisible()

      await importDialog.getByRole('button', { name: 'Next' }).click()
      await expect(importDialog.getByText('Step 2 of 3 · Map CSV columns to fields')).toBeVisible()

      await importDialog.getByRole('button', { name: 'Next' }).click()
      await expect(page.getByText('CSV validated — review rows before applying.').first()).toBeVisible({
        timeout: 15_000,
      })
      await expect(importDialog.getByText('Step 3 of 3 · Review and import')).toBeVisible()

      await importDialog.getByRole('button', { name: /Import .* rows/i }).click()
      await expect(page.getByText(/Import finished/i).first()).toBeVisible({ timeout: 15_000 })
      await expect(importDialog).toHaveCount(0)

      const balanceRow = page.getByRole('row').filter({ hasText: variantSku }).first()
      await expect(balanceRow).toBeVisible({ timeout: 15_000 })
      await expect(balanceRow).toContainText(String(importQty))

      const balance = await fetchBalance(request, adminToken, warehouseId, variantId)
      expect(toNumber(balance?.quantity_on_hand)).toBe(importQty)
    } finally {
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', locationId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await restoreAdminAcl()
    }
  })
})
