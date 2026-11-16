import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-SALES-METHOD-CODE-KEEPS-ID: a PUT that sends only the shipping or payment
 * method code keeps the selected method, its snapshot and the shipping charge.
 * Every fixture is created through the API and deleted in `finally`.
 */

type DocumentRecord = Record<string, unknown>

async function createRecord(request: APIRequestContext, token: string, path: string, data: DocumentRecord) {
  const res = await apiRequest(request, 'POST', path, { token, data })
  expect(res.ok(), `POST ${path} failed: ${res.status()}`).toBeTruthy()
  return expectId((await readJsonSafe<{ id?: string }>(res))?.id, `${path} must return an id`)
}

async function readDocument(request: APIRequestContext, token: string, kind: 'order' | 'quote', id: string) {
  const res = await apiRequest(request, 'GET', `/api/sales/${kind}s?id=${encodeURIComponent(id)}`, { token })
  expect(res.ok(), `GET ${kind} failed: ${res.status()}`).toBeTruthy()
  const items = (await readJsonSafe<{ items?: DocumentRecord[] }>(res))?.items ?? []
  expect(items, `the ${kind} should come back from the list route`).toHaveLength(1)
  return items[0]
}

async function updateDocument(request: APIRequestContext, token: string, kind: 'order' | 'quote', data: DocumentRecord) {
  const res = await apiRequest(request, 'PUT', `/api/sales/${kind}s`, { token, data })
  expect(res.ok(), `PUT ${kind} failed: ${res.status()}`).toBeTruthy()
}

async function deleteIfCreated(request: APIRequestContext, token: string, path: string, id: string | null) {
  if (id) await apiRequest(request, 'DELETE', path, { token, data: { id } }).catch(() => undefined)
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
      shippingMethodId = await createRecord(request, token, '/api/sales/shipping-methods', {
        name: `TC method code ${stamp}`,
        code: `tc-method-code-${stamp}`,
        isActive: true,
        currencyCode: 'USD',
        providerKey: 'flat-rate',
        baseRateNet: '10.00',
        baseRateGross: '10.00',
      })
      orderId = await createRecord(request, token, '/api/sales/orders', {
        currencyCode: 'USD',
        shippingMethodId,
        lines: [{ currencyCode: 'USD', name: `TC line ${stamp}`, quantity: 1, unitPriceNet: 100, unitPriceGross: 100, taxRate: 0 }],
      })

      const before = await readDocument(request, token, 'order', orderId)
      expect(before.shippingMethodId).toBe(shippingMethodId)
      expect(Number(before.grandTotalGrossAmount), 'the flat-rate charge is part of the total').toBeCloseTo(110, 4)

      await updateDocument(request, token, 'order', { id: orderId, shippingMethodCode: `tc-renamed-${stamp}` })

      const after = await readDocument(request, token, 'order', orderId)
      expect(after.shippingMethodCode).toBe(`tc-renamed-${stamp}`)
      expect(after.shippingMethodId, 'the method id is kept').toBe(shippingMethodId)
      expect(after.shippingMethodSnapshot, 'the method snapshot is kept').toEqual(before.shippingMethodSnapshot)
      expect(Number(after.grandTotalGrossAmount), 'the shipping charge stays in the total').toBeCloseTo(110, 4)
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
      paymentMethodId = await createRecord(request, token, '/api/sales/payment-methods', {
        name: `TC payment code ${stamp}`,
        code: `tc-payment-code-${stamp}`,
        isActive: true,
      })
      quoteId = await createRecord(request, token, '/api/sales/quotes', { currencyCode: 'USD', paymentMethodId })

      const before = await readDocument(request, token, 'quote', quoteId)
      expect(before.paymentMethodId).toBe(paymentMethodId)

      await updateDocument(request, token, 'quote', { id: quoteId, paymentMethodCode: `tc-renamed-${stamp}` })

      const after = await readDocument(request, token, 'quote', quoteId)
      expect(after.paymentMethodCode).toBe(`tc-renamed-${stamp}`)
      expect(after.paymentMethodId, 'the method id is kept').toBe(paymentMethodId)
      expect(after.paymentMethodSnapshot, 'the method snapshot is kept').toEqual(before.paymentMethodSnapshot)
    } finally {
      await deleteIfCreated(request, token, '/api/sales/quotes', quoteId)
      await deleteIfCreated(request, token, '/api/sales/payment-methods', paymentMethodId)
    }
  })
})
