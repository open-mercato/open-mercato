import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  canManageSalesOrders,
  createOrderLineFixture,
  createSalesOrderFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/helpers/integration/salesFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-SALES-3521: order → return net/gross invariant (root cause of #3036)
 * Source: issue #3521 (follow-up of #3036 / PR #3060)
 *
 * Reproduces the #3036 scenario through the real order → return flow: an order
 * line must never be priced with net = 0 while gross > 0, and successive returns
 * must reduce the order's net grand total in lockstep with gross. Before the
 * root-cause fix, a line stored with `total_net_amount = 0` produced a zero net
 * credit, freezing the net grand total on the second return while gross kept
 * dropping.
 *
 * Self-contained: creates its own order + line, exercises two returns, and
 * cleans up in `finally`. Self-skips on databases whose sales role ACLs were
 * never synced (CI bootstraps a synced tenant, so it runs there).
 */
test.describe('TC-SALES-3521: order → return net/gross invariant', () => {
  test('successive returns reduce the order net grand total in lockstep with gross', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    test.skip(!(await canManageSalesOrders(request, token)), 'sales.orders.manage not granted on this tenant')

    const createdReturnIds: string[] = []
    let orderId: string | null = null

    const readOrderTotals = async (): Promise<{ net: number; gross: number }> => {
      const res = await apiRequest(request, 'GET', `/api/sales/orders?id=${encodeURIComponent(orderId as string)}`, { token })
      expect(res.ok(), `GET order failed: ${res.status()}`).toBeTruthy()
      const body = (await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(res)) ?? {}
      const order = body.items?.[0] ?? {}
      return { net: Number(order.grandTotalNetAmount ?? 0), gross: Number(order.grandTotalGrossAmount ?? 0) }
    }

    const createReturn = async (orderLineId: string, quantity: number): Promise<void> => {
      const res = await apiRequest(request, 'POST', '/api/sales/returns', {
        token,
        data: { orderId, lines: [{ orderLineId, quantity }] },
      })
      expect(res.ok(), `POST return failed: ${res.status()}`).toBeTruthy()
      const body = (await readJsonSafe<Record<string, unknown>>(res)) ?? {}
      const returnId = (body.id ?? body.returnId) as string | undefined
      if (typeof returnId === 'string' && returnId.length) createdReturnIds.push(returnId)
    }

    try {
      orderId = await createSalesOrderFixture(request, token, 'USD')
      const orderLineId = await createOrderLineFixture(request, token, orderId, {
        quantity: 2,
        unitPriceNet: 100,
        unitPriceGross: 110,
        taxRate: 10,
        name: `TC-SALES-3521 line ${Date.now()}`,
      })

      // Invariant at the source: the persisted line carries a positive net
      // because gross is positive (never net = 0, gross > 0).
      const linesRes = await apiRequest(request, 'GET', `/api/sales/order-lines?orderId=${encodeURIComponent(orderId)}`, { token })
      expect(linesRes.ok(), `GET order-lines failed: ${linesRes.status()}`).toBeTruthy()
      const linesBody = (await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(linesRes)) ?? {}
      const line = (linesBody.items ?? []).find((item) => item.id === orderLineId) ?? {}
      const lineNet = Number(line.totalNetAmount ?? 0)
      const lineGross = Number(line.totalGrossAmount ?? 0)
      expect(lineGross).toBeGreaterThan(0)
      expect(lineNet).toBeGreaterThan(0)

      const initial = await readOrderTotals()
      expect(initial.net).toBeGreaterThan(0)
      expect(initial.gross).toBeGreaterThan(0)

      await createReturn(orderLineId, 1)
      const afterFirst = await readOrderTotals()
      // First return moves both net and gross down.
      expect(afterFirst.gross).toBeLessThan(initial.gross)
      expect(afterFirst.net).toBeLessThan(initial.net)

      await createReturn(orderLineId, 1)
      const afterSecond = await readOrderTotals()
      // Second return must move net down again (it must NOT freeze) — this is #3036.
      expect(afterSecond.gross).toBeLessThan(afterFirst.gross)
      expect(afterSecond.net).toBeLessThan(afterFirst.net)
    } finally {
      for (const returnId of createdReturnIds) {
        try {
          await apiRequest(request, 'DELETE', '/api/sales/returns', { token, data: { id: returnId, orderId } })
        } catch {
          // best-effort cleanup
        }
      }
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })
})
