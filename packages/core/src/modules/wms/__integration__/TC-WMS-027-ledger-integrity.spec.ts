import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createProductFixture,
  createVariantFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures'
import {
  deleteGeneralEntityIfExists,
  expectId,
  getTokenScope,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  dismissNotificationsByType,
  listNotifications,
} from '@open-mercato/core/helpers/integration/notificationsFixtures'
import {
  createOrderLineFixture,
  createSalesOrderFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/helpers/integration/salesFixtures'
import {
  createCrudFixture,
  ensureBooleanFeatureToggle,
  ensureRoleFeatures,
  fetchBalance,
  fetchMovements,
  fetchReservations,
  postAction,
  toNumber,
} from './helpers/wmsFixtures'

export const integrationMeta = {
  dependsOnModules: ['wms', 'catalog', 'sales'],
}

type SalesStatusListResponse = {
  items?: Array<{
    id?: string
    value?: string | null
  }>
}

async function fetchOrderStatusId(
  request: APIRequestContext,
  token: string,
  value: 'confirmed' | 'canceled',
): Promise<string> {
  const response = await apiRequest(
    request,
    'GET',
    '/api/sales/order-statuses?page=1&pageSize=100',
    { token },
  )
  expect(response.ok(), `Failed GET /api/sales/order-statuses: ${response.status()}`).toBeTruthy()
  const body = await readJsonSafe<SalesStatusListResponse>(response)
  const status = body?.items?.find((item) => item.value === value) ?? null
  return expectId(status?.id, `Missing order status "${value}"`)
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

  test('should restore availability after reserve allocate and release round-trip', async ({ request }) => {
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
    let reservationId: string | null = null

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `TC-WMS-027 Round Trip ${suffix}`,
        sku: `TCW27RT-${suffix}`,
      })
      const variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `TC-WMS-027 Round Trip Variant ${suffix}`,
        sku: `TCW27-RTV-${suffix}`,
      })

      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `TC-WMS-027 Round Trip Warehouse ${suffix}`,
        code: `TCW27RTW${suffix}`,
        city: 'Warsaw',
        country: 'PL',
        timezone: 'Europe/Warsaw',
        isActive: true,
      })

      locationId = await createCrudFixture(request, adminToken, '/api/wms/locations', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        code: `RT-${suffix}`,
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
        delta: 8,
        reason: 'Seed round-trip stock',
        referenceType: 'manual',
        referenceId: randomUUID(),
        performedBy: scope.userId,
      })

      const balanceBefore = await fetchBalance(request, adminToken, warehouseId, variantId)
      expect(balanceBefore).toBeTruthy()
      expect(toNumber(balanceBefore!.quantity_on_hand)).toBe(8)
      expect(toNumber(balanceBefore!.quantity_reserved)).toBe(0)
      expect(toNumber(balanceBefore!.quantity_allocated)).toBe(0)
      expect(balanceBefore!.quantity_available).toBe(8)

      const sourceId = randomUUID()
      const reserveResult = await postAction<{ reservationId?: string }>(
        request,
        adminToken,
        '/api/wms/inventory/reserve',
        {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          warehouseId,
          catalogVariantId: variantId,
          quantity: 3,
          sourceType: 'manual',
          sourceId,
        },
      )
      reservationId = reserveResult.reservationId ?? null
      expect(reservationId).toBeTruthy()

      const balanceAfterReserve = await fetchBalance(request, adminToken, warehouseId, variantId)
      expect(balanceAfterReserve).toBeTruthy()
      expect(toNumber(balanceAfterReserve!.quantity_on_hand)).toBe(8)
      expect(toNumber(balanceAfterReserve!.quantity_reserved)).toBe(3)
      expect(toNumber(balanceAfterReserve!.quantity_allocated)).toBe(0)
      expect(balanceAfterReserve!.quantity_available).toBe(5)

      const allocateResult = await postAction<{ ok?: boolean; allocationState?: 'allocated' }>(
        request,
        adminToken,
        '/api/wms/inventory/allocate',
        {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          reservationId,
        },
      )
      expect(allocateResult.ok).toBe(true)
      expect(allocateResult.allocationState).toBe('allocated')

      const balanceAfterAllocate = await fetchBalance(request, adminToken, warehouseId, variantId)
      expect(balanceAfterAllocate).toBeTruthy()
      expect(toNumber(balanceAfterAllocate!.quantity_on_hand)).toBe(8)
      expect(toNumber(balanceAfterAllocate!.quantity_reserved)).toBe(0)
      expect(toNumber(balanceAfterAllocate!.quantity_allocated)).toBe(3)
      expect(balanceAfterAllocate!.quantity_available).toBe(5)

      await postAction(request, adminToken, '/api/wms/inventory/release', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        reservationId,
        reason: 'Round-trip release',
      })

      const reservations = await fetchReservations(request, adminToken, {
        warehouseId,
        catalogVariantId: variantId,
        sourceType: 'manual',
        sourceId,
      })
      expect(reservations).toHaveLength(1)
      expect(reservations[0]?.status).toBe('released')

      const balanceAfterRelease = await fetchBalance(request, adminToken, warehouseId, variantId)
      expect(balanceAfterRelease).toBeTruthy()
      expect(toNumber(balanceAfterRelease!.quantity_on_hand)).toBe(8)
      expect(toNumber(balanceAfterRelease!.quantity_reserved)).toBe(0)
      expect(toNumber(balanceAfterRelease!.quantity_allocated)).toBe(0)
      expect(balanceAfterRelease!.quantity_available).toBe(8)
    } finally {
      if (reservationId) {
        await apiRequest(request, 'POST', '/api/wms/inventory/release', {
          token: adminToken,
          data: {
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            reservationId,
            reason: 'TC-WMS-027 round-trip cleanup',
          },
        }).catch(() => undefined)
      }
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/inventory-profiles', profileId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', locationId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await restoreAdminAcl()
    }
  })

  test('should allow only one concurrent reservation to consume the last hot-SKU stock', async ({
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
        title: `TC-WMS-027 Hot SKU ${suffix}`,
        sku: `TCW27H-${suffix}`,
      })
      const variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `TC-WMS-027 Hot SKU Variant ${suffix}`,
        sku: `TCW27-HV-${suffix}`,
      })

      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `TC-WMS-027 Hot Warehouse ${suffix}`,
        code: `TCW27HW${suffix}`,
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
        delta: 5,
        reason: 'Seed hot SKU stock',
        referenceType: 'manual',
        referenceId: randomUUID(),
        performedBy: scope.userId,
      })

      const firstSourceId = randomUUID()
      const secondSourceId = randomUUID()

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

  test('should partially auto-reserve a multi-line order and emit a reservation shortfall notification', async ({
    request,
  }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    const suffix = randomUUID().slice(0, 8)

    const restoreSalesOrderToggle = await ensureBooleanFeatureToggle(
      request,
      superadminToken,
      'wms_integration_sales_order_inventory',
      'Sales Order Inventory Reservation',
      'Allows WMS to reserve and release inventory from sales order lifecycle events.',
      'wms',
    )
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
    let stockedProfileId: string | null = null
    let shortfallProfileId: string | null = null
    let orderId: string | null = null

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `TC-WMS-027 Shortfall ${suffix}`,
        sku: `TCW27SF-${suffix}`,
      })
      const stockedVariantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `TC-WMS-027 Stocked Variant ${suffix}`,
        sku: `TCW27-SV-${suffix}`,
        isDefault: true,
      })
      const shortfallVariantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `TC-WMS-027 Shortfall Variant ${suffix}`,
        sku: `TCW27-SFV-${suffix}`,
      })

      orderId = await createSalesOrderFixture(request, adminToken)
      await createOrderLineFixture(request, adminToken, orderId, {
        productId,
        productVariantId: stockedVariantId,
        quantity: 3,
        name: `TC-WMS-027 stocked line ${suffix}`,
      })
      await createOrderLineFixture(request, adminToken, orderId, {
        productId,
        productVariantId: shortfallVariantId,
        quantity: 4,
        name: `TC-WMS-027 shortfall line ${suffix}`,
      })

      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `TC-WMS-027 Shortfall Warehouse ${suffix}`,
        code: `TCW27SFW${suffix}`,
        city: 'Warsaw',
        country: 'PL',
        timezone: 'Europe/Warsaw',
        isActive: true,
      })

      locationId = await createCrudFixture(request, adminToken, '/api/wms/locations', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        code: `SF-${suffix}`,
        type: 'bin',
        isActive: true,
      })

      stockedProfileId = await createCrudFixture(request, adminToken, '/api/wms/inventory-profiles', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        catalogProductId: productId,
        catalogVariantId: stockedVariantId,
        defaultUom: 'pcs',
        defaultStrategy: 'fifo',
      })
      shortfallProfileId = await createCrudFixture(request, adminToken, '/api/wms/inventory-profiles', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        catalogProductId: productId,
        catalogVariantId: shortfallVariantId,
        defaultUom: 'pcs',
        defaultStrategy: 'fifo',
      })

      await postAction(request, adminToken, '/api/wms/inventory/adjust', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        locationId,
        catalogVariantId: stockedVariantId,
        delta: 5,
        reason: 'Seed stocked variant only',
        referenceType: 'manual',
        referenceId: randomUUID(),
        performedBy: scope.userId,
      })

      const confirmedStatusId = await fetchOrderStatusId(request, superadminToken, 'confirmed')
      const confirmResponse = await apiRequest(request, 'PUT', '/api/sales/orders', {
        token: adminToken,
        data: {
          id: orderId,
          statusEntryId: confirmedStatusId,
        },
      })
      expect(confirmResponse.ok(), `Failed PUT /api/sales/orders confirm: ${confirmResponse.status()}`).toBeTruthy()

      await expect.poll(async () => {
        const reservations = await fetchReservations(request, adminToken, {
          sourceType: 'order',
          sourceId: orderId!,
          status: 'active',
        })
        const stockedReservation = reservations.find(
          (item) => item.catalog_variant_id === stockedVariantId,
        )
        const shortfallReservation = reservations.find(
          (item) => item.catalog_variant_id === shortfallVariantId,
        )
        const notifications = await listNotifications(request, adminToken, {
          type: 'wms.inventory.reservation_shortfall',
          pageSize: 50,
        })
        const shortfallNotification = notifications.items.find(
          (item) =>
            item.source_entity_id === orderId ||
            item.sourceEntityId === orderId,
        )

        return {
          stockedQuantity: toNumber(stockedReservation?.quantity),
          shortfallReservationCount: shortfallReservation ? 1 : 0,
          hasShortfallNotification: Boolean(shortfallNotification),
        }
      }, {
        timeout: 10_000,
        intervals: [250, 500, 1_000],
      }).toEqual({
        stockedQuantity: 3,
        shortfallReservationCount: 0,
        hasShortfallNotification: true,
      })

      const stockedBalance = await fetchBalance(request, adminToken, warehouseId, stockedVariantId)
      expect(toNumber(stockedBalance?.quantity_reserved)).toBe(3)
      expect(stockedBalance?.quantity_available).toBe(2)

      const shortfallBalance = await fetchBalance(request, adminToken, warehouseId, shortfallVariantId)
      expect(toNumber(shortfallBalance?.quantity_reserved)).toBe(0)
      expect(shortfallBalance?.quantity_available ?? 0).toBe(0)
    } finally {
      if (orderId) {
        const reservations = await fetchReservations(request, adminToken, {
          sourceType: 'order',
          sourceId: orderId,
        }).catch(() => [])
        for (const reservation of reservations) {
          if (reservation.id && reservation.status === 'active') {
            await apiRequest(request, 'POST', '/api/wms/inventory/release', {
              token: adminToken,
              data: {
                organizationId: scope.organizationId,
                tenantId: scope.tenantId,
                reservationId: reservation.id,
                reason: 'TC-WMS-027 shortfall cleanup',
              },
            }).catch(() => undefined)
          }
        }
        await deleteSalesEntityIfExists(request, adminToken, '/api/sales/orders', orderId)
      }
      await dismissNotificationsByType(request, adminToken, 'wms.inventory.reservation_shortfall')
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/inventory-profiles', shortfallProfileId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/inventory-profiles', stockedProfileId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', locationId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await restoreAdminAcl()
      await restoreSalesOrderToggle()
    }
  })
})
