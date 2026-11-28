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

type OperationalDashboardResponse = {
  kpis?: Array<{ id?: string; count?: number }>
}

const STOCKLESS_LOT_COUNT = 100
const CREATE_BATCH_SIZE = 10

test.describe('TC-WMS-DASHBOARD-002 expiring-soon KPI counts past the lot fetch limit', () => {
  test.setTimeout(180_000)

  test('counts a stocked expiring lot even when 100 earlier-expiring lots have no stock', async ({ request }) => {
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
    let variantId: string | null = null
    let stockedLotId: string | null = null
    let stockAdjusted = false
    const stocklessLotIds: string[] = []

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `TC-WMS-DASHBOARD-002 ${suffix}`,
        sku: `TCD2-P-${suffix}`,
      })
      variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `TC-WMS-DASHBOARD-002 Variant ${suffix}`,
        sku: `TCD2-V-${suffix}`,
      })

      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `TC-WMS-DASHBOARD-002 Warehouse ${suffix}`,
        code: `TCD2W${suffix}`,
        city: 'Lodz',
        country: 'PL',
        timezone: 'Europe/Warsaw',
        isActive: true,
      })

      locationId = await createCrudFixture(request, adminToken, '/api/wms/locations', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        code: `BIN-${suffix}`,
        type: 'bin',
        capacityUnits: 100,
        capacityWeight: 500,
        isActive: true,
      })

      const soon = Date.now() + 30 * 60 * 1000
      for (let start = 0; start < STOCKLESS_LOT_COUNT; start += CREATE_BATCH_SIZE) {
        const batch = Array.from(
          { length: Math.min(CREATE_BATCH_SIZE, STOCKLESS_LOT_COUNT - start) },
          (_, offset) => start + offset,
        )
        await Promise.all(
          batch.map(async (index) => {
            const lotId = await createCrudFixture(request, adminToken, '/api/wms/lots', {
              organizationId: scope.organizationId,
              tenantId: scope.tenantId,
              catalogVariantId: variantId,
              sku: `TCD2-V-${suffix}`,
              lotNumber: `EMPTY-${suffix}-${index}`,
              status: 'available',
              expiresAt: new Date(soon + index * 1000).toISOString(),
            })
            stocklessLotIds.push(lotId)
          }),
        )
      }

      const stockedExpiresAt = new Date()
      stockedExpiresAt.setUTCDate(stockedExpiresAt.getUTCDate() + 3)
      stockedLotId = await createCrudFixture(request, adminToken, '/api/wms/lots', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        catalogVariantId: variantId,
        sku: `TCD2-V-${suffix}`,
        lotNumber: `STOCKED-${suffix}`,
        status: 'available',
        expiresAt: stockedExpiresAt.toISOString(),
      })

      await postAction(request, adminToken, '/api/wms/inventory/adjust', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        locationId,
        catalogVariantId: variantId,
        lotId: stockedLotId,
        delta: 2,
        reason: 'Opening balance',
        referenceType: 'manual',
        referenceId: randomUUID(),
        performedBy: scope.userId,
      })
      stockAdjusted = true

      const dashboardResponse = await apiRequest(
        request,
        'GET',
        `/api/wms/dashboard/operational?warehouseId=${encodeURIComponent(warehouseId)}`,
        { token: adminToken },
      )
      expect(dashboardResponse.ok(), `Expected 200, got ${dashboardResponse.status()}`).toBeTruthy()
      const dashboardBody = await readJsonSafe<OperationalDashboardResponse>(dashboardResponse)
      const expiringSoon = dashboardBody?.kpis?.find((kpi) => kpi.id === 'expiringSoon')
      expect(expiringSoon?.count).toBe(1)
    } finally {
      if (stockAdjusted && warehouseId && locationId && variantId && stockedLotId) {
        await apiRequest(request, 'POST', '/api/wms/inventory/adjust', {
          token: adminToken,
          data: {
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            warehouseId,
            locationId,
            catalogVariantId: variantId,
            lotId: stockedLotId,
            delta: -2,
            reason: 'Test cleanup',
            referenceType: 'manual',
            referenceId: randomUUID(),
            performedBy: scope.userId,
          },
        })
      }
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/lots', stockedLotId)
      for (let start = 0; start < stocklessLotIds.length; start += CREATE_BATCH_SIZE) {
        await Promise.all(
          stocklessLotIds
            .slice(start, start + CREATE_BATCH_SIZE)
            .map((lotId) => deleteGeneralEntityIfExists(request, adminToken, '/api/wms/lots', lotId)),
        )
      }
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', locationId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await restoreAdminAcl()
    }
  })
})
