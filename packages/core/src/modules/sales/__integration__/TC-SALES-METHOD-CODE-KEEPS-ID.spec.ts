import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-SALES-METHOD-CODE-KEEPS-ID: updating only a document's shipping or
 * payment method code keeps the selected method.
 *
 * A PUT that sent `shippingMethodCode` (or `paymentMethodCode`) without the
 * method id used to clear the method id and its snapshot. With a flat-rate
 * shipping method that also dropped the shipping charge from the totals.
 *
 * Self-contained: every fixture is created through the API and deleted in
 * `finally`; nothing here depends on seeded or demo data.
 */

type DocumentRecord = Record<string, unknown>

function field(record: DocumentRecord, snakeKey: string, camelKey: string): unknown {
  return record[camelKey] ?? record[snakeKey] ?? null
}

function amount(record: DocumentRecord, snakeKey: string, camelKey: string): number {
  return Number(field(record, snakeKey, camelKey) ?? Number.NaN)
}

async function createConfigEntity(
  request: APIRequestContext,
  token: string,
  path: string,
  data: Record<string, unknown>,
): Promise<string> {
  const res = await apiRequest(request, 'POST', path, { token, data })
  expect(res.ok(), `POST ${path} failed: ${res.status()}`).toBeTruthy()
  const body = await readJsonSafe<{ id?: string }>(res)
  return expectId(body?.id, `${path} must return an id`)
}

async function readDocument(
  request: APIRequestContext,
  token: string,
  kind: 'order' | 'quote',
  id: string,
): Promise<DocumentRecord> {
  const res = await apiRequest(request, 'GET', `/api/sales/${kind}s?id=${encodeURIComponent(id)}`, { token })
  expect(res.ok(), `GET ${kind} failed: ${res.status()}`).toBeTruthy()
  const body = (await readJsonSafe<{ items?: DocumentRecord[] }>(res)) ?? {}
  expect(body.items, `the ${kind} should come back from the list route`).toHaveLength(1)
  return (body.items as DocumentRecord[])[0]
}

async function deleteIfCreated(
  request: APIRequestContext,
  token: string,
  path: string,
  id: string | null,
): Promise<void> {
  if (!id) return
  await apiRequest(request, 'DELETE', path, { token, data: { id } }).catch(() => undefined)
}

test.describe('TC-SALES-METHOD-CODE-KEEPS-ID: a method code update keeps the selected method', () => {
  test('order: updating only shippingMethodCode keeps the method, its snapshot and the shipping charge', async ({
    request,
  }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = `${Date.now()}`
    let shippingMethodId: string | null = null
    let orderId: string | null = null
    try {
      shippingMethodId = await createConfigEntity(request, token, '/api/sales/shipping-methods', {
        name: `TC method code ${stamp}`,
        code: `tc-method-code-${stamp}`,
        isActive: true,
        currencyCode: 'USD',
        providerKey: 'flat-rate',
        baseRateNet: '10.00',
        baseRateGross: '10.00',
      })

      orderId = await createConfigEntity(request, token, '/api/sales/orders', {
        currencyCode: 'USD',
        shippingMethodId,
        lines: [
          {
            currencyCode: 'USD',
            name: `TC method code line ${stamp}`,
            quantity: 1,
            unitPriceNet: 100,
            unitPriceGross: 100,
            taxRate: 0,
          },
        ],
      })

      const before = await readDocument(request, token, 'order', orderId)
      expect(field(before, 'shipping_method_id', 'shippingMethodId')).toBe(shippingMethodId)
      const grossBefore = amount(before, 'grand_total_gross_amount', 'grandTotalGrossAmount')
      expect(grossBefore, 'the flat-rate charge is part of the order total').toBeCloseTo(110, 4)

      const updateRes = await apiRequest(request, 'PUT', '/api/sales/orders', {
        token,
        data: { id: orderId, shippingMethodCode: `tc-renamed-${stamp}` },
      })
      expect(updateRes.ok(), `PUT order failed: ${updateRes.status()}`).toBeTruthy()

      const after = await readDocument(request, token, 'order', orderId)
      expect(field(after, 'shipping_method_code', 'shippingMethodCode')).toBe(`tc-renamed-${stamp}`)
      expect(field(after, 'shipping_method_id', 'shippingMethodId'), 'the method id is kept').toBe(shippingMethodId)
      expect(
        field(after, 'shipping_method_snapshot', 'shippingMethodSnapshot'),
        'the method snapshot is kept',
      ).toEqual(field(before, 'shipping_method_snapshot', 'shippingMethodSnapshot'))
      expect(
        amount(after, 'grand_total_gross_amount', 'grandTotalGrossAmount'),
        'the shipping charge stays in the total',
      ).toBeCloseTo(grossBefore, 4)
    } finally {
      await deleteIfCreated(request, token, '/api/sales/orders', orderId)
      await deleteIfCreated(request, token, '/api/sales/shipping-methods', shippingMethodId)
    }
  })

  test('quote: updating only paymentMethodCode keeps the payment method', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = `${Date.now()}`
    let paymentMethodId: string | null = null
    let quoteId: string | null = null
    try {
      paymentMethodId = await createConfigEntity(request, token, '/api/sales/payment-methods', {
        name: `TC payment code ${stamp}`,
        code: `tc-payment-code-${stamp}`,
        isActive: true,
      })

      quoteId = await createConfigEntity(request, token, '/api/sales/quotes', {
        currencyCode: 'USD',
        paymentMethodId,
      })

      const before = await readDocument(request, token, 'quote', quoteId)
      expect(field(before, 'payment_method_id', 'paymentMethodId')).toBe(paymentMethodId)

      const updateRes = await apiRequest(request, 'PUT', '/api/sales/quotes', {
        token,
        data: { id: quoteId, paymentMethodCode: `tc-renamed-${stamp}` },
      })
      expect(updateRes.ok(), `PUT quote failed: ${updateRes.status()}`).toBeTruthy()

      const after = await readDocument(request, token, 'quote', quoteId)
      expect(field(after, 'payment_method_code', 'paymentMethodCode')).toBe(`tc-renamed-${stamp}`)
      expect(field(after, 'payment_method_id', 'paymentMethodId'), 'the method id is kept').toBe(paymentMethodId)
      expect(
        field(after, 'payment_method_snapshot', 'paymentMethodSnapshot'),
        'the method snapshot is kept',
      ).toEqual(field(before, 'payment_method_snapshot', 'paymentMethodSnapshot'))
    } finally {
      await deleteIfCreated(request, token, '/api/sales/quotes', quoteId)
      await deleteIfCreated(request, token, '/api/sales/payment-methods', paymentMethodId)
    }
  })
})
