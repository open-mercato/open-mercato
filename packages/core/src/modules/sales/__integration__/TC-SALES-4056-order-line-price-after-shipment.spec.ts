import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  canManageSalesOrders,
  createOrderLineFixture,
  createSalesOrderFixture,
  createShipmentFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/helpers/integration/salesFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

type JsonMap = Record<string, unknown>

function readItems(payload: unknown): JsonMap[] {
  if (!payload || typeof payload !== 'object') return []
  const items = (payload as JsonMap).items
  return Array.isArray(items)
    ? items.filter((item): item is JsonMap => !!item && typeof item === 'object' && !Array.isArray(item))
    : []
}

function readNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value)
}

/**
 * TC-SALES-4056: a shipped order line keeps its historical unit price.
 */
test.describe('TC-SALES-4056: shipped order-line price lock', () => {
  test('rejects a unit-price update after a partial shipment and preserves the stored price', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    test.skip(!(await canManageSalesOrders(request, token)), 'sales.orders.manage not granted on this tenant')

    let orderId: string | null = null
    try {
      orderId = await createSalesOrderFixture(request, token, 'USD')
      const lineId = await createOrderLineFixture(request, token, orderId, {
        quantity: 4,
        name: `TC-SALES-4056 line ${Date.now()}`,
        unitPriceNet: 100,
        unitPriceGross: 120,
        taxRate: 20,
      })
      await createShipmentFixture(request, token, orderId, [{ orderLineId: lineId, quantity: 1 }])

      const update = await apiRequest(request, 'PUT', '/api/sales/order-lines', {
        token,
        data: {
          id: lineId,
          orderId,
          currencyCode: 'USD',
          quantity: 4,
          unitPriceNet: 5,
          unitPriceGross: 6,
          taxRate: 20,
        },
      })
      expect(update.status()).toBe(400)

      const linesResponse = await apiRequest(
        request,
        'GET',
        `/api/sales/order-lines?orderId=${encodeURIComponent(orderId)}&page=1&pageSize=50`,
        { token },
      )
      expect(linesResponse.ok(), `GET order-lines failed: ${linesResponse.status()}`).toBeTruthy()
      const line = readItems(await readJsonSafe(linesResponse)).find((item) => item.id === lineId)
      expect(line, 'Order line should still exist').toBeTruthy()
      expect(readNumber(line?.unit_price_net ?? line?.unitPriceNet)).toBe(100)
      expect(readNumber(line?.unit_price_gross ?? line?.unitPriceGross)).toBe(120)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })
})
