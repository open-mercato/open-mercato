import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  deleteGeneralEntityIfExists,
  expectId,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'

/**
 * TC-SALES-050: service lines on quotes and orders
 *
 * Verifies:
 * - a quote line with `kind: 'service'` stores the catalog `serviceId` and catalog snapshot
 * - a line referencing a service without the service kind is rejected (400)
 * - a line referencing both a service and a product is rejected (400)
 * - quote → order conversion keeps `service_id` and `catalog_snapshot.service` on the order line
 *
 * Self-contained: the catalog service, quote and order are created through the API and removed in `finally`.
 */
export const integrationMeta = { dependsOnModules: ['sales', 'catalog'] }

type LineRow = {
  id: string
  kind?: string | null
  service_id?: string | null
  product_id?: string | null
  catalog_snapshot?: { service?: { id?: string; title?: string } } | null
  name?: string | null
  quantity?: string | number | null
}

async function readLines(
  request: APIRequestContext,
  token: string,
  resource: 'quote-lines' | 'order-lines',
  parentParam: 'quoteId' | 'orderId',
  parentId: string,
): Promise<LineRow[]> {
  const path = `/api/sales/${resource}?${parentParam}=${encodeURIComponent(parentId)}&pageSize=100`
  const response = await apiRequest(request, 'GET', path, { token })
  expect(response.status(), `GET /api/sales/${resource} should return 200`).toBe(200)
  return (await readJsonSafe<{ items?: LineRow[] }>(response))?.items ?? []
}

test.describe('TC-SALES-050: service lines', () => {
  test('a service line keeps its catalog service reference through quote conversion', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const stamp = `${Date.now()}_${randomUUID().slice(0, 8)}`
    const serviceTitle = `QA TC-SALES-050 service ${stamp}`
    let serviceId: string | null = null
    let quoteId: string | null = null
    let orderId: string | null = null

    try {
      const serviceResponse = await apiRequest(request, 'POST', '/api/catalog/services', {
        token,
        data: { title: serviceTitle, defaultPriceAmount: 80, defaultPriceCurrencyCode: 'USD' },
      })
      expect(
        serviceResponse.status(),
        `POST /api/catalog/services should return 201: ${(await serviceResponse.text()).slice(0, 500)}`,
      ).toBe(201)
      serviceId = expectId(
        (await readJsonSafe<{ id?: string }>(serviceResponse))?.id,
        'service create response should carry the id',
      )

      const quoteResponse = await apiRequest(request, 'POST', '/api/sales/quotes', {
        token,
        data: { currencyCode: 'USD' },
      })
      expect(quoteResponse.status(), 'POST /api/sales/quotes should return 201').toBe(201)
      quoteId = expectId((await readJsonSafe<{ id?: string }>(quoteResponse))?.id, 'quote create response should carry the id')

      const lineResponse = await apiRequest(request, 'POST', '/api/sales/quote-lines', {
        token,
        data: {
          quoteId,
          kind: 'service',
          serviceId,
          name: serviceTitle,
          quantity: 2,
          unitPriceNet: 80,
          currencyCode: 'USD',
          catalogSnapshot: { service: { id: serviceId, title: serviceTitle } },
        },
      })
      expect(
        lineResponse.status(),
        `POST /api/sales/quote-lines (service) should return 201: ${(await lineResponse.text()).slice(0, 500)}`,
      ).toBe(201)

      const quoteLines = await readLines(request, token, 'quote-lines', 'quoteId', quoteId)
      expect(quoteLines).toHaveLength(1)
      const quoteLine = quoteLines[0]
      expect(quoteLine.kind).toBe('service')
      expect(quoteLine.service_id).toBe(serviceId)
      expect(quoteLine.product_id ?? null).toBeNull()
      expect(Number(quoteLine.quantity)).toBe(2)
      expect(quoteLine.catalog_snapshot?.service?.id).toBe(serviceId)

      const serviceOnProductLine = await apiRequest(request, 'POST', '/api/sales/quote-lines', {
        token,
        data: {
          quoteId,
          kind: 'product',
          serviceId,
          name: 'QA mismatched product line',
          quantity: 1,
          unitPriceNet: 10,
          currencyCode: 'USD',
        },
      })
      expect(serviceOnProductLine.status(), 'a serviceId on a product line is rejected').toBe(400)

      const productOnServiceLine = await apiRequest(request, 'POST', '/api/sales/quote-lines', {
        token,
        data: {
          quoteId,
          kind: 'service',
          serviceId,
          productId: randomUUID(),
          name: 'QA service and product line',
          quantity: 1,
          unitPriceNet: 10,
          currencyCode: 'USD',
        },
      })
      expect(productOnServiceLine.status(), 'a line referencing both a service and a product is rejected').toBe(400)

      expect(
        await readLines(request, token, 'quote-lines', 'quoteId', quoteId),
        'rejected lines must not be persisted',
      ).toHaveLength(1)

      const convertResponse = await apiRequest(request, 'POST', '/api/sales/quotes/convert', {
        token,
        data: { quoteId },
      })
      expect(
        convertResponse.status(),
        `POST /api/sales/quotes/convert should return 200: ${(await convertResponse.text()).slice(0, 500)}`,
      ).toBe(200)
      orderId = expectId(
        (await readJsonSafe<{ orderId?: string }>(convertResponse))?.orderId,
        'convert should return the order id',
      )

      const orderLines = await readLines(request, token, 'order-lines', 'orderId', orderId)
      expect(orderLines).toHaveLength(1)
      const orderLine = orderLines[0]
      expect(orderLine.kind).toBe('service')
      expect(orderLine.service_id).toBe(serviceId)
      expect(orderLine.product_id ?? null).toBeNull()
      expect(orderLine.catalog_snapshot?.service?.id).toBe(serviceId)
      expect(orderLine.catalog_snapshot?.service?.title).toBe(serviceTitle)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
      await deleteGeneralEntityIfExists(request, token, '/api/catalog/services', serviceId)
    }
  })
})
