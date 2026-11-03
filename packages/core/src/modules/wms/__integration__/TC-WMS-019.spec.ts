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
  fetchBalance,
  fetchMovements,
  fetchReservations,
  postAction,
  toNumber,
} from './helpers/wmsFixtures'

export const integrationMeta = {
  dependsOnModules: ['wms', 'catalog'],
}

test.describe('TC-WMS-019: Cycle count and reservation allocation', () => {
  test('should reconcile on-hand quantity and write a cycle-count movement', async ({ request }) => {
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
        title: `TC-WMS-019 Cycle ${suffix}`,
        sku: `TCW19-C-${suffix}`,
      })
      const variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `TC-WMS-019 Cycle Variant ${suffix}`,
        sku: `TCW19-CV-${suffix}`,
      })

      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `TC-WMS-019 Cycle Warehouse ${suffix}`,
        code: `TCW19CW${suffix}`,
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
        reason: 'Seed count baseline',
        referenceType: 'manual',
        referenceId: randomUUID(),
        performedBy: scope.userId,
      })

      const cycleReferenceId = randomUUID()
      const cycleResult = await postAction<{
        adjustmentDelta?: string | null
        movementId?: string | null
      }>(request, adminToken, '/api/wms/inventory/cycle-count', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        locationId,
        catalogVariantId: variantId,
        countedQuantity: 3,
        reason: 'Cycle count shrinkage',
        referenceId: cycleReferenceId,
        performedBy: scope.userId,
      })

      expect(cycleResult.adjustmentDelta).toBe('-2')
      expect(cycleResult.movementId).toBeTruthy()

      const balance = await fetchBalance(request, adminToken, warehouseId, variantId)
      expect(balance).toBeTruthy()
      expect(toNumber(balance?.quantity_on_hand)).toBe(3)
      expect(toNumber(balance?.quantity_reserved)).toBe(0)
      expect(toNumber(balance?.quantity_allocated)).toBe(0)
      expect(balance?.quantity_available).toBe(3)

      const movements = await fetchMovements(request, adminToken, {
        warehouseId,
        catalogVariantId: variantId,
        referenceId: cycleReferenceId,
        type: 'cycle_count',
      })
      expect(movements).toHaveLength(1)
      expect(movements[0]?.location_to_id).toBe(locationId)
      expect(toNumber(movements[0]?.quantity)).toBe(-2)
    } finally {
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/inventory-profiles', profileId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', locationId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await restoreAdminAcl()
    }
  })

  test('should allocate an existing reservation and move quantity from reserved to allocated', async ({ request }) => {
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
        title: `TC-WMS-019 Allocate ${suffix}`,
        sku: `TCW19-A-${suffix}`,
      })
      const variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `TC-WMS-019 Allocate Variant ${suffix}`,
        sku: `TCW19-AV-${suffix}`,
      })

      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `TC-WMS-019 Allocate Warehouse ${suffix}`,
        code: `TCW19AW${suffix}`,
        city: 'Poznan',
        country: 'PL',
        timezone: 'Europe/Warsaw',
        isActive: true,
      })

      locationId = await createCrudFixture(request, adminToken, '/api/wms/locations', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        code: `PICK-${suffix}`,
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
        reason: 'Seed allocatable stock',
        referenceType: 'manual',
        referenceId: randomUUID(),
        performedBy: scope.userId,
      })

      const orderId = randomUUID()
      const reserveResult = await postAction<{ reservationId?: string | null }>(
        request,
        adminToken,
        '/api/wms/inventory/reserve',
        {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          warehouseId,
          catalogVariantId: variantId,
          quantity: 3,
          sourceType: 'order',
          sourceId: orderId,
          reason: 'Reserve for allocation test',
          referenceType: 'manual',
          referenceId: randomUUID(),
          performedBy: scope.userId,
        },
      )

      const reservationId = reserveResult.reservationId ?? null
      expect(reservationId).toBeTruthy()

      const allocateResult = await postAction<{
        ok?: boolean
        allocationState?: 'allocated'
      }>(request, adminToken, '/api/wms/inventory/allocate', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        reservationId,
      })

      expect(allocateResult.ok).toBe(true)
      expect(allocateResult.allocationState).toBe('allocated')

      const reservations = await fetchReservations(request, adminToken, {
        warehouseId,
        catalogVariantId: variantId,
        sourceType: 'order',
        sourceId: orderId,
      })
      expect(reservations).toHaveLength(1)
      expect(reservations[0]?.status).toBe('active')

      const balance = await fetchBalance(request, adminToken, warehouseId, variantId)
      expect(balance).toBeTruthy()
      expect(toNumber(balance?.quantity_on_hand)).toBe(5)
      expect(toNumber(balance?.quantity_reserved)).toBe(0)
      expect(toNumber(balance?.quantity_allocated)).toBe(3)
      expect(balance?.quantity_available).toBe(2)
    } finally {
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/inventory-profiles', profileId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', locationId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await restoreAdminAcl()
    }
  })

  test('should reject allocation after a reservation is released without changing balances', async ({ request }) => {
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
        title: `TC-WMS-019 Released ${suffix}`,
        sku: `TCW19-R-${suffix}`,
      })
      const variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `TC-WMS-019 Released Variant ${suffix}`,
        sku: `TCW19-RV-${suffix}`,
      })

      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `TC-WMS-019 Released Warehouse ${suffix}`,
        code: `TCW19RW${suffix}`,
        city: 'Wroclaw',
        country: 'PL',
        timezone: 'Europe/Warsaw',
        isActive: true,
      })

      locationId = await createCrudFixture(request, adminToken, '/api/wms/locations', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        code: `RELEASE-${suffix}`,
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
        reason: 'Seed releasable stock',
        referenceType: 'manual',
        referenceId: randomUUID(),
        performedBy: scope.userId,
      })

      const reserveResult = await postAction<{ reservationId?: string | null }>(
        request,
        adminToken,
        '/api/wms/inventory/reserve',
        {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          warehouseId,
          catalogVariantId: variantId,
          quantity: 3,
          sourceType: 'order',
          sourceId: randomUUID(),
          reason: 'Reserve for released allocation test',
          referenceType: 'manual',
          referenceId: randomUUID(),
          performedBy: scope.userId,
        },
      )

      const reservationId = reserveResult.reservationId ?? null
      expect(reservationId).toBeTruthy()

      await postAction<{ ok?: boolean }>(request, adminToken, '/api/wms/inventory/release', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        reservationId,
        reason: 'Release before allocation rejection test',
        performedBy: scope.userId,
      })

      const balanceBeforeRejectedAllocation = await fetchBalance(request, adminToken, warehouseId, variantId)
      expect(balanceBeforeRejectedAllocation).toBeTruthy()

      const rejectedAllocationResponse = await apiRequest(
        request,
        'POST',
        '/api/wms/inventory/allocate',
        {
          token: adminToken,
          data: {
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            reservationId,
            performedBy: scope.userId,
          },
        },
      )
      expect(rejectedAllocationResponse.status()).toBe(409)
      await expect(readJsonSafe<{ error?: string }>(rejectedAllocationResponse)).resolves.toEqual({
        error: 'invalid_reservation_state',
      })

      const balanceAfterRejectedAllocation = await fetchBalance(request, adminToken, warehouseId, variantId)
      expect(toNumber(balanceAfterRejectedAllocation?.quantity_reserved)).toBe(
        toNumber(balanceBeforeRejectedAllocation?.quantity_reserved),
      )
      expect(toNumber(balanceAfterRejectedAllocation?.quantity_allocated)).toBe(
        toNumber(balanceBeforeRejectedAllocation?.quantity_allocated),
      )
    } finally {
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/inventory-profiles', profileId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', locationId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await restoreAdminAcl()
    }
  })
})
