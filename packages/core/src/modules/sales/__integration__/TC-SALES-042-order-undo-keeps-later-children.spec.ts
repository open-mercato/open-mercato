import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  canManageSalesOrders,
  createOrderLineFixture,
  createSalesOrderFixture,
  createShipmentFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/helpers/integration/salesFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { expectOperation, undoByToken } from '@open-mercato/core/helpers/integration/undoHarness'

type JsonMap = Record<string, unknown>

/**
 * TC-SALES-042: undoing an order-level command must never destroy work recorded on the
 * order after that command ran.
 *
 * Order-level undo (header update, line/adjustment upsert/delete) rebuilds the order graph
 * from the snapshot taken before the command. Shipments, payments, notes and returns are
 * separate undo resources, so the "latest action" check does not stop an older order undo
 * after them. The undo must refuse with 409 instead of silently rewinding the graph, and a
 * refused undo must leave the order untouched.
 */

async function listItems(request: APIRequestContext, token: string, path: string): Promise<JsonMap[]> {
  const response = await apiRequest(request, 'GET', path, { token })
  expect(response.status(), `GET ${path} should be 200`).toBe(200)
  const body = await readJsonSafe<{ items?: unknown }>(response)
  const items = Array.isArray(body?.items) ? body.items : []
  return items.filter((item): item is JsonMap => !!item && typeof item === 'object' && !Array.isArray(item))
}

async function readOrder(request: APIRequestContext, token: string, orderId: string): Promise<JsonMap> {
  const items = await listItems(request, token, `/api/sales/orders?id=${encodeURIComponent(orderId)}`)
  return items[0] ?? {}
}

async function readLine(request: APIRequestContext, token: string, orderId: string, lineId: string): Promise<JsonMap | undefined> {
  const items = await listItems(
    request,
    token,
    `/api/sales/order-lines?orderId=${encodeURIComponent(orderId)}&page=1&pageSize=50`,
  )
  return items.find((item) => item.id === lineId)
}

function readNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value)
}

async function shippedQuantity(request: APIRequestContext, token: string, orderId: string, lineId: string): Promise<number> {
  const shipments = await listItems(request, token, `/api/sales/shipments?orderId=${encodeURIComponent(orderId)}`)
  return shipments
    .flatMap((shipment) => (Array.isArray(shipment.items) ? (shipment.items as JsonMap[]) : []))
    .filter((item) => (item.orderLineId ?? item.order_line_id) === lineId)
    .reduce((total, item) => total + readNumber(item.quantity), 0)
}

async function updateOrderComment(request: APIRequestContext, token: string, orderId: string, comment: string) {
  const response = await apiRequest(request, 'PUT', '/api/sales/orders', { token, data: { id: orderId, comment } })
  expect(response.status(), 'PUT /api/sales/orders should be 200').toBe(200)
  return expectOperation(response, 'order comment update')
}

async function createNote(request: APIRequestContext, token: string, orderId: string, body: string): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/sales/notes', {
    token,
    data: { contextType: 'order', contextId: orderId, body },
  })
  expect(response.status(), 'POST /api/sales/notes should be 201').toBe(201)
  const payload = await readJsonSafe<{ id?: string }>(response)
  expect(typeof payload?.id, 'note create should return an id').toBe('string')
  return payload!.id as string
}

async function createPayment(request: APIRequestContext, token: string, orderId: string): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/sales/payments', {
    token,
    data: { orderId, amount: '10.00', currencyCode: 'USD', receivedAt: new Date().toISOString() },
  })
  expect(response.status(), 'POST /api/sales/payments should be 201').toBe(201)
  const payload = await readJsonSafe<{ id?: string; paymentId?: string }>(response)
  const id = payload?.id ?? payload?.paymentId ?? null
  expect(typeof id, 'payment create should return an id').toBe('string')
  return id as string
}

test.describe('TC-SALES-042: order undo keeps children recorded after the undone command', () => {
  test('refuses to undo an order update once a shipment, payment and note were added after it', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    test.skip(!(await canManageSalesOrders(request, token)), 'sales.orders.manage not granted on this tenant')
    const stamp = Date.now()
    let orderId: string | null = null
    try {
      orderId = await createSalesOrderFixture(request, token, 'USD')
      const lineId = await createOrderLineFixture(request, token, orderId, { quantity: 2, name: `TC-SALES-042 line ${stamp}` })
      const operation = await updateOrderComment(request, token, orderId, `TC-SALES-042 updated ${stamp}`)

      const shipmentId = await createShipmentFixture(request, token, orderId, [{ orderLineId: lineId, quantity: 1 }])
      const paymentId = await createPayment(request, token, orderId)
      const noteId = await createNote(request, token, orderId, `TC-SALES-042 note ${stamp}`)

      const undo = await undoByToken(request, token, operation.undoToken)
      expect(undo.status(), 'a stale order undo must be refused with 409').toBe(409)

      const shipments = await listItems(request, token, `/api/sales/shipments?orderId=${encodeURIComponent(orderId)}`)
      expect(shipments.map((item) => item.id), 'the later shipment must survive').toContain(shipmentId)
      const payments = await listItems(request, token, `/api/sales/payments?orderId=${encodeURIComponent(orderId)}`)
      expect(payments.map((item) => item.id), 'the later payment must survive').toContain(paymentId)
      const notes = await listItems(
        request,
        token,
        `/api/sales/notes?contextType=order&contextId=${encodeURIComponent(orderId)}`,
      )
      expect(notes.map((item) => item.id), 'the later note must survive').toContain(noteId)
      expect(await shippedQuantity(request, token, orderId, lineId), 'shipped quantity must be kept').toBe(1)
      const order = await readOrder(request, token, orderId)
      expect(order.comment, 'a refused undo must not revert the order header').toBe(`TC-SALES-042 updated ${stamp}`)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('refuses to undo an order update on an order with a return instead of partially wiping it', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    test.skip(!(await canManageSalesOrders(request, token)), 'sales.orders.manage not granted on this tenant')
    const stamp = Date.now()
    let orderId: string | null = null
    let returnId: string | null = null
    try {
      orderId = await createSalesOrderFixture(request, token, 'USD')
      const lineId = await createOrderLineFixture(request, token, orderId, { quantity: 2, name: `TC-SALES-042 ret ${stamp}` })
      const shipmentId = await createShipmentFixture(request, token, orderId, [{ orderLineId: lineId, quantity: 2 }])
      const returnResponse = await apiRequest(request, 'POST', '/api/sales/returns', {
        token,
        data: { orderId, reason: `TC-SALES-042 return ${stamp}`, lines: [{ orderLineId: lineId, quantity: 1 }] },
      })
      expect(returnResponse.status(), 'POST /api/sales/returns should be 201').toBe(201)
      returnId = (await readJsonSafe<{ id?: string }>(returnResponse))?.id ?? null
      const noteId = await createNote(request, token, orderId, `TC-SALES-042 kept note ${stamp}`)
      const operation = await updateOrderComment(request, token, orderId, `TC-SALES-042 ret updated ${stamp}`)

      const undo = await undoByToken(request, token, operation.undoToken)
      expect(undo.status(), 'undo over returned lines must be refused with 409').toBe(409)

      const shipments = await listItems(request, token, `/api/sales/shipments?orderId=${encodeURIComponent(orderId)}`)
      expect(shipments.map((item) => item.id), 'the shipment must survive a refused undo').toContain(shipmentId)
      const notes = await listItems(
        request,
        token,
        `/api/sales/notes?contextType=order&contextId=${encodeURIComponent(orderId)}`,
      )
      expect(notes.map((item) => item.id), 'the note must survive a refused undo').toContain(noteId)
      const returns = await listItems(request, token, `/api/sales/returns?orderId=${encodeURIComponent(orderId)}`)
      expect(returns.length, 'the return must survive a refused undo').toBe(1)
      expect(await shippedQuantity(request, token, orderId, lineId)).toBe(2)
      const line = await readLine(request, token, orderId, lineId)
      expect(readNumber(line?.returned_quantity ?? line?.returnedQuantity)).toBe(1)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/returns', returnId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('still undoes an order update when nothing changed on the order afterwards', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    test.skip(!(await canManageSalesOrders(request, token)), 'sales.orders.manage not granted on this tenant')
    const stamp = Date.now()
    let orderId: string | null = null
    try {
      orderId = await createSalesOrderFixture(request, token, 'USD')
      const lineId = await createOrderLineFixture(request, token, orderId, { quantity: 2, name: `TC-SALES-042 ok ${stamp}` })
      const shipmentId = await createShipmentFixture(request, token, orderId, [{ orderLineId: lineId, quantity: 1 }])
      const noteId = await createNote(request, token, orderId, `TC-SALES-042 ok note ${stamp}`)
      const paymentId = await createPayment(request, token, orderId)
      await updateOrderComment(request, token, orderId, `TC-SALES-042 first ${stamp}`)
      const operation = await updateOrderComment(request, token, orderId, `TC-SALES-042 second ${stamp}`)

      const undo = await undoByToken(request, token, operation.undoToken)
      expect(undo.status(), 'an undo with no later changes must succeed').toBe(200)

      const order = await readOrder(request, token, orderId)
      expect(order.comment).toBe(`TC-SALES-042 first ${stamp}`)
      const shipments = await listItems(request, token, `/api/sales/shipments?orderId=${encodeURIComponent(orderId)}`)
      expect(shipments.map((item) => item.id)).toEqual([shipmentId])
      const notes = await listItems(
        request,
        token,
        `/api/sales/notes?contextType=order&contextId=${encodeURIComponent(orderId)}`,
      )
      expect(notes.map((item) => item.id)).toContain(noteId)
      const payments = await listItems(request, token, `/api/sales/payments?orderId=${encodeURIComponent(orderId)}`)
      expect(payments.map((item) => item.id)).toEqual([paymentId])
      expect(await shippedQuantity(request, token, orderId, lineId)).toBe(1)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })
  test('refuses to undo an order update once a payment on the order was edited afterwards', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    test.skip(!(await canManageSalesOrders(request, token)), 'sales.orders.manage not granted on this tenant')
    const stamp = Date.now()
    let orderId: string | null = null
    try {
      orderId = await createSalesOrderFixture(request, token, 'USD')
      await createOrderLineFixture(request, token, orderId, { quantity: 1, name: `TC-SALES-042 pay ${stamp}` })
      const paymentId = await createPayment(request, token, orderId)
      const operation = await updateOrderComment(request, token, orderId, `TC-SALES-042 pay updated ${stamp}`)
      const paymentUpdate = await apiRequest(request, 'PUT', '/api/sales/payments', {
        token,
        data: { id: paymentId, amount: 7, currencyCode: 'USD' },
      })
      expect(paymentUpdate.status(), 'PUT /api/sales/payments should be 200').toBe(200)

      const undo = await undoByToken(request, token, operation.undoToken)
      expect(undo.status(), 'undo must not rewind a later payment edit').toBe(409)

      const payments = await listItems(request, token, `/api/sales/payments?orderId=${encodeURIComponent(orderId)}`)
      const payment = payments.find((item) => item.id === paymentId)
      expect(readNumber(payment?.amount), 'the edited payment amount must be kept').toBe(7)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('refuses to undo a quote update once a note was added to the quote afterwards', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    test.skip(!(await canManageSalesOrders(request, token)), 'sales.orders.manage not granted on this tenant')
    const stamp = Date.now()
    let quoteId: string | null = null
    try {
      const createResponse = await apiRequest(request, 'POST', '/api/sales/quotes', { token, data: { currencyCode: 'USD' } })
      expect(createResponse.status(), 'POST /api/sales/quotes should be 201').toBe(201)
      quoteId = (await readJsonSafe<{ id?: string }>(createResponse))?.id ?? null
      expect(typeof quoteId, 'quote create should return an id').toBe('string')
      const update = await apiRequest(request, 'PUT', '/api/sales/quotes', {
        token,
        data: { id: quoteId, comment: `TC-SALES-042 quote updated ${stamp}` },
      })
      expect(update.status(), 'PUT /api/sales/quotes should be 200').toBe(200)
      const operation = expectOperation(update, 'quote comment update')
      const noteResponse = await apiRequest(request, 'POST', '/api/sales/notes', {
        token,
        data: { contextType: 'quote', contextId: quoteId, body: `TC-SALES-042 quote note ${stamp}` },
      })
      expect(noteResponse.status(), 'POST /api/sales/notes should be 201').toBe(201)
      const noteId = (await readJsonSafe<{ id?: string }>(noteResponse))?.id

      const undo = await undoByToken(request, token, operation.undoToken)
      expect(undo.status(), 'a stale quote undo must be refused with 409').toBe(409)

      const notes = await listItems(
        request,
        token,
        `/api/sales/notes?contextType=quote&contextId=${encodeURIComponent(quoteId!)}`,
      )
      expect(notes.map((item) => item.id), 'the later quote note must survive').toContain(noteId)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
    }
  })

  test('refuses to undo a quote conversion once the created order was shipped', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    test.skip(!(await canManageSalesOrders(request, token)), 'sales.orders.manage not granted on this tenant')
    const stamp = Date.now()
    let quoteId: string | null = null
    let orderId: string | null = null
    try {
      const createResponse = await apiRequest(request, 'POST', '/api/sales/quotes', { token, data: { currencyCode: 'USD' } })
      expect(createResponse.status(), 'POST /api/sales/quotes should be 201').toBe(201)
      quoteId = (await readJsonSafe<{ id?: string }>(createResponse))?.id ?? null
      const lineResponse = await apiRequest(request, 'POST', '/api/sales/quote-lines', {
        token,
        data: { quoteId, currencyCode: 'USD', quantity: 2, name: `TC-SALES-042 convert ${stamp}`, unitPriceNet: 10, unitPriceGross: 12 },
      })
      expect(lineResponse.status(), 'POST /api/sales/quote-lines should be 201').toBe(201)
      const convert = await apiRequest(request, 'POST', '/api/sales/quotes/convert', { token, data: { quoteId } })
      expect(convert.status(), 'POST /api/sales/quotes/convert should be 200').toBe(200)
      const operation = expectOperation(convert, 'quote conversion')
      orderId = (await readJsonSafe<{ orderId?: string }>(convert))?.orderId ?? null
      expect(typeof orderId, 'convert should return the order id').toBe('string')
      const orderLines = await listItems(
        request,
        token,
        `/api/sales/order-lines?orderId=${encodeURIComponent(orderId!)}&page=1&pageSize=50`,
      )
      const lineId = orderLines[0]?.id as string
      const shipmentId = await createShipmentFixture(request, token, orderId!, [{ orderLineId: lineId, quantity: 1 }])

      const undo = await undoByToken(request, token, operation.undoToken)
      expect(undo.status(), 'undoing a conversion must not delete a shipped order').toBe(409)

      const order = await readOrder(request, token, orderId!)
      expect(order.id, 'the converted order must survive').toBe(orderId)
      const shipments = await listItems(request, token, `/api/sales/shipments?orderId=${encodeURIComponent(orderId!)}`)
      expect(shipments.map((item) => item.id), 'the shipment must survive').toContain(shipmentId)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
    }
  })
  test('undoes two consecutive order updates on an order with a payment', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    test.skip(!(await canManageSalesOrders(request, token)), 'sales.orders.manage not granted on this tenant')
    const stamp = Date.now()
    let orderId: string | null = null
    try {
      orderId = await createSalesOrderFixture(request, token, 'USD')
      await createOrderLineFixture(request, token, orderId, { quantity: 1, name: `TC-SALES-042 twice ${stamp}` })
      const paymentId = await createPayment(request, token, orderId)
      await updateOrderComment(request, token, orderId, `TC-SALES-042 base ${stamp}`)
      const first = await updateOrderComment(request, token, orderId, `TC-SALES-042 A ${stamp}`)
      const second = await updateOrderComment(request, token, orderId, `TC-SALES-042 B ${stamp}`)

      const undoSecond = await undoByToken(request, token, second.undoToken)
      expect(undoSecond.status(), 'undoing the latest update must succeed').toBe(200)
      const undoFirst = await undoByToken(request, token, first.undoToken)
      expect(undoFirst.status(), 'undoing the previous update must succeed').toBe(200)

      const order = await readOrder(request, token, orderId)
      expect(order.comment).toBe(`TC-SALES-042 base ${stamp}`)
      const payments = await listItems(request, token, `/api/sales/payments?orderId=${encodeURIComponent(orderId)}`)
      expect(payments.map((item) => item.id)).toEqual([paymentId])
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })
})
