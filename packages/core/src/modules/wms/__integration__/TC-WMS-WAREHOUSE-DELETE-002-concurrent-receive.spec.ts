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
import { createCrudFixture, ensureRoleFeatures, postAction } from './helpers/wmsFixtures'

export const integrationMeta = {
  dependsOnModules: ['wms', 'catalog'],
}

const ROUNDS = 5
const RECEIVE_QUANTITY = 5

type Scope = ReturnType<typeof getTokenScope>

test.describe('TC-WMS-WAREHOUSE-DELETE-002: archiving a warehouse stays serialized against a concurrent receive', () => {
  test('a receipt and an archive racing for the same warehouse never both win', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope: Scope = getTokenScope(adminToken)
    const suffix = randomUUID().slice(0, 8)

    const restoreAcl = await ensureRoleFeatures(request, superadminToken, scope.tenantId, 'admin', [
      'wms.view',
      'wms.manage_warehouses',
      'wms.manage_locations',
      'wms.receive_inventory',
      'wms.adjust_inventory',
    ])

    let productId: string | null = null
    let variantId: string | null = null

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `TC-WMS-WAREHOUSE-DELETE race ${suffix}`,
        sku: `TCWDR-P-${suffix}`,
      })
      variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `TC-WMS-WAREHOUSE-DELETE race variant ${suffix}`,
        sku: `TCWDR-${suffix}`,
      })

      for (let round = 0; round < ROUNDS; round += 1) {
        const warehouseCreated = await apiRequest(request, 'POST', '/api/wms/warehouses', {
          token: adminToken,
          data: {
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            name: `TC-WMS-WAREHOUSE-DELETE race ${suffix}-${round}`,
            code: `TCWDR${suffix}${round}`,
            isActive: true,
          },
        })
        expect(warehouseCreated.ok(), `round ${round}: failed POST /api/wms/warehouses`).toBeTruthy()
        const warehouseBody = await readJsonSafe<{ id?: string }>(warehouseCreated)
        const warehouseId = warehouseBody?.id ?? ''
        const locationId = await createCrudFixture(request, adminToken, '/api/wms/locations', {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          warehouseId,
          code: `TCWDR-BIN-${suffix}-${round}`,
          type: 'bin',
          isActive: true,
        })

        const [deleteResponse, receiveResponse] = await Promise.all([
          apiRequest(request, 'DELETE', `/api/wms/warehouses?id=${encodeURIComponent(warehouseId)}`, {
            token: adminToken,
          }),
          apiRequest(request, 'POST', '/api/wms/inventory/receive', {
            token: adminToken,
            data: {
              organizationId: scope.organizationId,
              tenantId: scope.tenantId,
              warehouseId,
              locationId,
              catalogVariantId: variantId,
              quantity: RECEIVE_QUANTITY,
              referenceType: 'manual',
              referenceId: randomUUID(),
              performedBy: scope.userId,
            },
          }),
        ])

        const archiveWon = deleteResponse.status() === 200
        const receiveWon = receiveResponse.status() === 200
        expect(
          archiveWon !== receiveWon,
          `round ${round}: archive (${deleteResponse.status()}) and receive (${receiveResponse.status()}) must not both succeed or both fail`,
        ).toBe(true)

        if (archiveWon) {
          // The warehouse committed its archive first: a receive that reads it
          // afterwards must see it as gone, never as a live target to restock.
          expect(receiveResponse.status(), `round ${round}: receive after archive`).toBe(404)
        } else {
          // The receive committed its stock first: the archive must then see
          // that live balance and refuse instead of silently winning the race.
          const deleteBody = await readJsonSafe<{ code?: string }>(deleteResponse)
          expect(deleteResponse.status(), `round ${round}: archive after receive`).toBe(409)
          expect(deleteBody?.code).toBe('warehouse_has_stock')

          await postAction(request, adminToken, '/api/wms/inventory/adjust', {
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            warehouseId,
            locationId,
            catalogVariantId: variantId,
            delta: -RECEIVE_QUANTITY,
            reason: 'TC-WMS-WAREHOUSE-DELETE race cleanup',
            referenceType: 'manual',
            referenceId: randomUUID(),
            performedBy: scope.userId,
          })
          const archived = await apiRequest(request, 'DELETE', `/api/wms/warehouses?id=${encodeURIComponent(warehouseId)}`, {
            token: adminToken,
          })
          expect(archived.ok(), `round ${round}: failed to archive after zeroing stock`).toBeTruthy()
        }

        await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', locationId)
        await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      }
    } finally {
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await restoreAcl()
    }
  })
})
