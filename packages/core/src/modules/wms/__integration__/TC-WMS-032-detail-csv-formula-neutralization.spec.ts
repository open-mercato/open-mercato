import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
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
  postAction,
} from './helpers/wmsFixtures'

export const integrationMeta = {
  dependsOnModules: ['wms', 'catalog'],
}

function expectRowPrefix(line: string, prefix: string) {
  expect(line.slice(0, prefix.length)).toBe(prefix)
}

async function downloadCsvLines(page: Page, rowText: string): Promise<string[]> {
  await expect(page.getByRole('row').filter({ hasText: rowText }).first()).toBeVisible({
    timeout: 15_000,
  })
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /Export CSV/i }).click()
  const download = await downloadPromise
  const filePath = await download.path()
  if (!filePath) throw new Error('[internal] CSV download has no local path')
  return (await readFile(filePath, 'utf8')).split('\n')
}

test.describe('TC-WMS-032: WMS detail-page CSV exports neutralize spreadsheet formulas', () => {
  test('exports formula-leading codes from SKU, lot and location pages as text', async ({
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
      [
        'wms.view',
        'wms.manage_warehouses',
        'wms.manage_locations',
        'wms.manage_inventory',
        'wms.adjust_inventory',
      ],
    )

    let productId: string | null = null
    let warehouseId: string | null = null
    let locationId: string | null = null
    let lotId: string | null = null
    let profileId: string | null = null
    const warehouseCode = `@TCW32W${suffix}`
    const warehouseName = `TC-WMS-032 Warehouse ${suffix}`
    const locationCode = `=1+1-${suffix}`
    const lotNumber = `+LOT-${suffix}`
    const variantSku = `-TCW32-${suffix}`
    const variantName = `@TC-WMS-032 Variant ${suffix}`

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `TC-WMS-032 CSV ${suffix}`,
        sku: `TCW32-P-${suffix}`,
      })
      const variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: variantName,
        sku: variantSku,
      })

      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: warehouseName,
        code: warehouseCode,
        city: 'Gdansk',
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

      lotId = await createCrudFixture(request, adminToken, '/api/wms/lots', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        catalogVariantId: variantId,
        sku: variantSku,
        lotNumber,
        status: 'available',
      })

      await postAction(request, adminToken, '/api/wms/inventory/adjust', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        locationId,
        catalogVariantId: variantId,
        lotId,
        delta: 5,
        reason: 'CSV formula seed',
        referenceType: 'manual',
        referenceId: randomUUID(),
        performedBy: scope.userId,
      })

      const warehouseCell = `'${warehouseCode} · ${warehouseName}`
      const locationCell = `'${locationCode}`
      const lotCell = `'${lotNumber}`

      await login(page, 'admin')

      await page.goto(`/backend/wms/sku/${encodeURIComponent(variantId)}`)
      const skuLines = await downloadCsvLines(page, locationCode)
      expect(skuLines).toHaveLength(2)
      expectRowPrefix(skuLines[1], `${warehouseCell},${locationCell},${lotCell},5,0,`)

      await page.goto(`/backend/wms/lot/${encodeURIComponent(lotId)}`)
      await expect(page.getByText(/Loading lot view/i)).toHaveCount(0, { timeout: 30_000 })
      const lotLines = await downloadCsvLines(page, locationCode)
      expect(lotLines).toHaveLength(2)
      expectRowPrefix(lotLines[1], `${warehouseCell},${locationCell},`)
      expect(lotLines[1]).toContain(',5,0,')

      await page.goto(`/backend/wms/location/${encodeURIComponent(locationId)}`)
      const locationLines = await downloadCsvLines(page, variantSku)
      expect(locationLines).toHaveLength(2)
      expectRowPrefix(locationLines[1], `'${variantSku},'${variantName},${lotCell},5,0,`)
    } finally {
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/lots', lotId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/inventory-profiles', profileId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', locationId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await restoreAdminAcl()
    }
  })
})
