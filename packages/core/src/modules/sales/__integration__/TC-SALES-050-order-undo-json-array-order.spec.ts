import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  canManageSalesOrders,
  createOrderLineFixture,
  createSalesOrderFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/helpers/integration/salesFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { expectOperation, skipIfUndoTestsDisabled, undoByToken } from '@open-mercato/core/helpers/integration/undoHarness'

type JsonMap = Record<string, unknown>

/**
 * TC-SALES-050: order undo answers 409 when another actor only reordered an array
 * inside a payment's or shipment's JSON values after the undone command.
 *
 * Undo of an order update rebuilds payments and shipments from the snapshot taken
 * before the command, so it must treat a reordered `metadata` or `trackingNumbers`
 * array as a later change. A refused undo must leave the edit and the order header
 * untouched, and an undo with no later change must still succeed.
 */

async function listItems(request: APIRequestContext, token: string, path: string): Promise<JsonMap[]> {
  const response = await apiRequest(request, 'GET', path, { token })
  expect(response.status(), `GET ${path} should be 200`).toBe(200)
  const body = await readJsonSafe<{ items?: unknown }>(response)
  const items = Array.isArray(body?.items) ? body.items : []
  return items.filter((item): item is JsonMap => !!item && typeof item === 'object' && !Array.isArray(item))
}

async function readOrderComment(request: APIRequestContext, token: string, orderId: string): Promise<unknown> {
  const items = await listItems(request, token, `/api/sales/orders?id=${encodeURIComponent(orderId)}`)
  return items[0]?.comment
}

async function readPaymentMetadata(
  request: APIRequestContext,
  token: string,
  orderId: string,
  paymentId: string,
): Promise<unknown> {
  const payments = await listItems(request, token, `/api/sales/payments?orderId=${encodeURIComponent(orderId)}`)
  return payments.find((item) => item.id === paymentId)?.metadata
}

async function readTrackingNumbers(
  request: APIRequestContext,
  token: string,
  orderId: string,
  shipmentId: string,
): Promise<unknown> {
  const shipments = await listItems(request, token, `/api/sales/shipments?orderId=${encodeURIComponent(orderId)}`)
  const shipment = shipments.find((item) => item.id === shipmentId)
  return shipment?.trackingNumbers ?? shipment?.tracking_numbers
}

async function updateOrderComment(request: APIRequestContext, token: string, orderId: string, comment: string) {
  const response = await apiRequest(request, 'PUT', '/api/sales/orders', { token, data: { id: orderId, comment } })
  expect(response.status(), 'PUT /api/sales/orders should be 200').toBe(200)
  return expectOperation(response, 'order comment update')
}

async function createPayment(
  request: APIRequestContext,
  token: string,
  orderId: string,
  metadata: JsonMap,
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/sales/payments', {
    token,
    data: { orderId, amount: '10.00', currencyCode: 'USD', receivedAt: new Date().toISOString(), metadata },
  })
  expect(response.status(), 'POST /api/sales/payments should be 201').toBe(201)
  const payload = await readJsonSafe<{ id?: string; paymentId?: string }>(response)
  const id = payload?.id ?? payload?.paymentId ?? null
  expect(typeof id, 'payment create should return an id').toBe('string')
  return id as string
}

async function createShipment(
  request: APIRequestContext,
  token: string,
  orderId: string,
  orderLineIds: string[],
  trackingNumbers: string[],
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/sales/shipments', {
    token,
    data: { orderId, trackingNumbers, items: orderLineIds.map((orderLineId) => ({ orderLineId, quantity: 1 })) },
  })
  expect(response.status(), 'POST /api/sales/shipments should be 201').toBe(201)
  const payload = await readJsonSafe<{ id?: string; shipmentId?: string }>(response)
  const id = payload?.id ?? payload?.shipmentId ?? null
  expect(typeof id, 'shipment create should return an id').toBe('string')
  return id as string
}

test.describe('TC-SALES-050: order undo keeps array order inside JSON values', () => {
  test('refuses to undo an order update once only an array in payment metadata was reordered', async ({ request }) => {
    skipIfUndoTestsDisabled()
    const token = await getAuthToken(request, 'admin')
    test.skip(!(await canManageSalesOrders(request, token)), 'sales.orders.manage not granted on this tenant')
    const stamp = Date.now()
    let orderId: string | null = null
    try {
      orderId = await createSalesOrderFixture(request, token, 'USD')
      await createOrderLineFixture(request, token, orderId, { quantity: 1, name: `TC-SALES-050 pay ${stamp}` })
      const paymentId = await createPayment(request, token, orderId, { attempts: ['declined', 'approved'] })
      const operation = await updateOrderComment(request, token, orderId, `TC-SALES-050 pay updated ${stamp}`)

      const reorder = await apiRequest(request, 'PUT', '/api/sales/payments', {
        token,
        data: { id: paymentId, metadata: { attempts: ['approved', 'declined'] } },
      })
      expect(reorder.status(), 'PUT /api/sales/payments should be 200').toBe(200)

      const undo = await undoByToken(request, token, operation.undoToken)
      expect(undo.status(), 'undo must not rewind a reordered payment metadata array').toBe(409)

      expect(await readPaymentMetadata(request, token, orderId, paymentId)).toEqual({
        attempts: ['approved', 'declined'],
      })
      expect(await readOrderComment(request, token, orderId), 'a refused undo must not revert the order header').toBe(
        `TC-SALES-050 pay updated ${stamp}`,
      )
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('refuses to undo an order update once only the shipment tracking numbers were reordered', async ({ request }) => {
    skipIfUndoTestsDisabled()
    const token = await getAuthToken(request, 'admin')
    test.skip(!(await canManageSalesOrders(request, token)), 'sales.orders.manage not granted on this tenant')
    const stamp = Date.now()
    let orderId: string | null = null
    try {
      orderId = await createSalesOrderFixture(request, token, 'USD')
      const lineId = await createOrderLineFixture(request, token, orderId, {
        quantity: 2,
        name: `TC-SALES-050 ship ${stamp}`,
      })
      const shipmentId = await createShipment(request, token, orderId, [lineId], ['TRACK-1', 'TRACK-2'])
      const operation = await updateOrderComment(request, token, orderId, `TC-SALES-050 ship updated ${stamp}`)

      const reorder = await apiRequest(request, 'PUT', '/api/sales/shipments', {
        token,
        data: { id: shipmentId, orderId, trackingNumbers: ['TRACK-2', 'TRACK-1'] },
      })
      expect(reorder.status(), 'PUT /api/sales/shipments should be 200').toBe(200)

      const undo = await undoByToken(request, token, operation.undoToken)
      expect(undo.status(), 'undo must not rewind reordered tracking numbers').toBe(409)

      expect(await readTrackingNumbers(request, token, orderId, shipmentId)).toEqual(['TRACK-2', 'TRACK-1'])
      expect(await readOrderComment(request, token, orderId), 'a refused undo must not revert the order header').toBe(
        `TC-SALES-050 ship updated ${stamp}`,
      )
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('still undoes an order update when the arrays were left as they were', async ({ request }) => {
    skipIfUndoTestsDisabled()
    const token = await getAuthToken(request, 'admin')
    test.skip(!(await canManageSalesOrders(request, token)), 'sales.orders.manage not granted on this tenant')
    const stamp = Date.now()
    let orderId: string | null = null
    try {
      orderId = await createSalesOrderFixture(request, token, 'USD')
      const firstLineId = await createOrderLineFixture(request, token, orderId, {
        quantity: 2,
        name: `TC-SALES-050 ok A ${stamp}`,
      })
      const secondLineId = await createOrderLineFixture(request, token, orderId, {
        quantity: 2,
        name: `TC-SALES-050 ok B ${stamp}`,
      })
      const shipmentId = await createShipment(
        request,
        token,
        orderId,
        [firstLineId, secondLineId],
        ['TRACK-1', 'TRACK-2'],
      )
      const paymentId = await createPayment(request, token, orderId, { attempts: ['declined', 'approved'] })
      await updateOrderComment(request, token, orderId, `TC-SALES-050 first ${stamp}`)
      const operation = await updateOrderComment(request, token, orderId, `TC-SALES-050 second ${stamp}`)

      const undo = await undoByToken(request, token, operation.undoToken)
      expect(undo.status(), 'an undo with no later changes must succeed').toBe(200)

      expect(await readOrderComment(request, token, orderId)).toBe(`TC-SALES-050 first ${stamp}`)
      expect(await readPaymentMetadata(request, token, orderId, paymentId)).toEqual({
        attempts: ['declined', 'approved'],
      })
      expect(await readTrackingNumbers(request, token, orderId, shipmentId)).toEqual(['TRACK-1', 'TRACK-2'])
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })
})
