import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'

/**
 * TC-SALES-043: split-payment order projections.
 *
 * `SalesPayment` + `SalesPaymentAllocation` are the ledger; an order's
 * `paidTotalAmount` / `outstandingAmount` are derived projections. A payment can
 * be allocated across several orders, so every payment mutation (create, update,
 * delete, undo, redo) must refresh every order that held an allocation before or
 * after the change — not only the payment's primary order.
 *
 * Reads go through the order list API (the CRUD cache may be enabled), so each
 * assertion also proves the affected orders' cached reads were invalidated.
 */

type JsonRecord = Record<string, unknown>
type Operation = { id: string; undoToken: string }
type Allocation = { orderId: string; amount: number }

const ORDER_TOTAL = 100

async function readJson(response: APIResponse): Promise<JsonRecord> {
  const raw = await response.text()
  if (!raw) return {}
  try {
    return JSON.parse(raw) as JsonRecord
  } catch {
    return {}
  }
}

function readOperation(response: APIResponse): Operation {
  const header = response.headers()['x-om-operation'] ?? ''
  const encoded = header.startsWith('omop:') ? header.slice(5) : ''
  expect(encoded, 'x-om-operation header carries an omop: payload').not.toBe('')
  const payload = JSON.parse(decodeURIComponent(encoded)) as { id?: string; undoToken?: string }
  expect(typeof payload.id).toBe('string')
  expect(typeof payload.undoToken).toBe('string')
  return { id: payload.id as string, undoToken: payload.undoToken as string }
}

async function createOrder(request: APIRequestContext, token: string, label: string): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/sales/orders', {
    token,
    data: {
      currencyCode: 'USD',
      lines: [
        { currencyCode: 'USD', quantity: 1, name: `TC-SALES-043 ${label}`, unitPriceNet: ORDER_TOTAL, unitPriceGross: ORDER_TOTAL },
      ],
    },
  })
  expect(response.status(), `create order ${label}`).toBe(201)
  const id = (await readJson(response)).id
  expect(typeof id).toBe('string')
  return id as string
}

async function readOrderTotals(request: APIRequestContext, token: string, orderId: string) {
  const response = await apiRequest(request, 'GET', `/api/sales/orders?id=${encodeURIComponent(orderId)}`, { token })
  expect(response.status()).toBe(200)
  const body = await readJson(response)
  const item = (Array.isArray(body.items) ? body.items[0] : null) as JsonRecord | null
  expect(item, `order ${orderId} readable`).toBeTruthy()
  return {
    grand: Number(item?.grandTotalGrossAmount),
    paid: Number(item?.paidTotalAmount),
    outstanding: Number(item?.outstandingAmount),
  }
}

async function expectPaid(
  request: APIRequestContext,
  token: string,
  expected: Record<string, { id: string; paid: number }>,
  step: string,
) {
  for (const [label, { id, paid }] of Object.entries(expected)) {
    const totals = await readOrderTotals(request, token, id)
    expect(totals.paid, `${step}: order ${label} paid`).toBeCloseTo(paid, 2)
    expect(totals.outstanding, `${step}: order ${label} outstanding`).toBeCloseTo(Math.max(ORDER_TOTAL - paid, 0), 2)
  }
}

function allocationsPayload(allocations: Allocation[]) {
  return allocations.map((allocation) => ({ orderId: allocation.orderId, amount: allocation.amount, currencyCode: 'USD' }))
}

async function createPayment(
  request: APIRequestContext,
  token: string,
  primaryOrderId: string,
  allocations: Allocation[],
): Promise<{ id: string; operation: Operation }> {
  const amount = allocations.reduce((sum, allocation) => sum + allocation.amount, 0)
  const response = await apiRequest(request, 'POST', '/api/sales/payments', {
    token,
    data: { orderId: primaryOrderId, amount, currencyCode: 'USD', allocations: allocationsPayload(allocations) },
  })
  expect(response.status(), `create payment ${await response.text()}`).toBe(201)
  const id = (await readJson(response)).id
  expect(typeof id).toBe('string')
  return { id: id as string, operation: readOperation(response) }
}

async function updateAllocations(
  request: APIRequestContext,
  token: string,
  paymentId: string,
  allocations: Allocation[],
  extra: JsonRecord = {},
): Promise<Operation> {
  const amount = allocations.reduce((sum, allocation) => sum + allocation.amount, 0)
  const response = await apiRequest(request, 'PUT', '/api/sales/payments', {
    token,
    data: { id: paymentId, amount, allocations: allocationsPayload(allocations), ...extra },
  })
  expect(response.status(), `update payment ${await response.text()}`).toBe(200)
  return readOperation(response)
}

async function undo(request: APIRequestContext, token: string, operation: Operation) {
  const response = await apiRequest(request, 'POST', '/api/audit_logs/audit-logs/actions/undo', {
    token,
    data: { undoToken: operation.undoToken },
  })
  expect(response.status(), 'undo 200').toBe(200)
}

async function redo(request: APIRequestContext, token: string, operation: Operation) {
  const response = await apiRequest(request, 'POST', '/api/audit_logs/audit-logs/actions/redo', {
    token,
    data: { logId: operation.id },
  })
  expect(response.status(), 'redo 200').toBe(200)
}

async function deletePayment(request: APIRequestContext, token: string, paymentId: string): Promise<Operation> {
  const response = await apiRequest(request, 'DELETE', `/api/sales/payments?id=${encodeURIComponent(paymentId)}`, { token })
  expect(response.status(), 'delete payment 200').toBe(200)
  return readOperation(response)
}

test.describe('TC-SALES-043: split-payment order projections', () => {
  test('create, reallocate, add/remove secondary, undo and delete keep every affected order in sync', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const orderIds: string[] = []
    let paymentId: string | null = null
    try {
      const orderA = await createOrder(request, token, 'A')
      const orderB = await createOrder(request, token, 'B')
      const orderC = await createOrder(request, token, 'C')
      orderIds.push(orderA, orderB, orderC)
      expect((await readOrderTotals(request, token, orderA)).grand).toBeCloseTo(ORDER_TOTAL, 2)
      const state = (a: number, b: number, c: number) => ({
        A: { id: orderA, paid: a },
        B: { id: orderB, paid: b },
        C: { id: orderC, paid: c },
      })
      await expectPaid(request, token, state(0, 0, 0), 'baseline')

      const created = await createPayment(request, token, orderA, [
        { orderId: orderA, amount: 40 },
        { orderId: orderB, amount: 60 },
      ])
      paymentId = created.id
      await expectPaid(request, token, state(40, 60, 0), 'create split A40/B60')

      await updateAllocations(request, token, paymentId, [
        { orderId: orderA, amount: 70 },
        { orderId: orderB, amount: 30 },
      ])
      await expectPaid(request, token, state(70, 30, 0), 'reallocate A70/B30')

      await updateAllocations(request, token, paymentId, [
        { orderId: orderA, amount: 50 },
        { orderId: orderB, amount: 30 },
        { orderId: orderC, amount: 20 },
      ])
      await expectPaid(request, token, state(50, 30, 20), 'add secondary C')

      const removeB = await updateAllocations(request, token, paymentId, [
        { orderId: orderA, amount: 50 },
        { orderId: orderC, amount: 50 },
      ])
      await expectPaid(request, token, state(50, 0, 50), 'remove secondary B')

      await undo(request, token, removeB)
      await expectPaid(request, token, state(50, 30, 20), 'undo remove B')

      const moved = await updateAllocations(
        request,
        token,
        paymentId,
        [
          { orderId: orderC, amount: 60 },
          { orderId: orderB, amount: 40 },
        ],
        { orderId: orderC },
      )
      await expectPaid(request, token, state(0, 40, 60), 'move primary A→C and drop A')
      await undo(request, token, moved)
      await expectPaid(request, token, state(50, 30, 20), 'undo primary move')

      const deleted = await deletePayment(request, token, paymentId)
      await expectPaid(request, token, state(0, 0, 0), 'delete payment')

      await undo(request, token, deleted)
      await expectPaid(request, token, state(50, 30, 20), 'undo delete')
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/payments', paymentId)
      for (const id of orderIds) await deleteSalesEntityIfExists(request, token, '/api/sales/orders', id)
    }
  })

  test('undo and redo of a split-payment create refresh every allocated order', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const orderIds: string[] = []
    let paymentId: string | null = null
    try {
      const orderA = await createOrder(request, token, 'A')
      const orderB = await createOrder(request, token, 'B')
      orderIds.push(orderA, orderB)
      const state = (a: number, b: number) => ({ A: { id: orderA, paid: a }, B: { id: orderB, paid: b } })

      const created = await createPayment(request, token, orderA, [
        { orderId: orderA, amount: 25 },
        { orderId: orderB, amount: 35 },
      ])
      paymentId = created.id
      await expectPaid(request, token, state(25, 35), 'create')

      await undo(request, token, created.operation)
      await expectPaid(request, token, state(0, 0), 'undo create')

      await redo(request, token, created.operation)
      await expectPaid(request, token, state(25, 35), 'redo create')
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/payments', paymentId)
      for (const id of orderIds) await deleteSalesEntityIfExists(request, token, '/api/sales/orders', id)
    }
  })

  test('multiple partial payments across the same orders accumulate to the exact-paid boundary', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const orderIds: string[] = []
    const paymentIds: string[] = []
    try {
      const orderA = await createOrder(request, token, 'A')
      const orderB = await createOrder(request, token, 'B')
      orderIds.push(orderA, orderB)
      const state = (a: number, b: number) => ({ A: { id: orderA, paid: a }, B: { id: orderB, paid: b } })

      paymentIds.push((await createPayment(request, token, orderA, [
        { orderId: orderA, amount: 10 },
        { orderId: orderB, amount: 20 },
      ])).id)
      paymentIds.push((await createPayment(request, token, orderB, [
        { orderId: orderB, amount: 30 },
        { orderId: orderA, amount: 5 },
      ])).id)
      await expectPaid(request, token, state(15, 50), 'two partial split payments')

      paymentIds.push((await createPayment(request, token, orderA, [
        { orderId: orderA, amount: 0.01 },
        { orderId: orderB, amount: 50 },
      ])).id)
      await expectPaid(request, token, state(15.01, 100), 'secondary B exactly paid')
      const exact = await readOrderTotals(request, token, orderB)
      expect(exact.outstanding).toBe(0)

      await deletePayment(request, token, paymentIds[1])
      await expectPaid(request, token, state(10.01, 70), 'delete a payment whose primary is B')
    } finally {
      for (const id of paymentIds) await deleteSalesEntityIfExists(request, token, '/api/sales/payments', id)
      for (const id of orderIds) await deleteSalesEntityIfExists(request, token, '/api/sales/orders', id)
    }
  })

  test('parallel cross-allocated payments settle without deadlock and with exact totals', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const orderIds: string[] = []
    const paymentIds: string[] = []
    try {
      const orderA = await createOrder(request, token, 'A')
      const orderB = await createOrder(request, token, 'B')
      orderIds.push(orderA, orderB)

      const responses = await Promise.all(
        Array.from({ length: 8 }, (_, index) => {
          const [primary, secondary] = index % 2 === 0 ? [orderA, orderB] : [orderB, orderA]
          return apiRequest(request, 'POST', '/api/sales/payments', {
            token,
            data: {
              orderId: primary,
              amount: 3,
              currencyCode: 'USD',
              allocations: allocationsPayload([
                { orderId: primary, amount: 1 },
                { orderId: secondary, amount: 2 },
              ]),
            },
          })
        }),
      )
      for (const response of responses) {
        const body = await readJson(response)
        if (typeof body.id === 'string') paymentIds.push(body.id)
        expect(response.status(), `parallel create ${JSON.stringify(body)}`).toBe(201)
      }
      await expectPaid(request, token, { A: { id: orderA, paid: 12 }, B: { id: orderB, paid: 12 } }, 'parallel creates')
    } finally {
      for (const id of paymentIds) await deleteSalesEntityIfExists(request, token, '/api/sales/payments', id)
      for (const id of orderIds) await deleteSalesEntityIfExists(request, token, '/api/sales/orders', id)
    }
  })

  test('a rejected allocation leaves every order projection untouched', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const orderIds: string[] = []
    try {
      const orderA = await createOrder(request, token, 'A')
      const orderB = await createOrder(request, token, 'B')
      orderIds.push(orderA, orderB)
      const response = await apiRequest(request, 'POST', '/api/sales/payments', {
        token,
        data: {
          orderId: orderA,
          amount: 30,
          currencyCode: 'USD',
          allocations: allocationsPayload([
            { orderId: orderB, amount: 10 },
            { orderId: '00000000-0000-4000-8000-000000000000', amount: 20 },
          ]),
        },
      })
      expect(response.status()).toBe(404)
      await expectPaid(request, token, { A: { id: orderA, paid: 0 }, B: { id: orderB, paid: 0 } }, 'rejected create')
    } finally {
      for (const id of orderIds) await deleteSalesEntityIfExists(request, token, '/api/sales/orders', id)
    }
  })
})
