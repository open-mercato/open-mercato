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
const RESERVE_API_BASE = '/api/wms/inventory/reserve'

type AvailabilityCheckResponse = {
  availability?: {
    state?: string
    availableQuantity?: number | null
    canFulfil?: boolean
  } | null
}

/**
 * TC-WMS-AVAIL-002 — stock on a staging or dock location is not sellable.
 *
 * `wms.inventory.reserve` never allocates from staging/dock, so the
 * availability provider must not report that stock as fulfillable either:
 * whatever `POST /api/availability/check` reports as fulfillable, the reserve
 * call right after it must accept.
 */
test.describe('TC-WMS-AVAIL-002: wms availability provider — staging/dock stock is not sellable', () => {
  test('reports only reservable stock and reserve accepts the reported quantity', async ({ request }) => {
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
      'wms.manage_reservations',
      'availability.check',
    ])

    let productId: string | null = null
    let variantId: string | null = null
    let warehouseId: string | null = null
    let binLocationId: string | null = null
    let dockLocationId: string | null = null
    let profileId: string | null = null
    let reservationId: string | null = null

    const check = async (quantity: number): Promise<AvailabilityCheckResponse['availability']> => {
      const response = await apiRequest(request, 'POST', CHECK_API_BASE, {
        token: adminToken,
        data: { productId, variantId, quantity },
      })
      expect(response.status(), `POST ${CHECK_API_BASE} failed: ${response.status()}`).toBe(200)
      const body = await readJsonSafe<AvailabilityCheckResponse>(response)
      return body?.availability ?? null
    }

    const adjust = async (locationId: string | null, delta: number, reason: string): Promise<void> => {
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
        title: `TC-WMS-AVAIL-002 Product ${suffix}`,
        sku: `TWAV002-${suffix}`,
      })

      variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `TC-WMS-AVAIL-002 Variant ${suffix}`,
        sku: `TWAV002-V-${suffix}`,
        isDefault: true,
      })

      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `TC-WMS-AVAIL-002 Warehouse ${suffix}`,
        code: `TWAV002W${suffix}`,
        timezone: 'UTC',
        isActive: true,
      })

      binLocationId = await createCrudFixture(request, adminToken, '/api/wms/locations', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        code: `TWAV002B${suffix}`,
        type: 'bin',
        isActive: true,
      })

      dockLocationId = await createCrudFixture(request, adminToken, '/api/wms/locations', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        code: `TWAV002D${suffix}`,
        type: 'dock',
        isActive: true,
      })

      profileId = await createCrudFixture(request, adminToken, '/api/wms/inventory-profiles', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        catalogProductId: productId,
        catalogVariantId: variantId,
        defaultUom: 'pc',
        defaultStrategy: 'fifo',
        safetyStock: 0,
        reorderPoint: 0,
      })

      await adjust(binLocationId, 5, 'TC-WMS-AVAIL-002 bin stock')
      await adjust(dockLocationId, 20, 'TC-WMS-AVAIL-002 dock stock')

      const reservable = await check(5)
      expect(reservable?.availableQuantity, 'only the 5 on the bin are sellable; the 20 on the dock are not').toBe(5)
      expect(reservable?.state).toBe('in_stock')
      expect(reservable?.canFulfil).toBe(true)

      const overReservable = await check(6)
      expect(overReservable?.state, 'a request above the bin stock cannot be met from the dock').toBe('out_of_stock')
      expect(overReservable?.canFulfil).toBe(false)

      const reservePayload = (quantity: number) => ({
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        catalogVariantId: variantId,
        quantity,
        sourceType: 'order',
        sourceId: randomUUID(),
      })

      const overReserve = await apiRequest(request, 'POST', RESERVE_API_BASE, {
        token: adminToken,
        data: reservePayload(6),
      })
      expect(overReserve.status(), 'reserve refuses the quantity availability reported as out_of_stock').toBe(409)
      expect((await readJsonSafe<{ error?: string }>(overReserve))?.error).toBe('insufficient_stock')

      const reserved = await postAction<{ ok: true; reservationId: string }>(
        request,
        adminToken,
        RESERVE_API_BASE,
        reservePayload(5),
      )
      reservationId = reserved.reservationId
      expect(reservationId, 'reserve accepts the quantity availability reported as fulfillable').toBeTruthy()
    } finally {
      if (reservationId) {
        await apiRequest(request, 'POST', '/api/wms/inventory/release', {
          token: adminToken,
          data: {
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            reservationId,
            reason: 'TC-WMS-AVAIL-002 cleanup',
          },
        })
      }
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/inventory-profiles', profileId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', dockLocationId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', binLocationId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await restoreAdminAcl()
    }
  })
})
