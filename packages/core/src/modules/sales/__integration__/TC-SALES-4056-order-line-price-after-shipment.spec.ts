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
 * TC-SALES-4056: a shipped order line stays correctable.
 *
 * This spec asserted the opposite until issue #4056 was re-read as a feature request rather than a
 * bug: dispatch is a logistics event, and an order that has left the warehouse still has to accept
 * the corrections its system of record makes to it — a re-rated VAT line, a price fixed after the
 * fact, a quantity restated after a return. Inverting the file rather than deleting it is
 * deliberate: the case is worth keeping under its original id so the change of contract is legible
 * to whoever comes back to #4056, and so the API surface it covers keeps its coverage.
 *
 * What did NOT change is the boundary in the third case: a line that has shipped items cannot be
 * deleted, because `sales_shipment_items.order_line_id` references it. Relaxing the pricing guard
 * did not relax that, and the assertion is here to keep the two apart.
 */
test.describe('TC-SALES-4056: shipped order line stays correctable', () => {
  test('applies pricing corrections to a partially shipped line and persists them', async ({ request }) => {
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
      expect(await readLine(), 'Order line should exist before the corrections').toBeTruthy()

      // One assertion per field, and each one reads the line back: a 200 alone would not distinguish
      // "the correction was applied" from "the command accepted the payload and dropped it".
      const corrections: Array<[string, Record<string, number>, string, string]> = [
        ['unit price net', { unitPriceNet: 5, unitPriceGross: 6 }, 'unit_price_net', 'unitPriceNet'],
        ['discount amount', { discountAmount: 25 }, 'discount_amount', 'discountAmount'],
        ['discount percent', { discountPercent: 25 }, 'discount_percent', 'discountPercent'],
        ['tax rate', { taxRate: 8 }, 'tax_rate', 'taxRate'],
      ]
      for (const [label, fields, snakeCase, camelCase] of corrections) {
        const update = await apiRequest(request, 'PUT', '/api/sales/order-lines', {
          token,
          data: { id: lineId, orderId, currencyCode: 'USD', quantity: 4, ...fields },
        })
        expect(update.status(), `${label} correction should be accepted`).toBe(200)

        const after = await readLine()
        const submitted = Object.values(fields)[0]
        expect(
          readNumber(after?.[snakeCase] ?? after?.[camelCase]),
          `${label} should have been written, not silently dropped`,
        ).toBe(submitted)
      }
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('accepts a quantity below what has already shipped', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    test.skip(!(await canManageSalesOrders(request, token)), 'sales.orders.manage not granted on this tenant')

    let orderId: string | null = null
    try {
      orderId = await createSalesOrderFixture(request, token, 'USD')
      const lineId = await createOrderLineFixture(request, token, orderId, {
        quantity: 4,
        name: `TC-SALES-4056 qty ${Date.now()}`,
        unitPriceNet: 100,
        unitPriceGross: 120,
        taxRate: 20,
      })
      await createShipmentFixture(request, token, orderId, [{ orderLineId: lineId, quantity: 3 }])

      // "Shipped 3 of 2" is a true statement about an order that shipped three and then had one come
      // back: the shipment records what physically left, and the line records what is owed for.
      const update = await apiRequest(request, 'PUT', '/api/sales/order-lines', {
        token,
        data: { id: lineId, orderId, currencyCode: 'USD', quantity: 2, taxRate: 20 },
      })
      expect(update.status(), 'quantity below the shipped total should be accepted').toBe(200)

      const linesResponse = await apiRequest(
        request,
        'GET',
        `/api/sales/order-lines?orderId=${encodeURIComponent(orderId!)}&page=1&pageSize=50`,
        { token },
      )
      const after = readItems(await readJsonSafe(linesResponse)).find((item) => item.id === lineId)
      expect(readNumber(after?.quantity), 'the lowered quantity should have been written').toBe(2)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('still refuses to DELETE a line that has shipped items', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    test.skip(!(await canManageSalesOrders(request, token)), 'sales.orders.manage not granted on this tenant')

    let orderId: string | null = null
    try {
      orderId = await createSalesOrderFixture(request, token, 'USD')
      const shippedLineId = await createOrderLineFixture(request, token, orderId, {
        quantity: 4,
        name: `TC-SALES-4056 shipped ${Date.now()}`,
        unitPriceNet: 100,
        unitPriceGross: 120,
        taxRate: 20,
      })
      // A second line so the refusal below cannot be the "cannot delete the last line" guard wearing
      // the same status code — without it this case would pass whether or not the shipped-line guard
      // still exists.
      await createOrderLineFixture(request, token, orderId, {
        quantity: 1,
        name: `TC-SALES-4056 spare ${Date.now()}`,
      })
      await createShipmentFixture(request, token, orderId, [{ orderLineId: shippedLineId, quantity: 1 }])

      const removal = await apiRequest(
        request,
        'DELETE',
        `/api/sales/order-lines?id=${encodeURIComponent(shippedLineId)}&orderId=${encodeURIComponent(orderId!)}`,
        { token, data: { id: shippedLineId, orderId } },
      )
      expect(removal.status(), 'deleting a shipped line should still be refused').toBe(409)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })
})
