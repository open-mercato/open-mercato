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

type Scope = ReturnType<typeof getTokenScope>

async function postCycleCount(
  request: APIRequestContext,
  token: string,
  scope: Scope,
  input: { warehouseId: string; locationId: string; catalogVariantId: string; countedQuantity: number; referenceId: string },
) {
  return apiRequest(request, 'POST', '/api/wms/inventory/cycle-count', {
    token,
    data: {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      ...input,
      autoAdjust: true,
      reason: 'TC-WMS-029 cycle count',
      performedBy: scope.userId,
    },
  })
}

test.describe('TC-WMS-029: Cycle count cannot drop on-hand below reserved + allocated stock', () => {
  for (const allocate of [false, true]) {
    const mode = allocate ? 'allocated' : 'reserved'

    test(`rejects a count below ${mode} stock, accepts the exact committed quantity, and keeps the reservation consistent`, async ({ request }) => {
      const adminToken = await getAuthToken(request, 'admin')
      const superadminToken = await getAuthToken(request, 'superadmin')
      const scope = getTokenScope(adminToken)
      const suffix = randomUUID().slice(0, 8)

      const restoreAdminAcl = await ensureRoleFeatures(request, superadminToken, scope.tenantId, 'admin', [
        'wms.view',
        'wms.manage_warehouses',
        'wms.manage_locations',
        'wms.manage_inventory',
        'wms.manage_reservations',
        'wms.adjust_inventory',
        'wms.cycle_count',
      ])

      let productId: string | null = null
      let warehouseId: string | null = null
      let locationId: string | null = null
      let profileId: string | null = null

      try {
        productId = await createProductFixture(request, adminToken, {
          title: `TC-WMS-029 ${mode} ${suffix}`,
          sku: `TCW29-${mode.slice(0, 1).toUpperCase()}-${suffix}`,
        })
        const variantId = await createVariantFixture(request, adminToken, {
          productId,
          name: `TC-WMS-029 ${mode} Variant ${suffix}`,
          sku: `TCW29-${mode.slice(0, 1).toUpperCase()}V-${suffix}`,
        })
        warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          name: `TC-WMS-029 Warehouse ${suffix}`,
          code: `TCW29${suffix}`,
          city: 'Gdansk',
          country: 'PL',
          timezone: 'Europe/Warsaw',
          isActive: true,
        })
        locationId = await createCrudFixture(request, adminToken, '/api/wms/locations', {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          warehouseId,
          code: `CC-${suffix}`,
          type: 'bin',
          capacityUnits: 500,
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

        await postAction(request, adminToken, '/api/wms/inventory/adjust', {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          warehouseId,
          locationId,
          catalogVariantId: variantId,
          delta: 102,
          reason: 'TC-WMS-029 seed',
          referenceType: 'manual',
          referenceId: randomUUID(),
          performedBy: scope.userId,
        })

        const sourceId = randomUUID()
        const reserveResult = await postAction<{ reservationId?: string | null }>(
          request,
          adminToken,
          '/api/wms/inventory/reserve',
          {
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            warehouseId,
            catalogVariantId: variantId,
            quantity: 10,
            sourceType: 'manual',
            sourceId,
          },
        )
        const reservationId = reserveResult.reservationId ?? null
        expect(reservationId).toBeTruthy()

        if (allocate) {
          await postAction(request, adminToken, '/api/wms/inventory/allocate', {
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            reservationId,
          })
        }

        const committedField = allocate ? 'quantity_allocated' : 'quantity_reserved'
        const baseline = await fetchBalance(request, adminToken, warehouseId, variantId)
        expect(toNumber(baseline?.quantity_on_hand)).toBe(102)
        expect(toNumber(baseline?.[committedField])).toBe(10)
        expect(baseline?.quantity_available).toBe(92)

        for (const counted of [9, 8]) {
          const rejectedReferenceId = randomUUID()
          const rejected = await postCycleCount(request, adminToken, scope, {
            warehouseId,
            locationId,
            catalogVariantId: variantId,
            countedQuantity: counted,
            referenceId: rejectedReferenceId,
          })
          expect(rejected.status()).toBe(409)
          await expect(readJsonSafe<Record<string, unknown>>(rejected)).resolves.toMatchObject({
            error: 'insufficient_stock',
            committedQuantity: '10',
          })

          const afterRejected = await fetchBalance(request, adminToken, warehouseId, variantId)
          expect(toNumber(afterRejected?.quantity_on_hand)).toBe(102)
          expect(toNumber(afterRejected?.[committedField])).toBe(10)
          expect(afterRejected?.quantity_available).toBe(92)
          const rejectedMovements = await fetchMovements(request, adminToken, {
            warehouseId,
            catalogVariantId: variantId,
            referenceId: rejectedReferenceId,
            type: 'cycle_count',
          })
          expect(rejectedMovements).toHaveLength(0)
        }

        const acceptedReferenceId = randomUUID()
        const accepted = await postCycleCount(request, adminToken, scope, {
          warehouseId,
          locationId,
          catalogVariantId: variantId,
          countedQuantity: 10,
          referenceId: acceptedReferenceId,
        })
        expect(accepted.status()).toBe(200)
        await expect(readJsonSafe<Record<string, unknown>>(accepted)).resolves.toMatchObject({
          ok: true,
          adjustmentDelta: '-92',
        })

        const afterExact = await fetchBalance(request, adminToken, warehouseId, variantId)
        expect(toNumber(afterExact?.quantity_on_hand)).toBe(10)
        expect(toNumber(afterExact?.[committedField])).toBe(10)
        expect(afterExact?.quantity_available).toBe(0)

        const reservations = await fetchReservations(request, adminToken, {
          warehouseId,
          catalogVariantId: variantId,
          sourceType: 'manual',
          sourceId,
        })
        expect(reservations).toHaveLength(1)
        expect(reservations[0]?.status).toBe('active')
        expect(toNumber(reservations[0]?.quantity)).toBe(10)

        await postAction(request, adminToken, '/api/wms/inventory/release', {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          reservationId,
          reason: 'TC-WMS-029 release',
        })
        const afterRelease = await fetchBalance(request, adminToken, warehouseId, variantId)
        expect(toNumber(afterRelease?.quantity_on_hand)).toBe(10)
        expect(toNumber(afterRelease?.quantity_reserved)).toBe(0)
        expect(toNumber(afterRelease?.quantity_allocated)).toBe(0)
        expect(afterRelease?.quantity_available).toBe(10)

        const shrinkReferenceId = randomUUID()
        const shrink = await postCycleCount(request, adminToken, scope, {
          warehouseId,
          locationId,
          catalogVariantId: variantId,
          countedQuantity: 9,
          referenceId: shrinkReferenceId,
        })
        expect(shrink.status()).toBe(200)
        const afterShrink = await fetchBalance(request, adminToken, warehouseId, variantId)
        expect(toNumber(afterShrink?.quantity_on_hand)).toBe(9)
        expect(afterShrink?.quantity_available).toBe(9)
      } finally {
        await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/inventory-profiles', profileId)
        await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', locationId)
        await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
        await deleteCatalogProductIfExists(request, adminToken, productId)
        await restoreAdminAcl()
      }
    })
  }
})
