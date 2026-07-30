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
} from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createCrudFixture,
  ensureRoleFeatures,
  fetchBalance,
  fetchReservations,
  postAction,
  toNumber,
} from './helpers/wmsFixtures'

export const integrationMeta = {
  dependsOnModules: ['wms', 'catalog'],
}

test.describe('TC-WMS-021: Concurrent reservation locking', () => {
  test('should allow only one competing reservation to consume the last hot-SKU stock', async ({
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
        'wms.manage_reservations',
        'wms.adjust_inventory',
      ],
    )

    let productId: string | null = null
    let warehouseId: string | null = null
    let locationId: string | null = null
    let profileId: string | null = null

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `TC-WMS-021 Hot SKU ${suffix}`,
        sku: `TCW21-${suffix}`,
      })
      const variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `TC-WMS-021 Variant ${suffix}`,
        sku: `TCW21-V-${suffix}`,
      })

      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `TC-WMS-021 Warehouse ${suffix}`,
        code: `TCW21W${suffix}`,
        city: 'Warsaw',
        country: 'PL',
        timezone: 'Europe/Warsaw',
        isActive: true,
      })

      locationId = await createCrudFixture(request, adminToken, '/api/wms/locations', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        code: `HOT-${suffix}`,
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

      await postAction<{ movementId?: string }>(request, adminToken, '/api/wms/inventory/adjust', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        locationId,
        catalogVariantId: variantId,
        delta: 5,
        reason: 'Seed hot SKU stock',
        referenceType: 'manual',
        referenceId: randomUUID(),
        performedBy: scope.userId,
      })

      const firstSourceId = randomUUID()
      const secondSourceId = randomUUID()
      const firstReferenceId = randomUUID()
      const secondReferenceId = randomUUID()

      const [firstResponse, secondResponse] = await Promise.all([
        apiRequest(request, 'POST', '/api/wms/inventory/reserve', {
          token: adminToken,
          data: {
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            warehouseId,
            catalogVariantId: variantId,
            quantity: 3,
            sourceType: 'manual',
            sourceId: firstSourceId,
            referenceType: 'manual',
            referenceId: firstReferenceId,
            performedBy: scope.userId,
          },
        }),
        apiRequest(request, 'POST', '/api/wms/inventory/reserve', {
          token: adminToken,
          data: {
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            warehouseId,
            catalogVariantId: variantId,
            quantity: 3,
            sourceType: 'manual',
            sourceId: secondSourceId,
            referenceType: 'manual',
            referenceId: secondReferenceId,
            performedBy: scope.userId,
          },
        }),
      ])

      const statuses = [firstResponse.status(), secondResponse.status()].sort((left, right) => left - right)
      expect(statuses).toEqual([200, 409])

      const failedResponse = firstResponse.status() === 409 ? firstResponse : secondResponse
      expect(await failedResponse.text()).toMatch(/insufficient_stock/i)

      const reservations = await fetchReservations(request, adminToken, {
        warehouseId,
        catalogVariantId: variantId,
      })
      const competingReservations = reservations.filter(
        (item) => item.source_id === firstSourceId || item.source_id === secondSourceId,
      )

      expect(competingReservations).toHaveLength(1)
      expect(toNumber(competingReservations[0]?.quantity)).toBe(3)
      expect(competingReservations[0]?.status).toBe('active')

      const balance = await fetchBalance(request, adminToken, warehouseId, variantId)
      expect(balance).toBeTruthy()
      expect(toNumber(balance?.quantity_on_hand)).toBe(5)
      expect(toNumber(balance?.quantity_reserved)).toBe(3)
      expect(toNumber(balance?.quantity_allocated)).toBe(0)
      expect(balance?.quantity_available).toBe(2)
    } finally {
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/inventory-profiles', profileId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', locationId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await restoreAdminAcl()
    }
  })
})
