import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'

const REFUSED_MESSAGE = "Cannot create a shipment: the order's payments have been fully refunded."

type Cleanup = { shipmentIds: string[]; paymentIds: string[]; orderIds: string[]; shippingMethodIds: string[] }

async function postForId(request: APIRequestContext, token: string, path: string, data: Record<string, unknown>): Promise<string> {
  const response = await apiRequest(request, 'POST', path, { token, data })
  expect(response.status(), `POST ${path} should be 201`).toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  return expectId(body?.id, `POST ${path} should return an id`)
}

async function createPaidOrder(
  request: APIRequestContext,
  token: string,
  cleanup: Cleanup,
  refundedAmount: number,
  orderFields: Record<string, unknown> = {},
): Promise<{ orderId: string; lineId: string }> {
  const orderId = await postForId(request, token, '/api/sales/orders', {
    ...orderFields,
    currencyCode: 'USD',
    lines: [{ currencyCode: 'USD', quantity: 1, name: 'TC-SALES-054 seed line', unitPriceNet: 0, unitPriceGross: 0 }],
  })
  cleanup.orderIds.push(orderId)
  const lineId = await postForId(request, token, '/api/sales/order-lines', {
    orderId,
    currencyCode: 'USD',
    quantity: 2,
    name: 'TC-SALES-054 line',
    unitPriceNet: 50,
    unitPriceGross: 50,
  })
  const paymentId = await postForId(request, token, '/api/sales/payments', { orderId, amount: 100, currencyCode: 'USD' })
  cleanup.paymentIds.push(paymentId)
  if (refundedAmount > 0) {
    const refund = await apiRequest(request, 'PUT', '/api/sales/payments', {
      token,
      data: { id: paymentId, amount: 100, refundedAmount, currencyCode: 'USD' },
    })
    expect(refund.status(), 'PUT /api/sales/payments refund should be 200').toBe(200)
  }
  return { orderId, lineId }
}

async function countShipments(request: APIRequestContext, token: string, orderId: string): Promise<number> {
  const response = await apiRequest(request, 'GET', `/api/sales/shipments?orderId=${encodeURIComponent(orderId)}`, { token })
  expect(response.status()).toBe(200)
  const body = await readJsonSafe<{ items?: unknown[] }>(response)
  return Array.isArray(body?.items) ? body.items.length : 0
}

async function cleanupAll(request: APIRequestContext, token: string | null, cleanup: Cleanup): Promise<void> {
  for (const id of cleanup.shipmentIds) await deleteSalesEntityIfExists(request, token, '/api/sales/shipments', id)
  for (const id of cleanup.paymentIds) await deleteSalesEntityIfExists(request, token, '/api/sales/payments', id)
  for (const id of cleanup.orderIds) await deleteSalesEntityIfExists(request, token, '/api/sales/orders', id)
  for (const id of cleanup.shippingMethodIds) await deleteSalesEntityIfExists(request, token, '/api/sales/shipping-methods', id)
}

test.describe('TC-SALES-054: no new shipment on an order whose payments were fully refunded', () => {
  test('POST /api/sales/shipments returns 422 and records nothing once the payment is fully refunded', async ({ request }) => {
    test.slow()
    const cleanup: Cleanup = { shipmentIds: [], paymentIds: [], orderIds: [], shippingMethodIds: [] }
    let token: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const { orderId, lineId } = await createPaidOrder(request, token, cleanup, 100)

      const response = await apiRequest(request, 'POST', '/api/sales/shipments', {
        token,
        data: { orderId, items: [{ orderLineId: lineId, quantity: 1 }] },
      })
      const body = await readJsonSafe<{ id?: string; error?: string }>(response)
      if (body?.id) cleanup.shipmentIds.push(body.id)

      expect(response.status()).toBe(422)
      expect(body?.error).toBe(REFUSED_MESSAGE)
      expect(await countShipments(request, token, orderId)).toBe(0)
    } finally {
      await cleanupAll(request, token, cleanup)
    }
  })

  test('a partially refunded paid order can still be shipped', async ({ request }) => {
    test.slow()
    const cleanup: Cleanup = { shipmentIds: [], paymentIds: [], orderIds: [], shippingMethodIds: [] }
    let token: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const { orderId, lineId } = await createPaidOrder(request, token, cleanup, 50)

      const shipmentId = await postForId(request, token, '/api/sales/shipments', {
        orderId,
        items: [{ orderLineId: lineId, quantity: 1 }],
      })
      cleanup.shipmentIds.push(shipmentId)

      expect(await countShipments(request, token, orderId)).toBe(1)
    } finally {
      await cleanupAll(request, token, cleanup)
    }
  })

  test('the Add shipment dialog shows the refusal for a fully refunded order', async ({ page, request }) => {
    test.slow()
    const cleanup: Cleanup = { shipmentIds: [], paymentIds: [], orderIds: [], shippingMethodIds: [] }
    let token: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const stamp = Date.now()
      const methodName = `TC-SALES-054 method ${stamp}`
      const shippingMethodId = await postForId(request, token, '/api/sales/shipping-methods', {
        name: methodName,
        code: `tc-sales-054-${stamp}`,
        isActive: true,
        currencyCode: 'USD',
        baseRateNet: '0',
        baseRateGross: '0',
      })
      cleanup.shippingMethodIds.push(shippingMethodId)
      const { orderId } = await createPaidOrder(request, token, cleanup, 100, {
        shippingAddressSnapshot: {
          name: 'TC-SALES-054 Receiver',
          addressLine1: '54 Refund Street',
          city: 'Warsaw',
          postalCode: '00-054',
          country: 'PL',
        },
      })

      await login(page, 'admin')
      await page.goto(`/backend/sales/orders/${encodeURIComponent(orderId)}?kind=order`, { waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: 'Shipments' }).click()
      await page.getByRole('button', { name: 'Add shipment' }).first().click()
      const dialog = page.getByRole('dialog', { name: 'Add shipment' })
      await expect(dialog).toBeVisible()
      await dialog.getByLabel(/Shipment number/i).first().fill(`TC-SALES-054-${stamp}`)
      const methodInput = dialog.getByPlaceholder(/Select method/i).first()
      await methodInput.fill(methodName)
      await page.getByText(methodName).last().click()
      await dialog.getByRole('spinbutton').last().fill('1')
      await dialog.press('ControlOrMeta+Enter')

      await expect(page.getByText(REFUSED_MESSAGE).first()).toBeVisible()
      expect(await countShipments(request, token, orderId)).toBe(0)
    } finally {
      await cleanupAll(request, token, cleanup)
    }
  })
})
