import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
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
  createSalesOrderFixture,
  createOrderLineFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/helpers/integration/salesFixtures'
import {
  createCrudFixture,
  ensureRoleFeatures,
  postAction,
} from './helpers/wmsFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'

export const integrationMeta = {
  dependsOnModules: ['wms', 'sales', 'catalog'],
}

type SalesOrderListResponse = {
  items?: Array<
    Record<string, unknown> & {
      _wms?: {
        stockSummary?: Array<{
          catalogVariantId: string
          available: string
          reserved: string
        }>
      }
    }
  >
}

/**
 * TC-WMS-STOCK-COL-001: Order detail → Warehouse Stock column data available
 * Verifies that the `/api/sales/orders` enricher returns `_wms.stockSummary`
 * for an order line backed by a variant with WMS inventory. This data is what
 * the `WmsOrderItemStockCell` widget consumes to render the Warehouse Stock column.
 */
test.describe('TC-WMS-STOCK-COL-001: WMS stock column — order has stock summary in API response', () => {
  test('should include _wms.stockSummary for a variant line on a sales order', async ({
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
      ['wms.view', 'wms.manage_warehouses', 'wms.manage_locations', 'wms.manage_inventory', 'wms.adjust_inventory'],
    )

    let productId: string | null = null
    let variantId: string | null = null
    let warehouseId: string | null = null
    let locationId: string | null = null
    let profileId: string | null = null
    let orderId: string | null = null
    let orderLineId: string | null = null

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `TC-WMS-STOCK-COL-001 Product ${suffix}`,
        sku: `TWSC001-${suffix}`,
      })

      variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `TC-WMS-STOCK-COL-001 Variant ${suffix}`,
        sku: `TWSC001-V-${suffix}`,
        isDefault: true,
      })

      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `TC-WMS-STOCK-COL-001 Warehouse ${suffix}`,
        code: `TWSC001W${suffix}`,
        timezone: 'UTC',
        isActive: true,
      })

      locationId = await createCrudFixture(request, adminToken, '/api/wms/locations', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        code: `TWSC001L${suffix}`,
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
        delta: 15,
        reason: 'TC-WMS-STOCK-COL-001 seed stock',
        referenceType: 'manual',
        referenceId: randomUUID(),
        performedBy: scope.userId,
      })

      orderId = await createSalesOrderFixture(request, adminToken)
      orderLineId = await createOrderLineFixture(request, adminToken, orderId, {
        productId,
        productVariantId: variantId,
        quantity: 3,
      })

      const response = await apiRequest(
        request,
        'GET',
        `/api/sales/orders?id=${encodeURIComponent(orderId)}&page=1&pageSize=1`,
        { token: adminToken },
      )
      expect(response.ok(), `GET /api/sales/orders failed: ${response.status()}`).toBeTruthy()
      const body = await readJsonSafe<SalesOrderListResponse>(response)
      const order = body?.items?.[0]

      expect(order, 'Expected order in response').toBeTruthy()
      expect(order?._wms, 'Expected _wms enrichment on the order').toBeTruthy()

      const stockSummary = order?._wms?.stockSummary ?? []
      const variantStock = stockSummary.find((entry) => entry.catalogVariantId === variantId)
      expect(
        variantStock,
        `Expected stockSummary entry for variant ${variantId}`,
      ).toBeTruthy()
      expect(Number(variantStock?.available)).toBeGreaterThanOrEqual(15)
    } finally {
      if (orderLineId) {
        await deleteSalesEntityIfExists(request, adminToken, '/api/sales/order-lines', orderLineId)
      }
      await deleteSalesEntityIfExists(request, adminToken, '/api/sales/orders', orderId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/inventory-profiles', profileId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', locationId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await restoreAdminAcl()
    }
  })
})
