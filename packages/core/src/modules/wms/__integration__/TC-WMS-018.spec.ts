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
} from './helpers/wmsFixtures'

export const integrationMeta = {
  dependsOnModules: ['wms', 'catalog'],
}

type ZoneListResponse = {
  items?: Array<{
    id?: string
    warehouse_id?: string | null
    code?: string | null
  }>
}

type LocationListResponse = {
  items?: Array<{
    id?: string
    warehouse_id?: string | null
    parent_id?: string | null
    code?: string | null
    type?: string | null
  }>
}

test.describe('TC-WMS-018: Hierarchy and inventory-profile validation', () => {
  test('should persist zone and parent-child location hierarchy within one warehouse', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    const stamp = Date.now()

    const restoreAdminAcl = await ensureRoleFeatures(
      request,
      superadminToken,
      scope.tenantId,
      'admin',
      ['wms.view', 'wms.manage_warehouses', 'wms.manage_zones', 'wms.manage_locations'],
    )

    let warehouseId: string | null = null
    let secondWarehouseId: string | null = null
    let zoneId: string | null = null
    let parentLocationId: string | null = null
    let locationId: string | null = null

    try {
      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        name: `TC-WMS-018 Main ${stamp}`,
        code: `TCW18A${stamp}`,
        city: 'Gdansk',
        country: 'PL',
        timezone: 'Europe/Warsaw',
        isActive: true,
      })

      secondWarehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        name: `TC-WMS-018 Other ${stamp}`,
        code: `TCW18B${stamp}`,
        city: 'Warsaw',
        country: 'PL',
        timezone: 'Europe/Warsaw',
        isActive: true,
      })

      zoneId = await createCrudFixture(request, adminToken, '/api/wms/zones', {
        warehouseId,
        code: `ZONE-${stamp}`,
        name: 'Inbound Zone',
        priority: 10,
      })

      parentLocationId = await createCrudFixture(request, adminToken, '/api/wms/locations', {
        warehouseId,
        code: `AISLE-${stamp}`,
        type: 'aisle',
        capacityUnits: 25,
        capacityWeight: 100,
        isActive: true,
      })

      locationId = await createCrudFixture(request, adminToken, '/api/wms/locations', {
        warehouseId,
        parentId: parentLocationId,
        code: `BIN-${stamp}`,
        type: 'bin',
        capacityUnits: 25,
        capacityWeight: 100,
        isActive: true,
      })

      const zonesResponse = await apiRequest(
        request,
        'GET',
        `/api/wms/zones?warehouseId=${encodeURIComponent(warehouseId)}&page=1&pageSize=20`,
        { token: adminToken },
      )
      expect(zonesResponse.ok()).toBeTruthy()
      const zonesBody = await readJsonSafe<ZoneListResponse>(zonesResponse)
      const persistedZone =
        zonesBody?.items?.find((item) => item.id === zoneId && item.warehouse_id === warehouseId) ??
        null
      expect(persistedZone?.code).toBe(`ZONE-${stamp}`)

      const locationsResponse = await apiRequest(
        request,
        'GET',
        `/api/wms/locations?warehouseId=${encodeURIComponent(warehouseId)}&parentId=${encodeURIComponent(parentLocationId)}&page=1&pageSize=20`,
        { token: adminToken },
      )
      expect(locationsResponse.ok()).toBeTruthy()
      const locationsBody = await readJsonSafe<LocationListResponse>(locationsResponse)
      const persistedLocation =
        locationsBody?.items?.find(
          (item) =>
            item.id === locationId &&
            item.parent_id === parentLocationId &&
            item.warehouse_id === warehouseId &&
            item.type === 'bin',
        ) ?? null
      expect(persistedLocation?.code).toBe(`BIN-${stamp}`)

      const invalidParentResponse = await apiRequest(request, 'POST', '/api/wms/locations', {
        token: adminToken,
        data: {
          warehouseId: secondWarehouseId,
          parentId: parentLocationId,
          code: `BAD-${stamp}`,
          type: 'bin',
          isActive: true,
        },
      })
      expect(invalidParentResponse.status()).toBe(422)
      const invalidParentText = await invalidParentResponse.text()
      expect(invalidParentText).toMatch(/same warehouse|parent location/i)
    } finally {
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', locationId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', parentLocationId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/zones', zoneId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', secondWarehouseId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      await restoreAdminAcl()
    }
  })

  test('should reject expiration tracking profiles unless strategy is FEFO', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    const suffix = randomUUID().slice(0, 8)

    const restoreAdminAcl = await ensureRoleFeatures(
      request,
      superadminToken,
      scope.tenantId,
      'admin',
      ['wms.view', 'wms.manage_inventory'],
    )

    let productId: string | null = null
    let profileId: string | null = null

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `TC-WMS-018 Product ${suffix}`,
        sku: `TCW18-${suffix}`,
      })
      const variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `TC-WMS-018 Variant ${suffix}`,
        sku: `TCW18-V-${suffix}`,
      })

      const invalidResponse = await apiRequest(request, 'POST', '/api/wms/inventory-profiles', {
        token: adminToken,
        data: {
          catalogProductId: productId,
          catalogVariantId: variantId,
          defaultUom: 'pcs',
          trackExpiration: true,
          defaultStrategy: 'fifo',
          reorderPoint: 1,
          safetyStock: 0,
        },
      })

      expect(invalidResponse.status()).toBeGreaterThanOrEqual(400)
      expect(invalidResponse.status()).toBeLessThan(500)
      const invalidText = await invalidResponse.text()
      expect(invalidText).toMatch(/FEFO is required when expiration tracking is enabled/i)

      profileId = await createCrudFixture(request, adminToken, '/api/wms/inventory-profiles', {
        catalogProductId: productId,
        catalogVariantId: variantId,
        defaultUom: 'pcs',
        trackExpiration: true,
        defaultStrategy: 'fefo',
        reorderPoint: 2,
        safetyStock: 1,
      })

      expect(profileId).toBeTruthy()
    } finally {
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/inventory-profiles', profileId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await restoreAdminAcl()
    }
  })
})
