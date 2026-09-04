import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
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
import {
  createCrudFixture,
  ensureRoleFeatures,
  postAction,
} from './helpers/wmsFixtures'

export const integrationMeta = {
  dependsOnModules: ['wms', 'catalog'],
}

type CatalogProductListItem = Record<string, unknown> & {
  id?: string
  title?: string
  _wms?: {
    stockSummary?: Array<{
      catalogVariantId: string
      available: string
      onHand: string
    }>
  }
}

type CatalogProductListResponse = {
  items?: CatalogProductListItem[]
}

/**
 * TC-WMS-STOCK-COL-004: the catalog products list `_wms` enrichment is cached
 * read-through, so this asserts the cache never outlives the write that
 * invalidates it. After an inventory adjustment the very next list response
 * MUST show the new quantity — not the value cached moments earlier — because
 * the adjustment drops the WMS inventory cache tag. Base-record freshness on a
 * cache hit is covered by the unit tests in
 * `packages/shared/src/lib/crud/__tests__/enricher-runner.read-through-cache.test.ts`.
 */
test.describe('TC-WMS-STOCK-COL-004: WMS enricher cache — products list reflects a stock change immediately', () => {
  test('should serve updated stock on the next products list read after an adjustment', async ({
    request,
  }) => {
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
    let variantId: string | null = null
    let warehouseId: string | null = null
    let locationId: string | null = null
    let profileId: string | null = null

    const readProduct = async (): Promise<CatalogProductListItem | undefined> => {
      const response = await apiRequest(
        request,
        'GET',
        `/api/catalog/products?id=${encodeURIComponent(productId!)}&page=1&pageSize=1`,
        { token: adminToken },
      )
      expect(response.ok(), `GET /api/catalog/products failed: ${response.status()}`).toBeTruthy()
      const body = await readJsonSafe<CatalogProductListResponse>(response)
      return body?.items?.[0]
    }

    const availableForVariant = (product: CatalogProductListItem | undefined): number => {
      const entry = product?._wms?.stockSummary?.find((item) => item.catalogVariantId === variantId)
      expect(entry, `Expected stockSummary entry for variant ${variantId}`).toBeTruthy()
      return Number(entry?.available)
    }

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `TC-WMS-STOCK-COL-004 Product ${suffix}`,
        sku: `TWSC004-${suffix}`,
      })

      variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `TC-WMS-STOCK-COL-004 Variant ${suffix}`,
        sku: `TWSC004-V-${suffix}`,
        isDefault: true,
      })

      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `TC-WMS-STOCK-COL-004 Warehouse ${suffix}`,
        code: `TWSC004W${suffix}`,
        timezone: 'UTC',
        isActive: true,
      })

      locationId = await createCrudFixture(request, adminToken, '/api/wms/locations', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        code: `TWSC004L${suffix}`,
        type: 'bin',
        isActive: true,
      })

      profileId = await createCrudFixture(request, adminToken, '/api/wms/inventory-profiles', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        catalogProductId: productId,
        catalogVariantId: variantId,
        defaultUom: 'pc',
        defaultStrategy: 'fifo',
      })

      await postAction<{ movementId?: string }>(request, adminToken, '/api/wms/inventory/adjust', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        locationId,
        catalogVariantId: variantId,
        delta: 20,
        reason: 'TC-WMS-STOCK-COL-004 seed stock',
        referenceType: 'manual',
        referenceId: randomUUID(),
        performedBy: scope.userId,
      })

      // Two reads: the first populates the read-through cache, the second must
      // hit it and still report the same figure.
      const seeded = await readProduct()
      expect(seeded, 'Expected product in response').toBeTruthy()
      expect(availableForVariant(seeded)).toBe(20)
      expect(availableForVariant(await readProduct())).toBe(20)

      await postAction<{ movementId?: string }>(request, adminToken, '/api/wms/inventory/adjust', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        locationId,
        catalogVariantId: variantId,
        delta: -8,
        reason: 'TC-WMS-STOCK-COL-004 consume stock',
        referenceType: 'manual',
        referenceId: randomUUID(),
        performedBy: scope.userId,
      })

      // The adjustment drops the WMS inventory cache tag, so this must not be
      // served from the entry written above.
      await expect
        .poll(async () => availableForVariant(await readProduct()), {
          message: 'Expected the products list to reflect the adjusted stock after tag invalidation',
          timeout: 10_000,
        })
        .toBe(12)
    } finally {
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/inventory-profiles', profileId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', locationId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await restoreAdminAcl()
    }
  })
})
