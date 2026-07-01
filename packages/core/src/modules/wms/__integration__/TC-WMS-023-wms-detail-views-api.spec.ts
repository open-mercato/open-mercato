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
  fetchBalancesAtLocation,
  fetchMovements,
  movementInvolvesLocation,
  postAction,
  setRoleFeaturesExact,
  toNumber,
} from './helpers/wmsFixtures'

export const integrationMeta = {
  dependsOnModules: ['wms', 'catalog'],
}

test.describe('TC-WMS-023: WMS detail views — API contracts', () => {
  test('filters inventory movements by lotId', async ({ request }) => {
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
    let lotAId: string | null = null
    let lotBId: string | null = null
    let profileId: string | null = null

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `TC-WMS-023 LotFilter ${suffix}`,
        sku: `TCW23-LF-${suffix}`,
      })
      const variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `TC-WMS-023 LotFilter Variant ${suffix}`,
        sku: `TCW23-LFV-${suffix}`,
      })

      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `TC-WMS-023 Warehouse ${suffix}`,
        code: `TCW23W${suffix}`,
        city: 'Poznan',
        country: 'PL',
        timezone: 'Europe/Warsaw',
        isActive: true,
      })

      locationId = await createCrudFixture(request, adminToken, '/api/wms/locations', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        code: `LF-${suffix}`,
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

      lotAId = await createCrudFixture(request, adminToken, '/api/wms/lots', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        catalogVariantId: variantId,
        sku: `TCW23-LFV-${suffix}`,
        lotNumber: `LOT-A-${suffix}`,
        status: 'available',
      })

      lotBId = await createCrudFixture(request, adminToken, '/api/wms/lots', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        catalogVariantId: variantId,
        sku: `TCW23-LFV-${suffix}`,
        lotNumber: `LOT-B-${suffix}`,
        status: 'available',
      })

      const referenceA = randomUUID()
      const referenceB = randomUUID()

      await postAction(request, adminToken, '/api/wms/inventory/adjust', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        locationId,
        catalogVariantId: variantId,
        lotId: lotAId,
        delta: 3,
        reason: 'Lot A seed',
        referenceType: 'manual',
        referenceId: referenceA,
        performedBy: scope.userId,
      })

      await postAction(request, adminToken, '/api/wms/inventory/adjust', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        locationId,
        catalogVariantId: variantId,
        lotId: lotBId,
        delta: 7,
        reason: 'Lot B seed',
        referenceType: 'manual',
        referenceId: referenceB,
        performedBy: scope.userId,
      })

      const lotAMovements = await fetchMovements(request, adminToken, {
        warehouseId,
        catalogVariantId: variantId,
        lotId: lotAId,
      })
      expect(lotAMovements.length).toBeGreaterThan(0)
      expect(lotAMovements.every((row) => row.lot_id === lotAId)).toBeTruthy()
      expect(lotAMovements.some((row) => row.reference_id === referenceA)).toBeTruthy()
      expect(lotAMovements.some((row) => row.reference_id === referenceB)).toBeFalsy()

      const lotBMovements = await fetchMovements(request, adminToken, {
        warehouseId,
        catalogVariantId: variantId,
        lotId: lotBId,
      })
      expect(lotBMovements.every((row) => row.lot_id === lotBId)).toBeTruthy()
      expect(lotBMovements.some((row) => row.reference_id === referenceB)).toBeTruthy()
    } finally {
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/lots', lotBId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/lots', lotAId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/inventory-profiles', profileId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', locationId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await restoreAdminAcl()
    }
  })

  test('returns balances and location-scoped movements for a location', async ({ request }) => {
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
        title: `TC-WMS-023 Location ${suffix}`,
        sku: `TCW23-LOC-${suffix}`,
      })
      const variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `TC-WMS-023 Location Variant ${suffix}`,
        sku: `TCW23-LOCV-${suffix}`,
      })

      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `TC-WMS-023 Loc Warehouse ${suffix}`,
        code: `TCW23LW${suffix}`,
        city: 'Wroclaw',
        country: 'PL',
        timezone: 'Europe/Warsaw',
        isActive: true,
      })

      locationAId = await createCrudFixture(request, adminToken, '/api/wms/locations', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        code: `LOC-A-${suffix}`,
        type: 'bin',
        capacityUnits: 100,
        capacityWeight: 500,
        isActive: true,
      })

      locationBId = await createCrudFixture(request, adminToken, '/api/wms/locations', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        code: `LOC-B-${suffix}`,
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

      const referenceAtA = randomUUID()
      await postAction(request, adminToken, '/api/wms/inventory/adjust', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        locationId: locationAId,
        catalogVariantId: variantId,
        delta: 6,
        reason: 'Location A stock',
        referenceType: 'manual',
        referenceId: referenceAtA,
        performedBy: scope.userId,
      })

      await postAction(request, adminToken, '/api/wms/inventory/adjust', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        locationId: locationBId,
        catalogVariantId: variantId,
        delta: 2,
        reason: 'Location B stock',
        referenceType: 'manual',
        referenceId: randomUUID(),
        performedBy: scope.userId,
      })

      const balancesAtA = await fetchBalancesAtLocation(request, adminToken, locationAId)
      expect(balancesAtA.length).toBeGreaterThan(0)
      expect(balancesAtA.every((row) => row.location_id === locationAId)).toBeTruthy()
      expect(toNumber(balancesAtA[0]?.quantity_on_hand)).toBe(6)

      const allMovements = await fetchMovements(request, adminToken, { warehouseId })
      const scopedToA = allMovements.filter((row) => movementInvolvesLocation(row, locationAId!))
      expect(scopedToA.length).toBeGreaterThan(0)
      expect(scopedToA.some((row) => row.reference_id === referenceAtA)).toBeTruthy()
      expect(
        scopedToA.every(
          (row) =>
            row.location_from_id === locationAId || row.location_to_id === locationAId,
        ),
      ).toBeTruthy()
    } finally {
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/inventory-profiles', profileId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', locationBId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', locationAId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await restoreAdminAcl()
    }
  })

  test('denies lot creation without manage_inventory and allows it with both features', async ({
    request,
  }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    const suffix = randomUUID().slice(0, 8)

    const adjustOnlyFeatures = [
      'wms.view',
      'wms.manage_warehouses',
      'wms.manage_locations',
      'wms.adjust_inventory',
    ]
    const restoreEmployeeAcl = await setRoleFeaturesExact(
      request,
      superadminToken,
      scope.tenantId,
      'employee',
      adjustOnlyFeatures,
    )

    let productId: string | null = null
    let createdLotId: string | null = null

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `TC-WMS-023 Lot ACL ${suffix}`,
        sku: `TCW23-ACL-${suffix}`,
      })
      const variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `TC-WMS-023 Lot ACL Variant ${suffix}`,
        sku: `TCW23-ACLV-${suffix}`,
      })

      const deniedResponse = await apiRequest(request, 'POST', '/api/wms/lots', {
        token: employeeToken,
        data: {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          catalogVariantId: variantId,
          sku: `TCW23-ACLV-${suffix}`,
          lotNumber: `DENIED-${suffix}`,
          status: 'available',
        },
      })
      expect(deniedResponse.status()).toBe(403)

      const allowedResponse = await apiRequest(request, 'POST', '/api/wms/lots', {
        token: adminToken,
        data: {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          catalogVariantId: variantId,
          sku: `TCW23-ACLV-${suffix}`,
          lotNumber: `ALLOWED-${suffix}`,
          status: 'available',
        },
      })
      expect(allowedResponse.ok()).toBeTruthy()
      const body = await readJsonSafe<{ id?: string }>(allowedResponse)
      createdLotId = body?.id ?? null
      expect(createdLotId).toBeTruthy()
    } finally {
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/lots', createdLotId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await restoreEmployeeAcl()
    }
  })
})
