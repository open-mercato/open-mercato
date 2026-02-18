import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { deleteCatalogProductIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'
import { createSalesQuoteFixture, deleteSalesEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/salesFixtures'

async function createUomProduct(
  request: APIRequestContext,
  token: string,
  stamp: number,
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/catalog/products', {
    token,
    data: {
      title: `QA TC-SALES-020 ${stamp}`,
      sku: `QA-SALES-020-${stamp}`,
      description:
        'Product created for sales UoM integration tests. Contains enough text for product create validation.',
      defaultUnit: 'm2',
      defaultSalesUnit: 'pkg',
      defaultSalesUnitQuantity: 1,
      uomRoundingScale: 4,
      uomRoundingMode: 'half_up',
      unitPriceEnabled: true,
      unitPriceReferenceUnit: 'm2',
      unitPriceBaseQuantity: 1,
    },
  })
  expect(response.ok(), `Failed to create UoM product: ${response.status()}`).toBeTruthy()
  const body = (await response.json()) as { id?: string }
  expect(typeof body.id === 'string' && body.id.length > 0).toBeTruthy()
  return body.id as string
}

function readLine(items: Array<Record<string, unknown>> | undefined): Record<string, unknown> {
  const first = Array.isArray(items) ? items[0] : null
  expect(first, 'Expected at least one line').toBeTruthy()
  return first as Record<string, unknown>
}

function readSnapshotFactor(snapshot: unknown): number {
  if (!snapshot || typeof snapshot !== 'object') return Number.NaN
  const payload = snapshot as Record<string, unknown>
  return Number(payload.toBaseFactor ?? payload.to_base_factor ?? Number.NaN)
}

test.describe('TC-SALES-020: Quote line normalization and snapshot preservation', () => {
  test('should persist normalized quantities and preserve snapshot across quote conversion', async ({ request }) => {
    const stamp = Date.now()
    let token: string | null = null
    let productId: string | null = null
    let conversionId: string | null = null
    let quoteId: string | null = null
    let orderId: string | null = null

    try {
      token = await getAuthToken(request)
      productId = await createUomProduct(request, token, stamp)

      const conversionCreate = await apiRequest(request, 'POST', '/api/catalog/product-unit-conversions', {
        token,
        data: {
          productId,
          unitCode: 'pkg',
          toBaseFactor: 2.5,
          sortOrder: 10,
          isActive: true,
        },
      })
      expect(conversionCreate.ok(), `Failed to create conversion: ${conversionCreate.status()}`).toBeTruthy()
      const conversionBody = (await conversionCreate.json()) as { id?: string }
      conversionId = typeof conversionBody.id === 'string' ? conversionBody.id : null
      expect(conversionId, 'Missing conversion id').toBeTruthy()

      quoteId = await createSalesQuoteFixture(request, token, 'USD')

      const lineCreate = await apiRequest(request, 'POST', '/api/sales/quote-lines', {
        token,
        data: {
          quoteId,
          productId,
          quantity: 2,
          quantityUnit: 'pkg',
          currencyCode: 'USD',
          name: `QA UoM line ${stamp}`,
          unitPriceNet: 20,
          unitPriceGross: 25,
        },
      })
      expect(lineCreate.ok(), `Failed to create quote line: ${lineCreate.status()}`).toBeTruthy()

      const quoteLines = await apiRequest(
        request,
        'GET',
        `/api/sales/quote-lines?quoteId=${encodeURIComponent(quoteId)}&page=1&pageSize=20`,
        { token },
      )
      expect(quoteLines.ok(), `Failed to fetch quote lines: ${quoteLines.status()}`).toBeTruthy()
      const quoteLinesBody = (await quoteLines.json()) as { items?: Array<Record<string, unknown>> }
      const quoteLine = readLine(quoteLinesBody.items)
      const quoteNormalized = Number(quoteLine.normalized_quantity ?? quoteLine.normalizedQuantity ?? Number.NaN)
      expect(Math.abs(quoteNormalized - 5) < 0.0001, 'Quote line should normalize 2 pkg into 5 base units').toBeTruthy()

      const quoteSnapshot = quoteLine.uom_snapshot ?? quoteLine.uomSnapshot
      const quoteSnapshotFactor = readSnapshotFactor(quoteSnapshot)
      expect(Math.abs(quoteSnapshotFactor - 2.5) < 0.0001, 'Quote snapshot should keep original factor').toBeTruthy()

      const conversionUpdate = await apiRequest(request, 'PUT', '/api/catalog/product-unit-conversions', {
        token,
        data: {
          id: conversionId,
          toBaseFactor: 3,
        },
      })
      expect(conversionUpdate.ok(), `Failed to update conversion factor: ${conversionUpdate.status()}`).toBeTruthy()

      const convertQuote = await apiRequest(request, 'POST', '/api/sales/quotes/convert', {
        token,
        data: { quoteId },
      })
      expect(convertQuote.ok(), `Failed to convert quote: ${convertQuote.status()}`).toBeTruthy()
      const convertBody = (await convertQuote.json()) as { orderId?: string }
      orderId = typeof convertBody.orderId === 'string' ? convertBody.orderId : null
      expect(orderId, 'Order id should be returned after conversion').toBeTruthy()

      const orderLines = await apiRequest(
        request,
        'GET',
        `/api/sales/order-lines?orderId=${encodeURIComponent(orderId as string)}&page=1&pageSize=20`,
        { token },
      )
      expect(orderLines.ok(), `Failed to fetch order lines: ${orderLines.status()}`).toBeTruthy()
      const orderLinesBody = (await orderLines.json()) as { items?: Array<Record<string, unknown>> }
      const orderLine = readLine(orderLinesBody.items)
      const orderNormalized = Number(orderLine.normalized_quantity ?? orderLine.normalizedQuantity ?? Number.NaN)
      expect(Math.abs(orderNormalized - 5) < 0.0001, 'Order line should keep normalized quantity from quote snapshot').toBeTruthy()

      const orderSnapshot = orderLine.uom_snapshot ?? orderLine.uomSnapshot
      const orderSnapshotFactor = readSnapshotFactor(orderSnapshot)
      expect(Math.abs(orderSnapshotFactor - 2.5) < 0.0001, 'Order snapshot should preserve historical conversion factor').toBeTruthy()
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
      await deleteCatalogProductIfExists(request, token, productId)
      if (token && conversionId) {
        try {
          await apiRequest(
            request,
            'DELETE',
            `/api/catalog/product-unit-conversions?id=${encodeURIComponent(conversionId)}`,
            { token },
          )
        } catch {
          // ignore cleanup failures
        }
      }
    }
  })
})

