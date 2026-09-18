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
 * TC-SALES-4056: a shipped order line keeps its historical pricing and totals.
 */
test.describe('TC-SALES-4056: shipped order-line price lock', () => {
  test('rejects pricing and total updates after a partial shipment and preserves stored money fields', async ({ request }) => {
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

      const readLine = async () => {
        const linesResponse = await apiRequest(
          request,
          'GET',
          `/api/sales/order-lines?orderId=${encodeURIComponent(orderId!)}&page=1&pageSize=50`,
          { token },
        )
        expect(linesResponse.ok(), `GET order-lines failed: ${linesResponse.status()}`).toBeTruthy()
        return readItems(await readJsonSafe(linesResponse)).find((item) => item.id === lineId)
      }
      const before = await readLine()
      expect(before, 'Order line should exist before guarded updates').toBeTruthy()

      const guardedUpdates: Array<[string, Record<string, number>]> = [
        ['unit prices', { unitPriceNet: 5, unitPriceGross: 6 }],
        ['discount amount', { discountAmount: 25 }],
        ['discount percent', { discountPercent: 25 }],
        ['net total', { totalNetAmount: 5 }],
        ['gross total', { totalGrossAmount: 6 }],
      ]
      for (const [label, fields] of guardedUpdates) {
        const update = await apiRequest(request, 'PUT', '/api/sales/order-lines', {
          token,
          data: {
            id: lineId,
            orderId,
            currencyCode: 'USD',
            quantity: 4,
            taxRate: 20,
            ...fields,
          },
        })
        expect(update.status(), `${label} update should be rejected`).toBe(409)
      }

      const after = await readLine()
      expect(after, 'Order line should still exist').toBeTruthy()
      const moneyFields: Array<[string, string]> = [
        ['unitPriceNet', 'unit_price_net'],
        ['unitPriceGross', 'unit_price_gross'],
        ['discountAmount', 'discount_amount'],
        ['discountPercent', 'discount_percent'],
        ['totalNetAmount', 'total_net_amount'],
        ['totalGrossAmount', 'total_gross_amount'],
      ]
      for (const [camelCase, snakeCase] of moneyFields) {
        expect(
          readNumber(after?.[snakeCase] ?? after?.[camelCase]),
          `${camelCase} should remain unchanged`,
        ).toBe(readNumber(before?.[snakeCase] ?? before?.[camelCase]))
      }
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })
})
