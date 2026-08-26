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
  fetchReservations,
  postAction,
  toNumber,
} from './helpers/wmsFixtures'

export const integrationMeta = {
  dependsOnModules: ['wms', 'catalog', 'sales'],
}

type AsnCreateResponse = {
  id?: string
  lineIds?: string[]
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

test.describe('WMS-P2-INT-07: Sales reservation re-evaluation after receipt', () => {
  test('ASN QC-pass receipt re-evaluates waiting sales order reservations', async ({ request }) => {
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
        'wms.manage_asn',
        'wms.manage_reservations',
        'wms.receive_inventory',
      ],
    )

    let productId: string | null = null
    let warehouseId: string | null = null
    let stagingId: string | null = null
    let profileId: string | null = null
    let asnId: string | null = null
    let orderId: string | null = null

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `WMS-P2 Reeval ${suffix}`,
        sku: `P2RE-${suffix}`,
      })
      const variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `WMS-P2 Reeval Variant ${suffix}`,
        sku: `P2REV-${suffix}`,
        isDefault: true,
      })

      orderId = await createSalesOrderFixture(request, adminToken)
      await createOrderLineFixture(request, adminToken, orderId, {
        productId,
        productVariantId: variantId,
        quantity: 4,
        name: `WMS-P2 Reeval Line ${suffix}`,
      })

      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `WMS-P2 Reeval WH ${suffix}`,
        code: `P2R${suffix}`,
        timezone: 'UTC',
        isActive: true,
        isPrimary: true,
      })

      stagingId = await createCrudFixture(request, adminToken, '/api/wms/locations', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        code: `RE-STG-${suffix}`,
        type: 'staging',
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

      const confirmedStatusId = await fetchOrderStatusId(request, superadminToken, 'confirmed')
      const confirmResponse = await apiRequest(request, 'PUT', '/api/sales/orders', {
        token: adminToken,
        data: {
          id: orderId,
          statusEntryId: confirmedStatusId,
        },
      })
      expect(confirmResponse.ok(), `Failed confirm order: ${confirmResponse.status()}`).toBeTruthy()

      await expect
        .poll(
          async () => {
            const reservations = await fetchReservations(request, adminToken, {
              sourceType: 'order',
              sourceId: orderId!,
              status: 'active',
            })
            return reservations.length
          },
          { timeout: 10_000, intervals: [250, 500, 1_000] },
        )
        .toBe(0)

      const createResponse = await apiRequest(request, 'POST', '/api/wms/asns', {
        token: adminToken,
        data: {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          warehouseId,
          expectedAt: new Date().toISOString(),
          referenceNumber: `ASN-RE-${suffix}`,
          lines: [{ catalogVariantId: variantId, expectedQty: 4 }],
        },
      })
      expect(createResponse.ok()).toBeTruthy()
      const created = await readJsonSafe<AsnCreateResponse>(createResponse)
      asnId = created?.id ?? null
      const lineId = created?.lineIds?.[0] ?? null
      expect(asnId).toBeTruthy()
      expect(lineId).toBeTruthy()

      await postAction(request, adminToken, `/api/wms/asns/${asnId}/receive`, {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        lineId,
        receivedQty: 4,
        targetReceivedQty: 4,
        targetStagingLocationId: stagingId,
        qcStatus: 'passed',
        performedBy: scope.userId,
      })

      await expect
        .poll(
          async () => {
            const reservations = await fetchReservations(request, adminToken, {
              sourceType: 'order',
              sourceId: orderId!,
              status: 'active',
            })
            const match = reservations.find((item) => item.catalog_variant_id === variantId)
            return toNumber(match?.quantity)
          },
          { timeout: 15_000, intervals: [250, 500, 1_000] },
        )
        .toBe(4)
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
                reason: 'WMS-P2-INT-07 cleanup',
              },
            }).catch(() => undefined)
          }
        }
        await deleteSalesEntityIfExists(request, adminToken, '/api/sales/orders', orderId)
      }
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/asns', asnId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/inventory-profiles', profileId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', stagingId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await restoreAdminAcl()
      await restoreSalesOrderToggle()
    }
  })
})
