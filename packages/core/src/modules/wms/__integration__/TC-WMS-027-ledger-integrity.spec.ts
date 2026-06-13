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
  fetchMovements,
  postAction,
  toNumber,
} from './helpers/wmsFixtures'

export const integrationMeta = {
  dependsOnModules: ['wms', 'catalog'],
}

test.describe('TC-WMS-027: Ledger integrity', () => {
  test('should not double-apply stock when the same adjust payload is retried', async ({ request }) => {
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
    let profileId: string | null = null

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `TC-WMS-027 Idempotent ${suffix}`,
        sku: `TCW27-${suffix}`,
      })
      const variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `TC-WMS-027 Variant ${suffix}`,
        sku: `TCW27-V-${suffix}`,
      })

      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `TC-WMS-027 Warehouse ${suffix}`,
        code: `TCW27W${suffix}`,
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

      const referenceId = randomUUID()
      const adjustPayload = {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        locationId,
        catalogVariantId: variantId,
        delta: 7,
        reason: 'Idempotent adjust retry',
        referenceType: 'manual' as const,
        referenceId,
        performedBy: scope.userId,
      }

      const first = await postAction<{ movementId?: string }>(
        request,
        adminToken,
        '/api/wms/inventory/adjust',
        adjustPayload,
      )
      const second = await postAction<{ movementId?: string }>(
        request,
        adminToken,
        '/api/wms/inventory/adjust',
        adjustPayload,
      )

      expect(first.movementId).toBeTruthy()
      expect(second.movementId).toBe(first.movementId)

      const balance = await fetchBalance(request, adminToken, warehouseId, variantId)
      expect(toNumber(balance?.quantity_on_hand)).toBe(7)

      const movements = await fetchMovements(request, adminToken, {
        warehouseId,
        catalogVariantId: variantId,
        referenceId,
        type: 'adjust',
      })
      expect(movements).toHaveLength(1)
    } finally {
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/inventory-profiles', profileId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', locationId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await restoreAdminAcl()
    }
  })

  test('should reject reservation from hold lots and allow available lots', async ({ request }) => {
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
    let holdLocationId: string | null = null
    let availableLocationId: string | null = null
    let profileId: string | null = null
    let holdLotId: string | null = null
    let availableLotId: string | null = null

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `TC-WMS-027 Lots ${suffix}`,
        sku: `TCW27L-${suffix}`,
      })
      const variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `TC-WMS-027 Lot Variant ${suffix}`,
        sku: `TCW27-LV-${suffix}`,
      })

      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `TC-WMS-027 Lot Warehouse ${suffix}`,
        code: `TCW27LW${suffix}`,
        city: 'Krakow',
        country: 'PL',
        timezone: 'Europe/Warsaw',
        isActive: true,
      })

      holdLocationId = await createCrudFixture(request, adminToken, '/api/wms/locations', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        code: `HOLD-${suffix}`,
        type: 'bin',
        isActive: true,
      })
      availableLocationId = await createCrudFixture(request, adminToken, '/api/wms/locations', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        code: `OK-${suffix}`,
        type: 'bin',
        isActive: true,
      })

      profileId = await createCrudFixture(request, adminToken, '/api/wms/inventory-profiles', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        catalogProductId: productId,
        catalogVariantId: variantId,
        defaultUom: 'pcs',
        defaultStrategy: 'fefo',
        trackLot: true,
        trackExpiration: true,
      })

      holdLotId = await createCrudFixture(request, adminToken, '/api/wms/lots', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        catalogVariantId: variantId,
        sku: `TCW27-LV-${suffix}`,
        lotNumber: `HOLD-${suffix}`,
        status: 'hold',
      })
      availableLotId = await createCrudFixture(request, adminToken, '/api/wms/lots', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        catalogVariantId: variantId,
        sku: `TCW27-LV-${suffix}`,
        lotNumber: `OK-${suffix}`,
        status: 'available',
        expiresAt: new Date('2030-01-01T00:00:00.000Z').toISOString(),
      })

      await postAction(request, adminToken, '/api/wms/inventory/adjust', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        locationId: holdLocationId,
        catalogVariantId: variantId,
        lotId: holdLotId,
        delta: 10,
        reason: 'Seed hold lot',
        referenceType: 'manual',
        referenceId: randomUUID(),
        performedBy: scope.userId,
      })
      await postAction(request, adminToken, '/api/wms/inventory/adjust', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        locationId: availableLocationId,
        catalogVariantId: variantId,
        lotId: availableLotId,
        delta: 4,
        reason: 'Seed available lot',
        referenceType: 'manual',
        referenceId: randomUUID(),
        performedBy: scope.userId,
      })

      const holdOnlyVariant = await createVariantFixture(request, adminToken, {
        productId,
        name: `TC-WMS-027 Hold Only ${suffix}`,
        sku: `TCW27-HO-${suffix}`,
      })
      const holdOnlyLotId = await createCrudFixture(request, adminToken, '/api/wms/lots', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        catalogVariantId: holdOnlyVariant,
        sku: `TCW27-HO-${suffix}`,
        lotNumber: `HOLD-ONLY-${suffix}`,
        status: 'hold',
      })
      await postAction(request, adminToken, '/api/wms/inventory/adjust', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        locationId: holdLocationId,
        catalogVariantId: holdOnlyVariant,
        lotId: holdOnlyLotId,
        delta: 6,
        reason: 'Seed hold-only variant',
        referenceType: 'manual',
        referenceId: randomUUID(),
        performedBy: scope.userId,
      })

      const holdOnlyResponse = await apiRequest(request, 'POST', '/api/wms/inventory/reserve', {
        token: adminToken,
        data: {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          warehouseId,
          catalogVariantId: holdOnlyVariant,
          quantity: 1,
          sourceType: 'manual',
          sourceId: randomUUID(),
        },
      })
      expect(holdOnlyResponse.status()).toBe(409)

      const reserveResult = await postAction<{
        reservationId?: string
        allocatedBuckets: Array<{ locationId: string; lotId: string | null; quantity: string }>
      }>(
        request,
        adminToken,
        '/api/wms/inventory/reserve',
        {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          warehouseId,
          catalogVariantId: variantId,
          quantity: 2,
          sourceType: 'manual',
          sourceId: randomUUID(),
          strategy: 'fefo',
        },
      )
      expect(reserveResult.reservationId).toBeTruthy()
      expect(reserveResult.allocatedBuckets.length).toBeGreaterThan(0)
      expect(reserveResult.allocatedBuckets.some((bucket) => bucket.lotId === availableLotId)).toBe(true)
      expect(reserveResult.allocatedBuckets.every((bucket) => bucket.lotId !== holdLotId)).toBe(true)
      expect(reserveResult.allocatedBuckets.every((bucket) => bucket.locationId === availableLocationId)).toBe(true)
    } finally {
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/lots', availableLotId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/lots', holdLotId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/inventory-profiles', profileId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', availableLocationId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', holdLocationId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await restoreAdminAcl()
    }
  })

  test('should filter movements by locationId on the server', async ({ request }) => {
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
    let locationAId: string | null = null
    let locationBId: string | null = null
    let profileId: string | null = null

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `TC-WMS-027 Location Filter ${suffix}`,
        sku: `TCW27LF-${suffix}`,
      })
      const variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `TC-WMS-027 Location Variant ${suffix}`,
        sku: `TCW27-LFV-${suffix}`,
      })

      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `TC-WMS-027 Filter Warehouse ${suffix}`,
        code: `TCW27FW${suffix}`,
        city: 'Gdansk',
        country: 'PL',
        timezone: 'Europe/Warsaw',
        isActive: true,
      })

      locationAId = await createCrudFixture(request, adminToken, '/api/wms/locations', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        code: `A-${suffix}`,
        type: 'bin',
        isActive: true,
      })
      locationBId = await createCrudFixture(request, adminToken, '/api/wms/locations', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        code: `B-${suffix}`,
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
        locationId: locationAId,
        catalogVariantId: variantId,
        delta: 5,
        reason: 'Seed location A',
        referenceType: 'manual',
        referenceId: randomUUID(),
        performedBy: scope.userId,
      })
      await postAction(request, adminToken, '/api/wms/inventory/adjust', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        locationId: locationBId,
        catalogVariantId: variantId,
        delta: 3,
        reason: 'Seed location B',
        referenceType: 'manual',
        referenceId: randomUUID(),
        performedBy: scope.userId,
      })

      const locationMovements = await fetchMovements(request, adminToken, {
        warehouseId,
        locationId: locationAId,
        catalogVariantId: variantId,
      })
      expect(locationMovements.length).toBeGreaterThan(0)
      expect(
        locationMovements.every(
          (movement) =>
            movement.location_from_id === locationAId || movement.location_to_id === locationAId,
        ),
      ).toBe(true)
      expect(locationMovements.some((movement) => movement.location_to_id === locationBId)).toBe(false)
    } finally {
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/inventory-profiles', profileId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', locationBId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', locationAId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await restoreAdminAcl()
    }
  })
})
