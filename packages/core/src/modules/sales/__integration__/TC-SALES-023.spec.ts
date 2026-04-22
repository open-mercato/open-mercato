import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createOrderLineFixture,
  createSalesOrderFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/salesFixtures'

type JsonMap = Record<string, unknown>

function readItems(payload: unknown): JsonMap[] {
  if (!payload || typeof payload !== 'object') return []
  const map = payload as JsonMap
  const direct = map.items
  if (Array.isArray(direct)) return direct.filter((item): item is JsonMap => !!item && typeof item === 'object' && !Array.isArray(item))
  const nested = map.result
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const nestedItems = (nested as JsonMap).items
    if (Array.isArray(nestedItems)) {
      return nestedItems.filter((item): item is JsonMap => !!item && typeof item === 'object' && !Array.isArray(item))
    }
  }
  return []
}

function readNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : Number.NaN
  }
  return Number.NaN
}

/**
 * TC-SALES-023: Order Returns - Adjustments and returned_quantity
 * Source: .ai/specs/SPEC-058-2026-03-09-order-returns-adjustments.md
 */
test.describe('TC-SALES-023: Order Returns - Adjustments and returned_quantity', () => {
  test('should create return, generate return adjustments, update returned_quantity, and reduce totals', async ({ request }) => {
    const token = await getAuthToken(request)
    let orderId: string | null = null
    let orderLineId: string | null = null

    try {
      orderId = await createSalesOrderFixture(request, token, 'USD')
      orderLineId = await createOrderLineFixture(request, token, orderId, {
        quantity: 2,
        unitPriceNet: 10,
        unitPriceGross: 12,
        currencyCode: 'USD',
      })

      const beforeOrderRes = await apiRequest(
        request,
        'GET',
        `/api/sales/orders?id=${encodeURIComponent(orderId)}&page=1&pageSize=1`,
        { token },
      )
      expect(beforeOrderRes.ok(), `Failed to read order before return: ${beforeOrderRes.status()}`).toBeTruthy()
      const beforeOrderBody = (await beforeOrderRes.json()) as unknown
      const beforeOrder = readItems(beforeOrderBody)[0] ?? null
      expect(beforeOrder, 'Order should be returned by list query').toBeTruthy()
      const beforeGrandTotalGross = readNumber(
        (beforeOrder as JsonMap).grand_total_gross_amount ?? (beforeOrder as JsonMap).grandTotalGrossAmount,
      )
      expect(Number.isFinite(beforeGrandTotalGross), 'Order grand total gross should be numeric').toBeTruthy()

      const createReturnRes = await apiRequest(request, 'POST', '/api/sales/returns', {
        token,
        data: {
          orderId,
          lines: [{ orderLineId, quantity: '1' }],
        },
      })
      expect(createReturnRes.ok(), `Failed to create return: ${createReturnRes.status()}`).toBeTruthy()
      const createReturnBody = (await createReturnRes.json()) as unknown
      const returnId =
        createReturnBody && typeof createReturnBody === 'object'
          ? (createReturnBody as JsonMap).id ?? ((createReturnBody as JsonMap).result as JsonMap | undefined)?.id
          : null
      expect(typeof returnId === 'string' && returnId.length > 0, 'Return id should be present in response').toBeTruthy()

      const returnRes = await apiRequest(request, 'GET', `/api/sales/returns/${encodeURIComponent(returnId as string)}`, { token })
      expect(returnRes.ok(), `Failed to read return: ${returnRes.status()}`).toBeTruthy()
      const returnBody = (await returnRes.json()) as { lines?: Array<{ orderLineId?: string | null; quantityReturned?: string }> }
      expect(Array.isArray(returnBody.lines) && returnBody.lines.length === 1, 'Return should contain one line').toBeTruthy()
      expect(returnBody.lines?.[0]?.orderLineId).toBe(orderLineId)
      expect(Math.abs(readNumber(returnBody.lines?.[0]?.quantityReturned) - 1) < 0.0001).toBeTruthy()

      const orderLinesRes = await apiRequest(
        request,
        'GET',
        `/api/sales/order-lines?orderId=${encodeURIComponent(orderId)}&page=1&pageSize=50`,
        { token },
      )
      expect(orderLinesRes.ok(), `Failed to read order lines: ${orderLinesRes.status()}`).toBeTruthy()
      const orderLinesBody = (await orderLinesRes.json()) as unknown
      const orderLines = readItems(orderLinesBody)
      const updatedLine = orderLines.find((line) => line.id === orderLineId) ?? null
      expect(updatedLine, 'Returned order line should be present').toBeTruthy()
      const returnedQuantity = readNumber(updatedLine?.returned_quantity ?? updatedLine?.returnedQuantity)
      expect(Math.abs(returnedQuantity - 1) < 0.0001, 'returned_quantity should be incremented to 1').toBeTruthy()

      const adjustmentsRes = await apiRequest(
        request,
        'GET',
        `/api/sales/order-adjustments?orderId=${encodeURIComponent(orderId)}&page=1&pageSize=50`,
        { token },
      )
      expect(adjustmentsRes.ok(), `Failed to read order adjustments: ${adjustmentsRes.status()}`).toBeTruthy()
      const adjustmentsBody = (await adjustmentsRes.json()) as unknown
      const adjustments = readItems(adjustmentsBody)
      const returnAdjustments = adjustments.filter((adj) => adj.kind === 'return' && adj.scope === 'line')
      expect(returnAdjustments.length, 'Expected at least one return adjustment').toBeGreaterThan(0)
      const matching = returnAdjustments.find((adj) => (adj.order_line_id ?? adj.orderLineId) === orderLineId) ?? null
      expect(matching, 'Return adjustment should be linked to returned line').toBeTruthy()
      const amountGross = readNumber(matching?.amount_gross ?? matching?.amountGross)
      expect(amountGross < 0, 'Return adjustment amount_gross should be negative (credit)').toBeTruthy()
      const creditMagnitude = Math.abs(amountGross)
      expect(
        Math.abs(creditMagnitude - 12) < 0.5 || Math.abs(creditMagnitude - 10) < 0.5,
        `Return adjustment should credit 1 × unit price (expected ~10 or ~12, got ${amountGross})`,
      ).toBeTruthy()

      const afterOrderRes = await apiRequest(
        request,
        'GET',
        `/api/sales/orders?id=${encodeURIComponent(orderId)}&page=1&pageSize=1`,
        { token },
      )
      expect(afterOrderRes.ok(), `Failed to read order after return: ${afterOrderRes.status()}`).toBeTruthy()
      const afterOrderBody = (await afterOrderRes.json()) as unknown
      const afterOrder = readItems(afterOrderBody)[0] ?? null
      expect(afterOrder, 'Order should be returned after return creation').toBeTruthy()
      const afterGrandTotalGross = readNumber(
        (afterOrder as JsonMap).grand_total_gross_amount ?? (afterOrder as JsonMap).grandTotalGrossAmount,
      )
      expect(Number.isFinite(afterGrandTotalGross), 'Order grand total gross after return should be numeric').toBeTruthy()
      expect(afterGrandTotalGross).toBeLessThan(beforeGrandTotalGross)
      const totalDrop = beforeGrandTotalGross - afterGrandTotalGross
      expect(totalDrop >= 9.5 && totalDrop <= 12.5, `Order total should drop by ~10–12 (got ${totalDrop})`).toBeTruthy()
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })
})

