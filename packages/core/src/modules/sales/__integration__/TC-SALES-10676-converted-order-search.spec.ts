import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createSalesOrderFixture,
  createSalesQuoteFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/helpers/integration/salesFixtures'

async function listOrders(request: APIRequestContext, token: string, filters: Record<string, string>) {
  const query = new URLSearchParams({ sortField: 'createdAt', sortDir: 'desc', ...filters })
  const response = await apiRequest(request, 'GET', `/api/sales/orders?${query}`, { token })
  expect(response.ok(), `Failed to list orders: ${response.status()}`).toBeTruthy()
  return ((await response.json()) as { items: Array<{ id: string; orderNumber: string }> }).items
}

test('TC-SALES-10676: finds converted orders by their full and partial number', async ({ request }) => {
  const token = await getAuthToken(request)
  let directOrderId: string | undefined
  let quoteId: string | undefined
  let convertedOrderId: string | undefined

  try {
    directOrderId = await createSalesOrderFixture(request, token)
    const [directOrder] = await listOrders(request, token, { id: directOrderId })
    await expect.poll(async () => (
      await listOrders(request, token, { search: directOrder.orderNumber })
    ).map((order) => order.id)).toContain(directOrderId)

    quoteId = await createSalesQuoteFixture(request, token)
    const line = await apiRequest(request, 'POST', '/api/sales/quote-lines', {
      token,
      data: {
        quoteId,
        name: 'Search regression line',
        quantity: 1,
        quantityUnit: 'pc',
        currencyCode: 'USD',
        unitPriceNet: 10,
      },
    })
    expect(line.ok(), `Failed to create quote line: ${line.status()}`).toBeTruthy()

    const converted = await apiRequest(request, 'POST', '/api/sales/quotes/convert', {
      token,
      data: { quoteId },
    })
    expect(converted.ok(), `Failed to convert quote: ${converted.status()}`).toBeTruthy()
    const { orderId } = (await converted.json()) as { orderId: string }
    convertedOrderId = orderId
    const [convertedOrder] = await listOrders(request, token, { id: orderId })
    expect(convertedOrder.orderNumber).toBeTruthy()

    for (const search of [convertedOrder.orderNumber, convertedOrder.orderNumber.slice(0, -1)]) {
      await expect.poll(async () => (
        await listOrders(request, token, { search })
      ).map((order) => order.id)).toContain(orderId)
    }

    const { tenantId, organizationId } = getTokenContext(token)
    await expect.poll(() => withClient(async (client) => {
      const result = await client.query(
        `select 1 from search_tokens
          where entity_type = 'sales:sales_order' and field = 'order_number'
            and tenant_id = $1 and organization_id = $2 and entity_id = $3
          limit 1`,
        [tenantId, organizationId, orderId],
      )
      return result.rowCount
    })).toBe(1)
  } finally {
    if (convertedOrderId) await deleteSalesEntityIfExists(request, token, '/api/sales/orders', convertedOrderId)
    if (quoteId) await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
    if (directOrderId) await deleteSalesEntityIfExists(request, token, '/api/sales/orders', directOrderId)
  }
})
