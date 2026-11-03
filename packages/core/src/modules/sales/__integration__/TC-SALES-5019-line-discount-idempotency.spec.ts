import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  canManageSalesOrders,
  createOrderLineFixture,
  createSalesOrderFixture,
  createSalesQuoteFixture,
  createShipmentFixture,
} from '@open-mercato/core/helpers/integration/salesFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-SALES-5019: sales line `discount_amount` is a line total, and recalculating
 * a document is idempotent.
 *
 * Spec: `.ai/specs/2026-08-07-sales-line-discount-amount-contract.md`
 * Issues: #3757 (the report), #5019 (its closed twin, which named this test id)
 *
 * `discount_amount` is written as the discount for the whole line but used to be
 * read back as a per-unit rate, so every recalculation multiplied it by the line
 * quantity again: `12.75 → 38.25 → 114.75 → 255` on a 3 × 85.00 line, at which
 * point the discount equalled the whole line subtotal and the line's net
 * collapsed to 0 while its gross stayed correct. With `quantity === 1` the extra
 * multiplication is a no-op, which is why it went unnoticed for so long.
 *
 * The property under test is the one that pins the contract: **a command that
 * was supposed to change nothing must change nothing.** These cases drive the
 * real HTTP surface — the order and quote line routes, the single-order GET that
 * triggers the display recalculation, and the return flow whose command file
 * used to hold a second copy of the entity-to-snapshot mapper.
 *
 * Self-contained: every fixture is created through the API and cleaned up in
 * `finally`; nothing here depends on seeded or demo data.
 */

const QUANTITY = 60
const UNIT_PRICE_NET = 50
const DISCOUNT_PERCENT = 10
// 10% of 60 × 50.00 — the discount for the whole line, not per unit.
const EXPECTED_LINE_DISCOUNT = 300
const EXPECTED_LINE_NET = 2700

type LineRecord = Record<string, unknown>

function lineDiscount(line: LineRecord): number {
  return Number(line.discount_amount ?? line.discountAmount ?? 0)
}

function lineNet(line: LineRecord): number {
  return Number(line.total_net_amount ?? line.totalNetAmount ?? 0)
}

test.describe('TC-SALES-5019: line discount idempotency across the sales API', () => {
  test('a percentage-discounted order line survives repeated upserts unchanged', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    test.skip(!(await canManageSalesOrders(request, token)), 'sales.orders.manage not granted on this tenant')

    let orderId: string | null = null

    const readLine = async (lineId: string): Promise<LineRecord> => {
      const res = await apiRequest(
        request,
        'GET',
        `/api/sales/order-lines?orderId=${encodeURIComponent(orderId as string)}`,
        { token },
      )
      expect(res.ok(), `GET order-lines failed: ${res.status()}`).toBeTruthy()
      const body = (await readJsonSafe<{ items?: LineRecord[] }>(res)) ?? {}
      const line = (body.items ?? []).find((item) => item.id === lineId)
      expect(line, 'the created line should come back from the list route').toBeTruthy()
      return line as LineRecord
    }

    try {
      orderId = await createSalesOrderFixture(request, token, 'USD')
      const lineId = await createOrderLineFixture(request, token, orderId, {
        quantity: QUANTITY,
        unitPriceNet: UNIT_PRICE_NET,
        unitPriceGross: UNIT_PRICE_NET,
        taxRate: 0,
        discountPercent: DISCOUNT_PERCENT,
        name: `TC-SALES-5019 order line ${Date.now()}`,
      })

      // The create path was always correct, because it coalesces a missing
      // amount to null and lets the percentage run. It is the baseline.
      const created = await readLine(lineId)
      expect(lineDiscount(created), 'the create path stores the discount as a line total').toBeCloseTo(
        EXPECTED_LINE_DISCOUNT,
        2,
      )
      expect(lineNet(created)).toBeCloseTo(EXPECTED_LINE_NET, 2)

      // Re-upsert the same line twice without touching the discount. Each pass
      // feeds the persisted value back through the engine, which is where the
      // runaway used to compound. One pass is not enough to prove idempotency.
      for (let pass = 1; pass <= 2; pass += 1) {
        const res = await apiRequest(request, 'PUT', '/api/sales/order-lines', {
          token,
          data: {
            id: lineId,
            orderId,
            currencyCode: 'USD',
            kind: 'product',
            quantity: QUANTITY,
            unitPriceNet: UNIT_PRICE_NET,
            unitPriceGross: UNIT_PRICE_NET,
            taxRate: 0,
          },
        })
        expect(res.ok(), `PUT order-line pass ${pass} failed: ${res.status()}`).toBeTruthy()

        const after = await readLine(lineId)
        expect(
          lineDiscount(after),
          `pass ${pass}: the stored discount must not be multiplied by quantity again`,
        ).toBeCloseTo(EXPECTED_LINE_DISCOUNT, 2)
        expect(lineNet(after), `pass ${pass}: the line net must not collapse`).toBeCloseTo(EXPECTED_LINE_NET, 2)
      }
    } finally {
      if (orderId) {
        await apiRequest(request, 'DELETE', '/api/sales/orders', { token, data: { id: orderId } }).catch(() => {})
      }
    }
  })

  test('the single-order GET recalculation returns the same totals twice in a row', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    test.skip(!(await canManageSalesOrders(request, token)), 'sales.orders.manage not granted on this tenant')

    let orderId: string | null = null

    const readOrderDiscountTotal = async (): Promise<number> => {
      const res = await apiRequest(
        request,
        'GET',
        `/api/sales/orders?id=${encodeURIComponent(orderId as string)}`,
        { token },
      )
      expect(res.ok(), `GET order failed: ${res.status()}`).toBeTruthy()
      const body = (await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(res)) ?? {}
      const order = body.items?.[0] ?? {}
      return Number(order.discount_total_amount ?? order.discountTotalAmount ?? 0)
    }

    try {
      orderId = await createSalesOrderFixture(request, token, 'USD')
      await createOrderLineFixture(request, token, orderId, {
        quantity: QUANTITY,
        unitPriceNet: UNIT_PRICE_NET,
        unitPriceGross: UNIT_PRICE_NET,
        taxRate: 0,
        discountPercent: DISCOUNT_PERCENT,
        name: `TC-SALES-5019 display line ${Date.now()}`,
      })

      // The single-order GET runs `recalculateOrderTotalsForDisplay` on a forked
      // EntityManager. It never persists, but it reads through the same mapper,
      // so a per-unit misreading shows up here as a total that disagrees with
      // the stored state and drifts between identical requests.
      const first = await readOrderDiscountTotal()
      const second = await readOrderDiscountTotal()

      expect(first).toBeCloseTo(EXPECTED_LINE_DISCOUNT, 2)
      expect(second, 'two identical GETs must return the same discount total').toBeCloseTo(first, 4)
    } finally {
      if (orderId) {
        await apiRequest(request, 'DELETE', '/api/sales/orders', { token, data: { id: orderId } }).catch(() => {})
      }
    }
  })

  test('a percentage-discounted quote line survives a re-upsert unchanged', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    test.skip(!(await canManageSalesOrders(request, token)), 'sales.orders.manage not granted on this tenant')

    let quoteId: string | null = null

    const readQuoteLine = async (lineId: string): Promise<LineRecord> => {
      const res = await apiRequest(
        request,
        'GET',
        `/api/sales/quote-lines?quoteId=${encodeURIComponent(quoteId as string)}`,
        { token },
      )
      expect(res.ok(), `GET quote-lines failed: ${res.status()}`).toBeTruthy()
      const body = (await readJsonSafe<{ items?: LineRecord[] }>(res)) ?? {}
      const line = (body.items ?? []).find((item) => item.id === lineId)
      expect(line, 'the created quote line should come back from the list route').toBeTruthy()
      return line as LineRecord
    }

    try {
      quoteId = await createSalesQuoteFixture(request, token, 'USD')

      const createRes = await apiRequest(request, 'POST', '/api/sales/quote-lines', {
        token,
        data: {
          quoteId,
          currencyCode: 'USD',
          kind: 'product',
          quantity: QUANTITY,
          unitPriceNet: UNIT_PRICE_NET,
          unitPriceGross: UNIT_PRICE_NET,
          taxRate: 0,
          discountPercent: DISCOUNT_PERCENT,
          name: `TC-SALES-5019 quote line ${Date.now()}`,
        },
      })
      expect(createRes.ok(), `POST quote-line failed: ${createRes.status()}`).toBeTruthy()
      const createdBody = (await readJsonSafe<Record<string, unknown>>(createRes)) ?? {}
      const lineId = (createdBody.id ?? createdBody.lineId) as string
      expect(typeof lineId, 'quote line create should return an id').toBe('string')

      // The quote path is a separate copy of the same coalescing chain. A fix
      // applied only to the order path leaves this one broken while every
      // order-side assertion still passes.
      const created = await readQuoteLine(lineId)
      expect(lineDiscount(created)).toBeCloseTo(EXPECTED_LINE_DISCOUNT, 2)

      const updateRes = await apiRequest(request, 'PUT', '/api/sales/quote-lines', {
        token,
        data: {
          id: lineId,
          quoteId,
          currencyCode: 'USD',
          kind: 'product',
          quantity: QUANTITY,
          unitPriceNet: UNIT_PRICE_NET,
          unitPriceGross: UNIT_PRICE_NET,
          taxRate: 0,
        },
      })
      expect(updateRes.ok(), `PUT quote-line failed: ${updateRes.status()}`).toBeTruthy()

      const after = await readQuoteLine(lineId)
      expect(lineDiscount(after), 'the quote line discount must not be re-inflated').toBeCloseTo(
        EXPECTED_LINE_DISCOUNT,
        2,
      )
      expect(lineNet(after)).toBeCloseTo(EXPECTED_LINE_NET, 2)
    } finally {
      if (quoteId) {
        await apiRequest(request, 'DELETE', '/api/sales/quotes', { token, data: { id: quoteId } }).catch(() => {})
      }
    }
  })

  test('creating and deleting a return leaves the order header totals where they started', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    test.skip(!(await canManageSalesOrders(request, token)), 'sales.orders.manage not granted on this tenant')

    let orderId: string | null = null
    let returnId: string | null = null

    const readOrderTotals = async () => {
      const res = await apiRequest(
        request,
        'GET',
        `/api/sales/orders?id=${encodeURIComponent(orderId as string)}`,
        { token },
      )
      expect(res.ok(), `GET order failed: ${res.status()}`).toBeTruthy()
      const body = (await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(res)) ?? {}
      const order = body.items?.[0] ?? {}
      return {
        net: Number(order.grand_total_net_amount ?? order.grandTotalNetAmount ?? 0),
        gross: Number(order.grand_total_gross_amount ?? order.grandTotalGrossAmount ?? 0),
        discountTotal: Number(order.discount_total_amount ?? order.discountTotalAmount ?? 0),
      }
    }

    try {
      orderId = await createSalesOrderFixture(request, token, 'USD')
      const lineId = await createOrderLineFixture(request, token, orderId, {
        quantity: 3,
        unitPriceNet: 85,
        unitPriceGross: 85,
        taxRate: 0,
        discountPercent: 5,
        name: `TC-SALES-5019 return line ${Date.now()}`,
      })

      // A return can only cover what was shipped (#3034).
      await createShipmentFixture(request, token, orderId, [{ orderLineId: lineId, quantity: 3 }])

      const before = await readOrderTotals()
      expect(before.discountTotal, 'the seeded line discount is a line total').toBeCloseTo(12.75, 2)

      const createRes = await apiRequest(request, 'POST', '/api/sales/returns', {
        token,
        data: { orderId, lines: [{ orderLineId: lineId, quantity: 1 }] },
      })
      expect(createRes.ok(), `POST return failed: ${createRes.status()}`).toBeTruthy()
      const createdBody = (await readJsonSafe<Record<string, unknown>>(createRes)) ?? {}
      returnId = ((createdBody.id ?? createdBody.returnId) as string | undefined) ?? null
      expect(typeof returnId, 'return create should return an id').toBe('string')

      const deleteRes = await apiRequest(request, 'DELETE', '/api/sales/returns', {
        token,
        data: { id: returnId, orderId },
      })
      expect(deleteRes.ok(), `DELETE return failed: ${deleteRes.status()}`).toBeTruthy()
      returnId = null

      // Both the create and the delete recompute and PERSIST the order header
      // totals from re-mapped line snapshots. That is the path `commands/
      // returns.ts` used to walk with its own copy of the mapper, so a
      // discounted line's contribution was inflated on the way through and the
      // header never came back to where it started.
      const after = await readOrderTotals()
      expect(after.discountTotal, 'the order discount total must return to its pre-return value').toBeCloseTo(
        before.discountTotal,
        4,
      )
      expect(after.net, 'the order net grand total must return to its pre-return value').toBeCloseTo(before.net, 4)
      expect(after.gross, 'the order gross grand total must return to its pre-return value').toBeCloseTo(
        before.gross,
        4,
      )
    } finally {
      if (returnId && orderId) {
        await apiRequest(request, 'DELETE', '/api/sales/returns', {
          token,
          data: { id: returnId, orderId },
        }).catch(() => {})
      }
      if (orderId) {
        await apiRequest(request, 'DELETE', '/api/sales/orders', { token, data: { id: orderId } }).catch(() => {})
      }
    }
  })
})
