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
  createOrderLineFixture,
  createSalesOrderFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/helpers/integration/salesFixtures'
import {
  createCrudFixture,
  ensureBooleanFeatureToggle,
  ensureRoleFeatures,
  fetchBalance,
  fetchReservations,
  postAction,
  toNumber,
} from './helpers/wmsFixtures'

export const integrationMeta = {
  dependsOnModules: ['wms', 'sales', 'catalog'],
}

type SalesStatusListResponse = {
  items?: Array<{ id?: string; value?: string | null }>
}

async function fetchConfirmedStatusId(request: APIRequestContext, token: string): Promise<string> {
  const response = await apiRequest(request, 'GET', '/api/sales/order-statuses?page=1&pageSize=100', { token })
  expect(response.ok(), `Failed GET /api/sales/order-statuses: ${response.status()}`).toBeTruthy()
  const body = await readJsonSafe<SalesStatusListResponse>(response)
  const status = body?.items?.find((item) => item.value === 'confirmed') ?? null
  return expectId(status?.id, 'Missing order status "confirmed"')
}

/**
 * TC-WMS-038: editing or deleting a confirmed order line trims its stock reservation
 */
test.describe('TC-WMS-038: Confirmed order line changes trim the WMS reservation', () => {
  test('lowering a line quantity or deleting a line releases the stock the order no longer needs', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    const stamp = Date.now()

    const restoreSalesOrderToggle = await ensureBooleanFeatureToggle(
      request,
      superadminToken,
      'wms_integration_sales_order_inventory',
      'Sales Order Inventory Reservation',
      'Allows WMS to reserve and release inventory from sales order lifecycle events.',
      'wms',
    )
    let restoreAdminAcl: () => Promise<void> = async () => undefined
    let productId: string | null = null
    let warehouseId: string | null = null
    let locationId: string | null = null
    let orderId: string | null = null

    try {
      restoreAdminAcl = await ensureRoleFeatures(request, superadminToken, scope.tenantId, 'admin', [
        'wms.view',
        'wms.manage_warehouses',
        'wms.manage_locations',
        'wms.manage_inventory',
        'wms.manage_reservations',
        'wms.adjust_inventory',
      ])
      productId = await createProductFixture(request, adminToken, {
        title: `QA Trim Product ${stamp}`,
        sku: `QA-WMS-T-${stamp}`,
      })
      const editedVariantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `QA Trim Edited ${stamp}`,
        sku: `QA-WMS-TE-${stamp}`,
        isDefault: true,
      })
      const deletedVariantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `QA Trim Deleted ${stamp}`,
        sku: `QA-WMS-TD-${stamp}`,
      })
      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `QA Trim Warehouse ${stamp}`,
        code: `QA-T-WH-${stamp}`,
        isActive: true,
        timezone: 'UTC',
      })
      locationId = await createCrudFixture(request, adminToken, '/api/wms/locations', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        code: `QA-T-BIN-${stamp}`,
        type: 'bin',
        isActive: true,
      })
      for (const variantId of [editedVariantId, deletedVariantId]) {
        await postAction(request, adminToken, '/api/wms/inventory/adjust', {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          warehouseId,
          locationId,
          catalogVariantId: variantId,
          delta: 5,
          reason: 'QA setup stock for TC-WMS-038',
          referenceType: 'manual',
          referenceId: randomUUID(),
          performedBy: scope.userId,
        })
      }

      orderId = await createSalesOrderFixture(request, adminToken)
      const editedLinePayload = {
        productId,
        productVariantId: editedVariantId,
        name: `QA Trim Edited Line ${stamp}`,
        currencyCode: 'USD',
        unitPriceNet: 10,
        unitPriceGross: 12,
      }
      const editedLineId = await createOrderLineFixture(request, adminToken, orderId, { ...editedLinePayload, quantity: 3 })
      const deletedLineId = await createOrderLineFixture(request, adminToken, orderId, {
        productId,
        productVariantId: deletedVariantId,
        name: `QA Trim Deleted Line ${stamp}`,
        quantity: 2,
      })

      const confirmResponse = await apiRequest(request, 'PUT', '/api/sales/orders', {
        token: adminToken,
        data: { id: orderId, statusEntryId: await fetchConfirmedStatusId(request, superadminToken) },
      })
      expect(confirmResponse.ok(), `Failed to confirm order: ${confirmResponse.status()}`).toBeTruthy()

      const readReservationState = async (variantId: string) => {
        const reservations = await fetchReservations(request, adminToken, {
          sourceType: 'order',
          sourceId: orderId!,
          catalogVariantId: variantId,
          status: 'active',
        })
        const balance = await fetchBalance(request, adminToken, warehouseId!, variantId)
        return {
          activeQuantity: reservations.reduce((sum, item) => sum + toNumber(item.quantity), 0),
          reservedQuantity: toNumber(balance?.quantity_reserved),
          availableQuantity: balance?.quantity_available ?? 0,
        }
      }
      const pollOptions = { timeout: 10_000, intervals: [250, 500, 1_000] }

      await expect
        .poll(() => readReservationState(editedVariantId), pollOptions)
        .toEqual({ activeQuantity: 3, reservedQuantity: 3, availableQuantity: 2 })
      await expect
        .poll(() => readReservationState(deletedVariantId), pollOptions)
        .toEqual({ activeQuantity: 2, reservedQuantity: 2, availableQuantity: 3 })

      const lineUpdate = await apiRequest(request, 'PUT', '/api/sales/order-lines', {
        token: adminToken,
        data: { id: editedLineId, orderId, ...editedLinePayload, quantity: 1 },
      })
      expect(lineUpdate.ok(), `Failed to lower the line quantity: ${lineUpdate.status()}`).toBeTruthy()
      await expect
        .poll(() => readReservationState(editedVariantId), pollOptions)
        .toEqual({ activeQuantity: 1, reservedQuantity: 1, availableQuantity: 4 })

      const lineDelete = await apiRequest(request, 'DELETE', '/api/sales/order-lines', {
        token: adminToken,
        data: { id: deletedLineId, orderId },
      })
      expect(lineDelete.ok(), `Failed to delete the line: ${lineDelete.status()}`).toBeTruthy()
      await expect
        .poll(() => readReservationState(deletedVariantId), pollOptions)
        .toEqual({ activeQuantity: 0, reservedQuantity: 0, availableQuantity: 5 })
    } finally {
      if (orderId) {
        const reservations = await fetchReservations(request, adminToken, {
          sourceType: 'order',
          sourceId: orderId,
          status: 'active',
        }).catch(() => [])
        for (const reservation of reservations) {
          if (!reservation.id) continue
          await apiRequest(request, 'POST', '/api/wms/inventory/release', {
            token: adminToken,
            data: {
              organizationId: scope.organizationId,
              tenantId: scope.tenantId,
              reservationId: reservation.id,
              reason: 'QA cleanup for TC-WMS-038',
            },
          }).catch(() => undefined)
        }
      }
      await deleteSalesEntityIfExists(request, adminToken, '/api/sales/orders', orderId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', locationId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await restoreAdminAcl()
      await restoreSalesOrderToggle()
    }
  })
})
