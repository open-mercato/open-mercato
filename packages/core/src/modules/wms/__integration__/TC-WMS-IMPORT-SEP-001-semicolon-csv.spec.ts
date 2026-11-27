import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  createProductFixture,
  createVariantFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures'
import {
  deleteGeneralEntityIfExists,
  getTokenScope,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import { createCrudFixture, ensureRoleFeatures } from './helpers/wmsFixtures'
import {
  inventoryOperationsSection,
  waitForInventoryMutationScope,
  WMS_IMPORT_FEATURES,
} from './helpers/wmsUi'

export const integrationMeta = {
  dependsOnModules: ['wms', 'catalog'],
}

type ImportValidationResponse = {
  ok?: boolean
  rows?: Array<{
    status?: string
    errors?: string[]
    resolved?: { delta?: number }
  }>
}

test.describe('TC-WMS-IMPORT-SEP-001: Inventory CSV import accepts semicolon-separated files', () => {
  test('validates a semicolon CSV over the API and maps all its columns in the import dialog', async ({
    page,
    request,
  }) => {
    test.slow()

    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    const suffix = randomUUID().slice(0, 8)
    const warehouseCode = `TCSEPW${suffix}`
    const locationCode = `BIN-${suffix}`
    const variantSku = `TCSEP-V-${suffix}`

    const restoreAdminAcl = await ensureRoleFeatures(request, superadminToken, scope.tenantId, 'admin', [
      ...WMS_IMPORT_FEATURES,
    ])

    let productId: string | null = null
    let warehouseId: string | null = null
    let locationId: string | null = null

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `TC-WMS-IMPORT-SEP ${suffix}`,
        sku: `TCSEP-P-${suffix}`,
      })
      await createVariantFixture(request, adminToken, {
        productId,
        name: `TC-WMS-IMPORT-SEP Variant ${suffix}`,
        sku: variantSku,
      })
      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `TC-WMS-IMPORT-SEP Warehouse ${suffix}`,
        code: warehouseCode,
        city: 'Warsaw',
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
        isActive: true,
      })

      const csv = [
        'warehouse_code;location_code;sku;quantity;lot_number;serial_number',
        `${warehouseCode};${locationCode};${variantSku};7;;`,
      ].join('\r\n')

      const response = await apiRequest(request, 'POST', '/api/wms/inventory/import/validate', {
        token: adminToken,
        data: {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          csv,
        },
      })
      expect(response.ok(), `validate failed: ${response.status()}`).toBeTruthy()
      const validation = (await readJsonSafe<ImportValidationResponse>(response)) ?? {}
      expect(validation.rows?.[0]?.errors ?? []).toEqual([])
      expect(validation.ok).toBe(true)
      expect(validation.rows?.[0]?.resolved?.delta).toBe(7)

      await login(page, 'admin')
      await page.goto('/backend/wms/inventory')
      await waitForInventoryMutationScope(page)

      await inventoryOperationsSection(page).getByRole('button', { name: 'Import CSV' }).click()
      const importDialog = page.getByRole('dialog').filter({ hasText: /Import CSV/i }).first()
      await expect(importDialog).toBeVisible()
      await expect(importDialog.getByText('CSV · comma or semicolon (auto-detected)')).toBeVisible()

      await importDialog.locator('input[type="file"]').setInputFiles({
        name: `wms-import-sep-${suffix}.csv`,
        mimeType: 'text/csv',
        buffer: Buffer.from(`\uFEFF${csv}\r\n`),
      })
      await expect(importDialog.getByText(`wms-import-sep-${suffix}.csv`)).toBeVisible()

      await importDialog.getByRole('button', { name: 'Next' }).click()
      await expect(importDialog.getByText('Step 2 of 3 · Map CSV columns to fields')).toBeVisible()
      await expect(importDialog.getByText('6 of 6 columns mapped · 1 rows detected')).toBeVisible()

      await importDialog.getByRole('button', { name: 'Next' }).click()
      await expect(page.getByText('CSV validated — review rows before applying.').first()).toBeVisible({
        timeout: 15_000,
      })
      await expect(importDialog.getByText('Step 3 of 3 · Review and import')).toBeVisible()
    } finally {
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', locationId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await restoreAdminAcl()
    }
  })
})
