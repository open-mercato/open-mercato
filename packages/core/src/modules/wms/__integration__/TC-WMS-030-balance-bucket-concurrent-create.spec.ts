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
  getTokenScope,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createCrudFixture,
  ensureRoleFeatures,
  fetchBalancesAtLocation,
  postAction,
  toNumber,
} from './helpers/wmsFixtures'

export const integrationMeta = {
  dependsOnModules: ['wms', 'catalog'],
}

const ROUNDS = 5
const PARALLEL_RECEIPTS = 4
const RECEIPT_QUANTITY = 5

type Scope = ReturnType<typeof getTokenScope>

async function createLocation(
  request: APIRequestContext,
  token: string,
  scope: Scope,
  warehouseId: string,
  code: string,
): Promise<string> {
  return createCrudFixture(request, token, '/api/wms/locations', {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    warehouseId,
    code,
    type: 'bin',
    isActive: true,
  })
}

async function balanceRowsFor(
  request: APIRequestContext,
  token: string,
  locationId: string,
  variantId: string,
) {
  const rows = await fetchBalancesAtLocation(request, token, locationId)
  return rows.filter((row) => row.catalog_variant_id === variantId)
}

test.describe('TC-WMS-030: Concurrent writes into an empty balance bucket', () => {
  test('should keep one balance row per bucket when receipts arrive at the same time', async ({ request }) => {
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
      'wms.receive_inventory',
      'wms.cycle_count',
    ])

    let productId: string | null = null
    let warehouseId: string | null = null
    const locationIds: string[] = []

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `TC-WMS-030 Bucket ${suffix}`,
        sku: `TCW30-${suffix}`,
      })
      const variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `TC-WMS-030 Variant ${suffix}`,
        sku: `TCW30-V-${suffix}`,
      })
      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `TC-WMS-030 Warehouse ${suffix}`,
        code: `TCW30W${suffix}`,
        isActive: true,
      })

      for (let round = 0; round < ROUNDS; round += 1) {
        const locationId = await createLocation(request, adminToken, scope, warehouseId, `BIN-${suffix}-${round}`)
        locationIds.push(locationId)

        const responses = await Promise.all(
          Array.from({ length: PARALLEL_RECEIPTS }, () =>
            apiRequest(request, 'POST', '/api/wms/inventory/receive', {
              token: adminToken,
              data: {
                organizationId: scope.organizationId,
                tenantId: scope.tenantId,
                warehouseId,
                locationId,
                catalogVariantId: variantId,
                quantity: RECEIPT_QUANTITY,
                reason: 'TC-WMS-030 concurrent receipt',
                referenceType: 'manual',
                referenceId: randomUUID(),
                performedBy: scope.userId,
              },
            }),
          ),
        )
        for (const response of responses) {
          expect(response.status(), `round ${round}: receipt status`).toBe(200)
        }

        const expectedOnHand = PARALLEL_RECEIPTS * RECEIPT_QUANTITY
        const rows = await balanceRowsFor(request, adminToken, locationId, variantId)
        expect(rows, `round ${round}: balance rows for one bucket`).toHaveLength(1)
        expect(toNumber(rows[0]?.quantity_on_hand)).toBe(expectedOnHand)

        const count = await postAction<{ adjustmentDelta?: string }>(
          request,
          adminToken,
          '/api/wms/inventory/cycle-count',
          {
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            warehouseId,
            locationId,
            catalogVariantId: variantId,
            countedQuantity: expectedOnHand,
            autoAdjust: true,
            reason: 'TC-WMS-030 count',
            referenceId: randomUUID(),
            performedBy: scope.userId,
          },
        )
        expect(toNumber(count.adjustmentDelta)).toBe(0)
        const afterCount = await balanceRowsFor(request, adminToken, locationId, variantId)
        const totalAfterCount = afterCount.reduce((sum, row) => sum + toNumber(row.quantity_on_hand), 0)
        expect(totalAfterCount, `round ${round}: on hand after counting ${expectedOnHand}`).toBe(expectedOnHand)
      }
    } finally {
      for (const locationId of locationIds) {
        await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', locationId)
      }
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await restoreAdminAcl()
    }
  })

  test('should merge a move into an empty location with receipts into the same location', async ({ request }) => {
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
      'wms.receive_inventory',
    ])

    let productId: string | null = null
    let warehouseId: string | null = null
    const locationIds: string[] = []

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `TC-WMS-030 Move ${suffix}`,
        sku: `TCW30M-${suffix}`,
      })
      const variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `TC-WMS-030 Move Variant ${suffix}`,
        sku: `TCW30M-V-${suffix}`,
      })
      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `TC-WMS-030 Move Warehouse ${suffix}`,
        code: `TCW30M${suffix}`,
        isActive: true,
      })
      const sourceId = await createLocation(request, adminToken, scope, warehouseId, `SRC-${suffix}`)
      locationIds.push(sourceId)

      await postAction(request, adminToken, '/api/wms/inventory/receive', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        locationId: sourceId,
        catalogVariantId: variantId,
        quantity: 100,
        reason: 'TC-WMS-030 opening stock',
        referenceType: 'manual',
        referenceId: randomUUID(),
        performedBy: scope.userId,
      })

      for (let round = 0; round < ROUNDS; round += 1) {
        const targetId = await createLocation(request, adminToken, scope, warehouseId, `DST-${suffix}-${round}`)
        locationIds.push(targetId)

        const move = apiRequest(request, 'POST', '/api/wms/inventory/move', {
          token: adminToken,
          data: {
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            warehouseId,
            fromLocationId: sourceId,
            toLocationId: targetId,
            catalogVariantId: variantId,
            quantity: 4,
            reason: 'TC-WMS-030 move into empty location',
            referenceType: 'manual',
            referenceId: randomUUID(),
            performedBy: scope.userId,
          },
        })
        const receipts = Array.from({ length: 2 }, () =>
          apiRequest(request, 'POST', '/api/wms/inventory/receive', {
            token: adminToken,
            data: {
              organizationId: scope.organizationId,
              tenantId: scope.tenantId,
              warehouseId,
              locationId: targetId,
              catalogVariantId: variantId,
              quantity: 3,
              reason: 'TC-WMS-030 receipt into the move target',
              referenceType: 'manual',
              referenceId: randomUUID(),
              performedBy: scope.userId,
            },
          }),
        )
        const responses = await Promise.all([move, ...receipts])
        for (const response of responses) {
          expect(response.status(), `round ${round}: move/receipt status`).toBe(200)
        }

        const rows = await balanceRowsFor(request, adminToken, targetId, variantId)
        expect(rows, `round ${round}: balance rows for the move target`).toHaveLength(1)
        expect(toNumber(rows[0]?.quantity_on_hand)).toBe(10)
      }

      const sourceRows = await balanceRowsFor(request, adminToken, sourceId, variantId)
      expect(sourceRows).toHaveLength(1)
      expect(toNumber(sourceRows[0]?.quantity_on_hand)).toBe(100 - ROUNDS * 4)
    } finally {
      for (const locationId of locationIds) {
        await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', locationId)
      }
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await restoreAdminAcl()
    }
  })
})
