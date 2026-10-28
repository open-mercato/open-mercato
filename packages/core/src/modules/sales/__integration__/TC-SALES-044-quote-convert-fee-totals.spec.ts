import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'
import {
  expectOperation,
  redoOk,
  skipIfUndoTestsDisabled,
  undoOk,
} from '@open-mercato/core/helpers/integration/undoHarness'

/**
 * TC-SALES-044 — quote → order conversion carries the shipping and surcharge totals.
 *
 * A quote has no shipping / surcharge columns; the conversion used to write the
 * order's `shippingNetAmount`, `shippingGrossAmount` and `surchargeTotalAmount`
 * as a literal 0 while copying the grand total and the adjustment rows that
 * include them. The order then showed "Shipping 0 / Surcharges 0" next to a
 * grand total containing both, until some later edit recalculated it.
 */

type JsonRecord = Record<string, unknown>

async function readJson(response: APIResponse): Promise<JsonRecord> {
  const raw = await response.text()
  if (!raw) return {}
  try {
    return JSON.parse(raw) as JsonRecord
  } catch {
    return {}
  }
}

function num(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim().length) return Number(value)
  return Number.NaN
}

async function readSingleDocument(
  request: APIRequestContext,
  token: string,
  resource: 'orders' | 'quotes',
  id: string,
): Promise<JsonRecord> {
  const response = await apiRequest(request, 'GET', `/api/sales/${resource}?id=${encodeURIComponent(id)}`, { token })
  expect(response.status(), `GET /api/sales/${resource}?id should be 200`).toBe(200)
  const body = await readJson(response)
  const items = Array.isArray(body.items) ? (body.items as JsonRecord[]) : []
  return items[0] ?? {}
}

type QuoteLineInput = { quantity: number; unitPriceNet: number; unitPriceGross: number; taxRate: number }

const DEFAULT_LINE: QuoteLineInput = { quantity: 2, unitPriceNet: 50, unitPriceGross: 61.5, taxRate: 23 }

async function createQuoteWithLines(
  request: APIRequestContext,
  token: string,
  currencyCode = 'USD',
  lines: QuoteLineInput[] = [DEFAULT_LINE],
): Promise<string> {
  const quoteResponse = await apiRequest(request, 'POST', '/api/sales/quotes', {
    token,
    data: { currencyCode },
  })
  expect(quoteResponse.status(), 'POST /api/sales/quotes should be 201').toBe(201)
  const quoteId = (await readJson(quoteResponse)).id as string
  for (const [index, line] of lines.entries()) {
    const lineResponse = await apiRequest(request, 'POST', '/api/sales/quote-lines', {
      token,
      data: { quoteId, currencyCode, name: `QA TC-SALES-044 line ${index + 1}`, ...line },
    })
    expect(lineResponse.status(), 'POST /api/sales/quote-lines should be 201').toBe(201)
  }
  return quoteId
}

async function addQuoteAdjustment(
  request: APIRequestContext,
  token: string,
  quoteId: string,
  kind: string,
  amountNet: number,
  amountGross: number,
  currencyCode = 'USD',
): Promise<void> {
  const response = await apiRequest(request, 'POST', '/api/sales/quote-adjustments', {
    token,
    data: { quoteId, scope: 'order', kind, amountNet, amountGross, currencyCode, label: `QA ${kind}` },
  })
  expect(response.status(), `POST /api/sales/quote-adjustments (${kind}) should be 201`).toBe(201)
}

async function readOrderAdjustmentAmounts(
  request: APIRequestContext,
  token: string,
  orderId: string,
): Promise<Array<[unknown, number, number]>> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/sales/order-adjustments?orderId=${encodeURIComponent(orderId)}&page=1&pageSize=20`,
    { token },
  )
  expect(response.status(), 'GET /api/sales/order-adjustments should be 200').toBe(200)
  const rows = ((await readJson(response)).items ?? []) as JsonRecord[]
  return rows.map((row) => [
    row.kind,
    num(row.amount_net ?? row.amountNet),
    num(row.amount_gross ?? row.amountGross),
  ])
}

async function postConvert(request: APIRequestContext, token: string, quoteId: string): Promise<APIResponse> {
  const response = await apiRequest(request, 'POST', '/api/sales/quotes/convert', { token, data: { quoteId } })
  expect(response.status(), 'POST /api/sales/quotes/convert should be 200').toBe(200)
  return response
}

async function convertQuote(request: APIRequestContext, token: string, quoteId: string): Promise<string> {
  const orderId = (await readJson(await postConvert(request, token, quoteId))).orderId
  expect(typeof orderId === 'string' && orderId.length > 0, 'convert should return the order id').toBeTruthy()
  return orderId as string
}

test.describe('TC-SALES-044 quote conversion keeps shipping and surcharge totals', () => {
  test('converted order carries the shipping and surcharge totals of the quote', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    let quoteId: string | null = null
    let orderId: string | null = null

    try {
      quoteId = await createQuoteWithLines(request, token)
      await addQuoteAdjustment(request, token, quoteId, 'shipping', 15, 18.45)
      await addQuoteAdjustment(request, token, quoteId, 'surcharge', 5, 6.15)
      await addQuoteAdjustment(request, token, quoteId, 'discount', 10, 10)

      const quote = await readSingleDocument(request, token, 'quotes', quoteId)
      expect(num(quote.grandTotalNetAmount), '100 line + 15 shipping + 5 surcharge - 10 discount').toBe(110)
      expect(num(quote.grandTotalGrossAmount), '123 line + 18.45 shipping + 6.15 surcharge - 10 discount').toBe(137.6)
      expect(num(quote.discountTotalAmount)).toBe(10)
      expect(num(quote.taxTotalAmount)).toBe(23)

      orderId = await convertQuote(request, token, quoteId)

      const order = await readSingleDocument(request, token, 'orders', orderId)
      expect(num(order.shippingNetAmount), 'shipping net must survive the conversion').toBe(15)
      expect(num(order.shippingGrossAmount), 'shipping gross must survive the conversion').toBe(18.45)
      expect(num(order.surchargeTotalAmount), 'surcharge total must survive the conversion').toBe(5)
      expect(num(order.subtotalNetAmount)).toBe(110)
      expect(num(order.subtotalGrossAmount)).toBe(137.6)
      expect(num(order.discountTotalAmount)).toBe(10)
      expect(num(order.taxTotalAmount)).toBe(23)
      expect(num(order.grandTotalNetAmount)).toBe(110)
      expect(num(order.grandTotalGrossAmount)).toBe(137.6)
      expect(num(order.outstandingAmount)).toBe(137.6)

      const amountsByKind = Object.fromEntries(
        (await readOrderAdjustmentAmounts(request, token, orderId)).map(([kind, net, gross]) => [kind, [net, gross]]),
      )
      expect(amountsByKind).toEqual({ shipping: [15, 18.45], surcharge: [5, 6.15], discount: [10, 10] })

      const extraLine = await apiRequest(request, 'POST', '/api/sales/order-lines', {
        token,
        data: { orderId, currencyCode: 'USD', quantity: 1, name: 'QA TC-SALES-044 extra', unitPriceNet: 1, unitPriceGross: 1 },
      })
      expect(extraLine.status(), 'POST /api/sales/order-lines should be 201').toBe(201)
      const recalculated = await readSingleDocument(request, token, 'orders', orderId)
      expect(num(recalculated.shippingNetAmount), 'a later recalculation agrees with the converted value').toBe(15)
      expect(num(recalculated.shippingGrossAmount), 'a later recalculation agrees with the converted value').toBe(18.45)
      expect(num(recalculated.surchargeTotalAmount), 'a later recalculation agrees with the converted value').toBe(5)
      expect(num(recalculated.grandTotalNetAmount)).toBe(111)
      expect(num(recalculated.grandTotalGrossAmount)).toBe(138.6)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
    }
  })

  test('converted order keeps zero shipping and surcharge totals when the quote has none', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    let quoteId: string | null = null
    let orderId: string | null = null

    try {
      quoteId = await createQuoteWithLines(request, token)
      await addQuoteAdjustment(request, token, quoteId, 'discount', 10, 10)

      orderId = await convertQuote(request, token, quoteId)

      const order = await readSingleDocument(request, token, 'orders', orderId)
      expect(num(order.shippingNetAmount)).toBe(0)
      expect(num(order.shippingGrossAmount)).toBe(0)
      expect(num(order.surchargeTotalAmount)).toBe(0)
      expect(num(order.grandTotalNetAmount)).toBe(90)
      expect(num(order.grandTotalGrossAmount)).toBe(113)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
    }
  })

  test('converted order keeps untaxed shipping from several rows on a multi-line EUR quote', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    let quoteId: string | null = null
    let orderId: string | null = null

    try {
      quoteId = await createQuoteWithLines(request, token, 'EUR', [
        DEFAULT_LINE,
        { quantity: 1, unitPriceNet: 30, unitPriceGross: 30, taxRate: 0 },
      ])
      await addQuoteAdjustment(request, token, quoteId, 'shipping', 7.5, 7.5, 'EUR')
      await addQuoteAdjustment(request, token, quoteId, 'shipping', 2.5, 2.5, 'EUR')

      const quote = await readSingleDocument(request, token, 'quotes', quoteId)
      expect(num(quote.grandTotalNetAmount), '130 lines + 10 shipping').toBe(140)
      expect(num(quote.grandTotalGrossAmount), '153 lines + 10 shipping').toBe(163)

      orderId = await convertQuote(request, token, quoteId)

      const order = await readSingleDocument(request, token, 'orders', orderId)
      expect(order.currencyCode).toBe('EUR')
      expect(num(order.shippingNetAmount), 'both shipping rows count once').toBe(10)
      expect(num(order.shippingGrossAmount), 'untaxed shipping keeps gross equal to net').toBe(10)
      expect(num(order.surchargeTotalAmount)).toBe(0)
      expect(num(order.taxTotalAmount)).toBe(num(quote.taxTotalAmount))
      expect(num(order.grandTotalNetAmount)).toBe(140)
      expect(num(order.grandTotalGrossAmount)).toBe(163)
      expect(num(order.outstandingAmount)).toBe(163)
      expect(
        (await readOrderAdjustmentAmounts(request, token, orderId)).filter(([kind]) => kind === 'shipping').length,
        'each shipping row is copied exactly once',
      ).toBe(2)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
    }
  })

  test('undoing and redoing a conversion keeps the shipping and surcharge totals', async ({ request }) => {
    skipIfUndoTestsDisabled()
    test.slow()
    const token = await getAuthToken(request, 'admin')
    let quoteId: string | null = null
    let orderId: string | null = null

    try {
      quoteId = await createQuoteWithLines(request, token)
      await addQuoteAdjustment(request, token, quoteId, 'shipping', 15, 18.45)
      await addQuoteAdjustment(request, token, quoteId, 'surcharge', 5, 6.15)

      const convertResponse = await postConvert(request, token, quoteId)
      const operation = expectOperation(convertResponse, 'quote conversion')
      orderId = (await readJson(convertResponse)).orderId as string

      await undoOk(request, token, operation.undoToken, 'quote conversion')
      expect((await readSingleDocument(request, token, 'orders', orderId)).id, 'undo removes the order').toBeUndefined()
      expect((await readSingleDocument(request, token, 'quotes', quoteId)).id, 'undo restores the quote').toBe(quoteId)

      await redoOk(request, token, operation.logId, 'quote conversion')
      const order = await readSingleDocument(request, token, 'orders', orderId)
      expect(num(order.shippingNetAmount), 'redo keeps shipping net').toBe(15)
      expect(num(order.shippingGrossAmount), 'redo keeps shipping gross').toBe(18.45)
      expect(num(order.surchargeTotalAmount), 'redo keeps the surcharge').toBe(5)
      expect(num(order.grandTotalNetAmount)).toBe(120)
      expect(num(order.grandTotalGrossAmount)).toBe(147.6)
      expect((await readOrderAdjustmentAmounts(request, token, orderId)).length, 'adjustments are not duplicated').toBe(2)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
    }
  })
})
