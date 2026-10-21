import { expect, test } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'
import { createDealFixture, deleteEntityByBody } from '@open-mercato/core/helpers/integration/crmFixtures'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'

/**
 * TC-SALES-DEAL-001: a sales document can be tied to a CRM deal and found by it.
 *
 * The link is a nullable `deal_id` on both quotes and orders. The deal detail tab
 * reads the documents through the same list routes with `?dealId=`, so the filter
 * is the contract this spec pins: set on create, cleared on update, scoped to the
 * deal (and to the tenant/organization by the route itself).
 */

const QUOTES = '/api/sales/quotes'
const ORDERS = '/api/sales/orders'
const INVOICES = '/api/sales/invoices'
const DEALS = '/api/customers/deals'

async function postDocument(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  path: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequest(request, 'POST', path, { token, data })
  const text = await response.text()
  expect(response.ok(), `POST ${path} failed with ${response.status()}: ${text.slice(0, 500)}`).toBeTruthy()
  const body = JSON.parse(text) as Record<string, unknown>
  const id = [body.id, body.quoteId, body.orderId, body.invoiceId].find(
    (value): value is string => typeof value === 'string' && value.length > 0,
  )
  expect(id, `POST ${path} returned no id`).toBeTruthy()
  return id as string
}

async function listByDeal(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  path: string,
  dealId: string,
): Promise<Array<Record<string, unknown>>> {
  const response = await apiRequest(request, 'GET', `${path}?dealId=${encodeURIComponent(dealId)}&pageSize=100`, { token })
  expect(response.ok(), `GET ${path}?dealId= failed with ${response.status()}`).toBeTruthy()
  const body = (await response.json()) as { items?: Array<Record<string, unknown>> }
  return Array.isArray(body.items) ? body.items : []
}

test.describe('TC-SALES-DEAL-001: deal-linked sales documents', () => {
  test('quotes and orders carry the deal id and filter by it', async ({ request }) => {
    const token = await getAuthToken(request)
    const suffix = `${Date.now()}`
    let dealId: string | null = null
    let quoteId: string | null = null
    let orderId: string | null = null
    let invoiceId: string | null = null

    try {
      dealId = await createDealFixture(request, token, { title: `QA deal documents ${suffix}` })

      quoteId = await postDocument(request, token, QUOTES, {
        currencyCode: 'SAR',
        dealId,
      })
      orderId = await postDocument(request, token, ORDERS, {
        currencyCode: 'SAR',
        dealId,
        lines: [
          {
            currencyCode: 'SAR',
            quantity: 1,
            name: `QA deal line ${suffix}`,
            unitPriceNet: 100,
            unitPriceGross: 115,
          },
        ],
      })

      invoiceId = await postDocument(request, token, INVOICES, {
        currencyCode: 'SAR',
        dealId,
        grandTotalNetAmount: 100,
        grandTotalGrossAmount: 115,
      })

      const quotes = await listByDeal(request, token, QUOTES, dealId)
      expect(quotes.map((item) => item.id)).toContain(quoteId)
      expect(quotes.every((item) => item.dealId === dealId)).toBe(true)

      const orders = await listByDeal(request, token, ORDERS, dealId)
      expect(orders.map((item) => item.id)).toContain(orderId)
      expect(orders.every((item) => item.dealId === dealId)).toBe(true)

      const invoices = await listByDeal(request, token, INVOICES, dealId)
      expect(invoices.map((item) => item.id)).toContain(invoiceId)
      expect(invoices.every((item) => item.deal_id === dealId)).toBe(true)

      const unrelated = await listByDeal(request, token, QUOTES, '00000000-0000-4000-8000-000000000000')
      expect(unrelated).toHaveLength(0)

      const cleared = await apiRequest(request, 'PUT', QUOTES, {
        token,
        data: { id: quoteId, dealId: null },
      })
      expect(cleared.ok(), `PUT ${QUOTES} clearing dealId failed with ${cleared.status()}`).toBeTruthy()
      const afterClear = await listByDeal(request, token, QUOTES, dealId)
      expect(afterClear.map((item) => item.id)).not.toContain(quoteId)
    } finally {
      await deleteSalesEntityIfExists(request, token, INVOICES, invoiceId)
      await deleteSalesEntityIfExists(request, token, ORDERS, orderId)
      await deleteSalesEntityIfExists(request, token, QUOTES, quoteId)
      await deleteEntityByBody(request, token, DEALS, dealId)
    }
  })
})
