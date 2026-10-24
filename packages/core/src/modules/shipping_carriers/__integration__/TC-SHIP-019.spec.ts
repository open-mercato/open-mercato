import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createOrderLineFixture,
  createSalesOrderFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/salesFixtures'
import { createShipment } from './helpers/fixtures'
import { deleteCarrierShipmentInDb } from './helpers/db'

type SalesShipmentItem = Record<string, unknown> & {
  id?: string
  _carrier?: { shipmentId?: string; providerKey?: string; trackingNumber?: string; status?: string }
}

/**
 * TC-SHIP-019: Sales shipment list carries the carrier reference
 *
 * GET /api/sales/shipments returns snake_case records (`order_id`). The
 * `shipping_carriers.sales-shipment-carrier` enricher must still resolve the
 * order's carrier shipment and attach `_carrier`, which carrier tracking
 * widgets on the order Shipments tab depend on.
 */
test.describe('TC-SHIP-019: Sales shipment list carries the carrier reference', () => {
  test('enriched /api/sales/shipments item carries _carrier for an order with a carrier shipment', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let orderId: string | null = null
    let carrierShipmentId: string | null = null
    try {
      orderId = await createSalesOrderFixture(request, token, 'USD')
      const orderLineId = await createOrderLineFixture(request, token, orderId, {
        name: `QA TC-SHIP-019 Item ${Date.now()}`,
        quantity: 1,
        unitPriceNet: 10,
        unitPriceGross: 10,
        currencyCode: 'USD',
      })

      const salesShipmentResponse = await apiRequest(request, 'POST', '/api/sales/shipments', {
        token,
        data: {
          orderId,
          shipmentNumber: `SHIP-019-${Date.now()}`,
          currencyCode: 'USD',
          items: [{ orderLineId, quantity: '1' }],
        },
      })
      expect(salesShipmentResponse.ok(), `Failed to create sales shipment: ${salesShipmentResponse.status()}`).toBeTruthy()
      const salesShipmentBody = (await salesShipmentResponse.json()) as { id?: string }
      expect(salesShipmentBody.id).toBeTruthy()

      const carrierShipment = await createShipment(request, token, { orderId })
      carrierShipmentId = carrierShipment.shipmentId

      const listResponse = await apiRequest(
        request,
        'GET',
        `/api/sales/shipments?orderId=${encodeURIComponent(orderId)}&pageSize=50`,
        { token },
      )
      expect(listResponse.ok(), `Failed to list sales shipments: ${listResponse.status()}`).toBeTruthy()
      const listBody = (await listResponse.json()) as { items?: SalesShipmentItem[] }
      const item = (listBody.items ?? []).find((entry) => entry.id === salesShipmentBody.id)
      expect(item, 'Created sales shipment should be listed for the order').toBeTruthy()
      expect(item?.order_id).toBe(orderId)
      expect(item?._carrier).toEqual({
        shipmentId: carrierShipment.shipmentId,
        providerKey: 'mock_carrier',
        trackingNumber: carrierShipment.trackingNumber,
        status: expect.any(String),
      })
    } finally {
      await deleteCarrierShipmentInDb(carrierShipmentId)
      const cleanupToken = await getAuthToken(request, 'admin').catch(() => null)
      await deleteSalesEntityIfExists(request, cleanupToken, '/api/sales/orders', orderId)
    }
  })
})
