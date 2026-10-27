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
import { createCrudFixture, ensureRoleFeatures, postAction } from './helpers/wmsFixtures'

export const integrationMeta = {
  dependsOnModules: ['wms', 'catalog', 'availability'],
}

const CHECK_API_BASE = '/api/availability/check'

type AvailabilityCheckResponse = {
  availability?: {
    state?: string
    availableQuantity?: number | null
    canFulfil?: boolean
    isAuthoritative?: boolean
  } | null
}

/**
 * TC-WMS-AVAIL-001 — the `wms`-backed `AvailabilityProvider` through
 * `POST /api/availability/check`.
 *
 * Covers the §4.2 stock-derived states a storefront relies on: a tracked
 * variant (it has a `ProductInventoryProfile`) reports `in_stock` with the
 * sellable quantity net of safety stock, `out_of_stock` for a request above
 * it, and `low_stock` once a real balance change drops sellable stock to the
 * profile's reorder point.
 */
test.describe('TC-WMS-AVAIL-001: wms availability provider — in_stock / low_stock', () => {
  test('reports in_stock, out_of_stock and low_stock from real wms balances', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    const suffix = randomUUID().slice(0, 8)

    const restoreAdminAcl = await ensureRoleFeatures(request, superadminToken, scope.tenantId, 'admin', [
      'wms.view',
      'wms.manage_warehouses',
      'wms.manage_locations',
      'wms.manage_inventory',
      'wms.adjust_inventory',
      'availability.check',
    ])

    let productId: string | null = null
    let variantId: string | null = null
    let warehouseId: string | null = null
    let locationId: string | null = null
    let profileId: string | null = null

    const check = async (quantity: number): Promise<AvailabilityCheckResponse['availability']> => {
      const response = await apiRequest(request, 'POST', CHECK_API_BASE, {
        token: adminToken,
        data: { productId, variantId, quantity },
      })
      expect(response.status(), `POST ${CHECK_API_BASE} failed: ${response.status()}`).toBe(200)
      const body = await readJsonSafe<AvailabilityCheckResponse>(response)
      return body?.availability ?? null
    }

    const adjust = async (delta: number, reason: string): Promise<void> => {
      await postAction<{ movementId?: string }>(request, adminToken, '/api/wms/inventory/adjust', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        locationId,
        catalogVariantId: variantId,
        delta,
        reason,
        referenceType: 'manual',
        referenceId: randomUUID(),
        performedBy: scope.userId,
      })
    }

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `TC-WMS-AVAIL-001 Product ${suffix}`,
        sku: `TWAV001-${suffix}`,
      })

      variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `TC-WMS-AVAIL-001 Variant ${suffix}`,
        sku: `TWAV001-V-${suffix}`,
        isDefault: true,
      })

      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `TC-WMS-AVAIL-001 Warehouse ${suffix}`,
        code: `TWAV001W${suffix}`,
        timezone: 'UTC',
        isActive: true,
      })

      locationId = await createCrudFixture(request, adminToken, '/api/wms/locations', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        code: `TWAV001L${suffix}`,
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
        safetyStock: 2,
        reorderPoint: 5,
      })

      await adjust(20, 'TC-WMS-AVAIL-001 seed stock')

      const inStock = await check(1)
      expect(inStock?.state, 'sellable 18 (20 on hand - 2 safety stock) is above the reorder point').toBe('in_stock')
      expect(inStock?.availableQuantity).toBe(18)
      expect(inStock?.canFulfil).toBe(true)

      const atLimit = await check(18)
      expect(atLimit?.state, 'an exact-quantity request is still in_stock').toBe('in_stock')
      expect(atLimit?.canFulfil).toBe(true)

      const overLimit = await check(19)
      expect(overLimit?.state, 'one over sellable without a backorder policy is out_of_stock').toBe('out_of_stock')
      expect(overLimit?.canFulfil).toBe(false)

      await adjust(-14, 'TC-WMS-AVAIL-001 consume stock')

      await expect
        .poll(async () => (await check(2))?.state, {
          message: 'sellable 4 (6 on hand - 2 safety stock) is at or below reorder point 5',
          timeout: 10_000,
        })
        .toBe('low_stock')

      const lowStock = await check(2)
      expect(lowStock?.availableQuantity).toBe(4)
      expect(lowStock?.canFulfil).toBe(true)
    } finally {
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/inventory-profiles', profileId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', locationId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await restoreAdminAcl()
    }
  })
})
