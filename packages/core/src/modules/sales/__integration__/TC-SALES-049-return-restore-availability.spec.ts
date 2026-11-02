import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { createShipmentFixture, deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'
import {
  expectOperation,
  redoByLogId,
  skipIfUndoTestsDisabled,
  undoByToken,
} from '@open-mercato/core/helpers/integration/undoHarness'

/**
 * TC-SALES-049: restoring a return re-checks the currently returnable quantity.
 *
 * `sales.returns.create` redo and `sales.returns.delete` undo re-apply a return
 * snapshot. When the shipped quantity has meanwhile been consumed by a newer
 * return, or the shipment is gone, the restore must be refused with a 409 and
 * leave the order untouched; otherwise the same shipped units are returned and
 * credited twice. A refused restore keeps its audit log replayable, so it
 * succeeds once the capacity is freed.
 *
 * State is read straight from Postgres so the assertions never see a cached
 * CRUD list response.
 */

type JsonRecord = Record<string, unknown>

type OrderState = {
  returnedQuantity: number
  returnIds: string[]
  returnLineCount: number
  returnAdjustmentCount: number
  grandTotalGross: string
  grandTotalNet: string
}

async function readJson(response: APIResponse): Promise<JsonRecord> {
  const raw = await response.text()
  if (!raw) return {}
  try {
    return JSON.parse(raw) as JsonRecord
  } catch {
    return {}
  }
}

async function createShippedOrder(
  request: APIRequestContext,
  token: string,
  quantity: number,
): Promise<{ orderId: string; orderLineId: string; shipmentId: string }> {
  const orderResponse = await apiRequest(request, 'POST', '/api/sales/orders', {
    token,
    data: { currencyCode: 'USD', lines: [{ currencyCode: 'USD', quantity: 1, name: 'QA seed line', unitPriceNet: 0, unitPriceGross: 0 }] },
  })
  expect(orderResponse.status()).toBe(201)
  const orderId = (await readJson(orderResponse)).id as string

  const lineResponse = await apiRequest(request, 'POST', '/api/sales/order-lines', {
    token,
    data: { orderId, currencyCode: 'USD', quantity, name: `TC-SALES-049 ${Date.now()}`, unitPriceNet: 40, unitPriceGross: 40 },
  })
  expect(lineResponse.status()).toBe(201)
  const orderLineId = (await readJson(lineResponse)).id as string
  const shipmentId = await createShipmentFixture(request, token, orderId, [{ orderLineId, quantity }])
  return { orderId, orderLineId, shipmentId }
}

async function createReturn(
  request: APIRequestContext,
  token: string,
  orderId: string,
  orderLineId: string,
  quantity: number,
): Promise<{ returnId: string; response: APIResponse }> {
  const response = await apiRequest(request, 'POST', '/api/sales/returns', {
    token,
    data: { orderId, reason: `TC-SALES-049 ${Date.now()}`, lines: [{ orderLineId, quantity }] },
  })
  expect(response.status(), 'POST /api/sales/returns should be 201').toBe(201)
  const returnId = (await readJson(response)).id as string
  expect(returnId).toBeTruthy()
  return { returnId, response }
}

async function deleteReturn(
  request: APIRequestContext,
  token: string,
  orderId: string,
  returnId: string,
): Promise<APIResponse> {
  const response = await apiRequest(request, 'DELETE', '/api/sales/returns', { token, data: { id: returnId, orderId } })
  expect(response.status(), 'DELETE /api/sales/returns should be 200').toBe(200)
  return response
}

async function readOrderState(orderId: string, orderLineId: string): Promise<OrderState> {
  return withClient(async (client) => {
    const line = await client.query<{ returned_quantity: string }>(
      'select returned_quantity from sales_order_lines where id = $1',
      [orderLineId],
    )
    const returns = await client.query<{ id: string }>(
      'select id from sales_returns where order_id = $1 and deleted_at is null order by created_at',
      [orderId],
    )
    const returnLines = await client.query<{ count: string }>(
      'select count(*)::text as count from sales_return_lines where order_line_id = $1 and deleted_at is null',
      [orderLineId],
    )
    const adjustments = await client.query<{ count: string }>(
      "select count(*)::text as count from sales_order_adjustments where order_id = $1 and kind = 'return' and deleted_at is null",
      [orderId],
    )
    const order = await client.query<{ grand_total_gross_amount: string; grand_total_net_amount: string }>(
      'select grand_total_gross_amount, grand_total_net_amount from sales_orders where id = $1',
      [orderId],
    )
    return {
      returnedQuantity: Number(line.rows[0]?.returned_quantity),
      returnIds: returns.rows.map((row) => row.id),
      returnLineCount: Number(returnLines.rows[0]?.count),
      returnAdjustmentCount: Number(adjustments.rows[0]?.count),
      grandTotalGross: String(order.rows[0]?.grand_total_gross_amount),
      grandTotalNet: String(order.rows[0]?.grand_total_net_amount),
    }
  })
}

async function readExecutionState(logId: string): Promise<string | null> {
  return withClient(async (client) => {
    const result = await client.query<{ execution_state: string }>(
      'select execution_state from action_logs where id = $1',
      [logId],
    )
    return result.rows[0]?.execution_state ?? null
  })
}

async function expectRestoreRefused(response: APIResponse, context: string): Promise<void> {
  expect(response.status(), `${context} should be refused with 409`).toBe(409)
  const body = await readJson(response)
  expect(typeof body.error, `${context} should carry an error message`).toBe('string')
  expect(String(body.error)).not.toMatch(/^sales\.returns\./)
}

test.describe('TC-SALES-049 restoring a return re-checks returnable quantity', () => {
  test('create redo is refused after a replacement return, then succeeds once capacity is freed', async ({ request }) => {
    skipIfUndoTestsDisabled()
    test.slow()
    const token = await getAuthToken(request, 'admin')
    let orderId: string | null = null

    try {
      const order = await createShippedOrder(request, token, 5)
      orderId = order.orderId

      const first = await createReturn(request, token, order.orderId, order.orderLineId, 5)
      const firstOp = expectOperation(first.response, 'create R1')
      const undoFirst = await undoByToken(request, token, firstOp.undoToken)
      expect(undoFirst.status(), 'undo R1').toBe(200)

      const second = await createReturn(request, token, order.orderId, order.orderLineId, 5)
      const beforeRedo = await readOrderState(order.orderId, order.orderLineId)
      expect(beforeRedo.returnedQuantity).toBe(5)
      expect(beforeRedo.returnIds).toEqual([second.returnId])

      const refused = await redoByLogId(request, token, firstOp.logId)
      await expectRestoreRefused(refused, 'redo R1 after R2 consumed the shipped quantity')

      expect(await readOrderState(order.orderId, order.orderLineId)).toEqual(beforeRedo)
      expect(await readExecutionState(firstOp.logId), 'refused redo keeps R1 log undone').toBe('undone')

      await deleteReturn(request, token, order.orderId, second.returnId)
      const afterFree = await readOrderState(order.orderId, order.orderLineId)
      expect(afterFree.returnedQuantity).toBe(0)
      expect(afterFree.returnAdjustmentCount).toBe(0)

      const retried = await redoByLogId(request, token, firstOp.logId)
      expect(retried.status(), 'redo R1 after R2 was deleted').toBe(200)
      const afterRetry = await readOrderState(order.orderId, order.orderLineId)
      expect(afterRetry.returnedQuantity).toBe(5)
      expect(afterRetry.returnIds).toEqual([first.returnId])
      expect(afterRetry.returnLineCount).toBe(1)
      expect(afterRetry.returnAdjustmentCount).toBe(1)
      expect(afterRetry.grandTotalGross).toBe(beforeRedo.grandTotalGross)
      expect(await readExecutionState(firstOp.logId)).toBe('redone')

      const again = await redoByLogId(request, token, firstOp.logId)
      expect(again.status(), 'a consumed redo cannot be replayed twice').toBe(400)
      expect(await readOrderState(order.orderId, order.orderLineId)).toEqual(afterRetry)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('delete undo is refused after a replacement return, then succeeds once capacity is freed', async ({ request }) => {
    skipIfUndoTestsDisabled()
    test.slow()
    const token = await getAuthToken(request, 'admin')
    let orderId: string | null = null

    try {
      const order = await createShippedOrder(request, token, 5)
      orderId = order.orderId

      const first = await createReturn(request, token, order.orderId, order.orderLineId, 5)
      const deleteFirst = await deleteReturn(request, token, order.orderId, first.returnId)
      const deleteOp = expectOperation(deleteFirst, 'delete R1')

      const second = await createReturn(request, token, order.orderId, order.orderLineId, 5)
      const beforeUndo = await readOrderState(order.orderId, order.orderLineId)
      expect(beforeUndo.returnedQuantity).toBe(5)
      expect(beforeUndo.returnIds).toEqual([second.returnId])

      const refused = await undoByToken(request, token, deleteOp.undoToken)
      await expectRestoreRefused(refused, 'undo of R1 delete after R2 consumed the shipped quantity')

      expect(await readOrderState(order.orderId, order.orderLineId)).toEqual(beforeUndo)
      expect(await readExecutionState(deleteOp.logId), 'refused undo releases its claim').toBe('done')

      await deleteReturn(request, token, order.orderId, second.returnId)

      const retried = await undoByToken(request, token, deleteOp.undoToken)
      expect(retried.status(), 'undo of R1 delete after R2 was deleted').toBe(200)
      const afterRetry = await readOrderState(order.orderId, order.orderLineId)
      expect(afterRetry.returnedQuantity).toBe(5)
      expect(afterRetry.returnIds).toEqual([first.returnId])
      expect(afterRetry.returnLineCount).toBe(1)
      expect(afterRetry.returnAdjustmentCount).toBe(1)
      expect(afterRetry.grandTotalGross).toBe(beforeUndo.grandTotalGross)
      expect(await readExecutionState(deleteOp.logId)).toBe('undone')
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('create redo is refused when the shipment no longer exists', async ({ request }) => {
    skipIfUndoTestsDisabled()
    test.slow()
    const token = await getAuthToken(request, 'admin')
    let orderId: string | null = null

    try {
      const order = await createShippedOrder(request, token, 5)
      orderId = order.orderId

      const first = await createReturn(request, token, order.orderId, order.orderLineId, 5)
      const firstOp = expectOperation(first.response, 'create R1')
      const undoFirst = await undoByToken(request, token, firstOp.undoToken)
      expect(undoFirst.status(), 'undo R1').toBe(200)

      const shipmentDelete = await apiRequest(request, 'DELETE', '/api/sales/shipments', {
        token,
        data: { id: order.shipmentId, orderId: order.orderId },
      })
      expect(shipmentDelete.status(), 'DELETE /api/sales/shipments').toBe(200)

      const beforeRedo = await readOrderState(order.orderId, order.orderLineId)
      const refused = await redoByLogId(request, token, firstOp.logId)
      await expectRestoreRefused(refused, 'redo R1 after its shipment was deleted')

      const afterRedo = await readOrderState(order.orderId, order.orderLineId)
      expect(afterRedo).toEqual(beforeRedo)
      expect(afterRedo.returnedQuantity).toBe(0)
      expect(afterRedo.returnIds).toEqual([])
      expect(afterRedo.returnAdjustmentCount).toBe(0)
      expect(await readExecutionState(firstOp.logId)).toBe('undone')
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })
})
