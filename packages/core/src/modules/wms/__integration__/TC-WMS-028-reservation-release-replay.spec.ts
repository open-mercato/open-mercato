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

test.describe('TC-WMS-028: Reservation release replay', () => {
  test('rejects a replayed release without making the released stock reservable again', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    const suffix = randomUUID().slice(0, 8)
    const restoreAdminAcl = await ensureRoleFeatures(
      request,
      superadminToken,
      scope.tenantId,
      'admin',
      ['wms.view', 'wms.manage_warehouses', 'wms.manage_locations', 'wms.manage_inventory', 'wms.manage_reservations', 'wms.adjust_inventory'],
    )

    let productId: string | null = null
    let warehouseId: string | null = null
    let locationId: string | null = null
    let profileId: string | null = null

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `TC-WMS-028 Replay ${suffix}`,
        sku: `TCW28-${suffix}`,
      })
      const variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `TC-WMS-028 Variant ${suffix}`,
        sku: `TCW28-V-${suffix}`,
      })
      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `TC-WMS-028 Warehouse ${suffix}`,
        code: `TCW28W${suffix}`,
        city: 'Warsaw',
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
        delta: 10,
        reason: 'Seed replay test stock',
        referenceType: 'manual',
        referenceId: randomUUID(),
        performedBy: scope.userId,
      })

      const firstReservation = await postAction<{ reservationId?: string }>(
        request,
        adminToken,
        '/api/wms/inventory/reserve',
        {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          warehouseId,
          catalogVariantId: variantId,
          quantity: 5,
          sourceType: 'manual',
          sourceId: randomUUID(),
        },
      )
      expect(firstReservation.reservationId).toBeTruthy()

      const secondReservation = await postAction<{ reservationId?: string }>(
        request,
        adminToken,
        '/api/wms/inventory/reserve',
        {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          warehouseId,
          catalogVariantId: variantId,
          quantity: 5,
          sourceType: 'manual',
          sourceId: randomUUID(),
        },
      )
      expect(secondReservation.reservationId).toBeTruthy()

      const releasePayload = {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        reservationId: firstReservation.reservationId,
        reason: 'TC-WMS-028 release',
      }
      await postAction(request, adminToken, '/api/wms/inventory/release', releasePayload)

      const replay = await apiRequest(request, 'POST', '/api/wms/inventory/release', {
        token: adminToken,
        data: releasePayload,
      })
      expect(replay.status()).toBe(409)
      await expect(readJsonSafe(replay)).resolves.toMatchObject({ error: 'reservation_not_active' })

      const reserveAgain = await apiRequest(request, 'POST', '/api/wms/inventory/reserve', {
        token: adminToken,
        data: {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          warehouseId,
          catalogVariantId: variantId,
          quantity: 5,
          sourceType: 'manual',
          sourceId: randomUUID(),
        },
      })
      expect(reserveAgain.status()).toBe(409)
      await expect(readJsonSafe(reserveAgain)).resolves.toMatchObject({ error: 'insufficient_stock' })
    } finally {
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/inventory-profiles', profileId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', locationId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await restoreAdminAcl()
    }
  })
})
