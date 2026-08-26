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

/** Reads the scope's current `orderShippedLineEditable`, so a case can put it back. */
async function readShippedLineEditable(request: Parameters<typeof apiRequest>[0], token: string): Promise<boolean> {
  const response = await apiRequest(request, 'GET', '/api/sales/settings/order-editing', { token })
  expect(response.ok(), `GET order-editing settings failed: ${response.status()}`).toBeTruthy()
  const payload = (await readJsonSafe(response)) as JsonMap | null
  return payload?.orderShippedLineEditable === true
}

async function setShippedLineEditable(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  value: boolean,
): Promise<void> {
  const response = await apiRequest(request, 'PUT', '/api/sales/settings/order-editing', {
    token,
    data: { orderShippedLineEditable: value },
  })
  expect(response.status(), `setting orderShippedLineEditable=${value} should be accepted`).toBe(200)
}

/**
 * TC-SALES-4056: what a shipped order line accepts, on both sides of its setting.
 *
 * By default a shipped line keeps its commercial terms — the behaviour issue #4056 asked for, and
 * the behaviour every deployment upgrades into. A scope that mirrors an external system of record
 * sets `orderShippedLineEditable` and gets the corrections that system makes after dispatch: a
 * re-rated VAT line, a price fixed by accounting, a quantity restated after a return.
 *
 * Both branches are exercised here rather than only the default, because a setting nothing reads
 * back is the failure that would otherwise ship silently: the API would keep refusing and the only
 * evidence would be a checkbox that appears to do nothing.
 *
 * The opt-in cases restore the previous value in `finally`. The tier runs `workers: 1`, so the
 * window in which the setting differs cannot overlap another spec.
 *
 * One boundary ignores the setting entirely: a line with shipment items cannot be DELETED, because
 * `sales_shipment_items.order_line_id` references it. The last case asserts that with the setting
 * ON — where letting it through would be the mistake.
 */
test.describe('TC-SALES-4056: shipped order-line corrections', () => {
  test('rejects pricing and total updates after a partial shipment and preserves stored money fields', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    test.skip(!(await canManageSalesOrders(request, token)), 'sales.orders.manage not granted on this tenant')

    let orderId: string | null = null
    try {
      expect(
        await readShippedLineEditable(request, token),
        'the tier should start from the shipped-line freeze enforced — that is the default this case pins',
      ).toBe(false)

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

  test('rejects lowering the quantity below what has already shipped', async ({ request }) => {
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

      const update = await apiRequest(request, 'PUT', '/api/sales/order-lines', {
        token,
        data: { id: lineId, orderId, currencyCode: 'USD', quantity: 2, taxRate: 20 },
      })
      expect(update.status(), 'quantity below the shipped total should be rejected').toBe(409)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('applies the same corrections once the scope sets orderShippedLineEditable', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    test.skip(!(await canManageSalesOrders(request, token)), 'sales.orders.manage not granted on this tenant')

    let orderId: string | null = null
    const previous = await readShippedLineEditable(request, token)
    try {
      await setShippedLineEditable(request, token, true)

      orderId = await createSalesOrderFixture(request, token, 'USD')
      const lineId = await createOrderLineFixture(request, token, orderId, {
        quantity: 4,
        name: `TC-SALES-4056 editable ${Date.now()}`,
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

      // One assertion per field, and each one reads the line back: a 200 alone would not
      // distinguish "the correction was applied" from "the command accepted the payload and
      // dropped it" — which is exactly how a half-wired setting would look.
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

      // The quantity floor travels with the same setting: "shipped 1 of 0" is a true statement
      // about a line whose single unit came back, and the source system is the one that decides so.
      const lowered = await apiRequest(request, 'PUT', '/api/sales/order-lines', {
        token,
        data: { id: lineId, orderId, currencyCode: 'USD', quantity: 0, taxRate: 8 },
      })
      expect(lowered.status(), 'a quantity below the shipped total should be accepted').toBe(200)
      expect(readNumber((await readLine())?.quantity), 'the lowered quantity should have been written').toBe(0)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
      await setShippedLineEditable(request, token, previous)
    }
  })

  test('still refuses to DELETE a line that has shipped items, even with the setting on', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    test.skip(!(await canManageSalesOrders(request, token)), 'sales.orders.manage not granted on this tenant')

    let orderId: string | null = null
    const previous = await readShippedLineEditable(request, token)
    try {
      await setShippedLineEditable(request, token, true)

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
      await setShippedLineEditable(request, token, previous)
    }
  })
})
