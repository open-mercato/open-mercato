/**
 * TC-SALES-056: a canceled quote no longer offers "Convert to order"
 *
 * - the quote detail page disables "Convert to order" once the quote status is Canceled
 * - the same action stays enabled for a quote that is not canceled
 * - the convert API keeps converting a canceled quote for now (deprecation period)
 *
 * Fixtures: quotes created through the API; quotes and any converted order are removed in `finally`.
 */
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createSalesQuoteFixture, deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'

export const integrationMeta = { dependsOnModules: ['sales'] }

async function resolveCanceledStatusId(request: APIRequestContext, token: string): Promise<string> {
  const response = await apiRequest(request, 'GET', '/api/sales/order-statuses?pageSize=100', { token })
  expect(response.status()).toBe(200)
  const items = (await readJsonSafe<{ items?: Array<{ id?: string; value?: string }> }>(response))?.items ?? []
  return expectId(items.find((item) => item.value === 'canceled')?.id, 'canceled status entry')
}

async function cancelQuote(request: APIRequestContext, token: string, quoteId: string, statusEntryId: string): Promise<void> {
  const response = await apiRequest(request, 'PUT', '/api/sales/quotes', { token, data: { id: quoteId, statusEntryId } })
  expect(response.status()).toBe(200)
}

async function openConvertAction(page: Page, quoteId: string): Promise<Locator> {
  await page.goto(`/backend/sales/quotes/${encodeURIComponent(quoteId)}`, { waitUntil: 'domcontentloaded' })
  const convertAction = page.getByRole('menuitem', { name: 'Convert to order', exact: true })
  await expect(async () => {
    await page.mouse.move(0, 0)
    await page.getByRole('button', { name: 'Actions', exact: true }).hover()
    await expect(convertAction).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
  return convertAction
}

test.describe('TC-SALES-056: converting a canceled quote', () => {
  test('the detail page disables Convert to order for a canceled quote only', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    let canceledQuoteId: string | null = null
    let openQuoteId: string | null = null

    try {
      canceledQuoteId = await createSalesQuoteFixture(request, token)
      openQuoteId = await createSalesQuoteFixture(request, token)
      await cancelQuote(request, token, canceledQuoteId, await resolveCanceledStatusId(request, token))

      await login(page, 'admin')
      await expect(await openConvertAction(page, canceledQuoteId), 'a canceled quote cannot be converted from the UI').toBeDisabled()
      await expect(await openConvertAction(page, openQuoteId), 'other quotes keep the action').toBeEnabled()
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', canceledQuoteId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', openQuoteId)
    }
  })

  test('the convert API still converts a canceled quote during the deprecation period', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let quoteId: string | null = null
    let orderId: string | null = null

    try {
      quoteId = await createSalesQuoteFixture(request, token)
      await cancelQuote(request, token, quoteId, await resolveCanceledStatusId(request, token))

      const convert = await apiRequest(request, 'POST', '/api/sales/quotes/convert', { token, data: { quoteId } })
      const body = await readJsonSafe<{ orderId?: string }>(convert)
      orderId = body?.orderId ?? quoteId
      expect(convert.status(), JSON.stringify(body)).toBe(200)
      expect(body?.orderId).toBe(quoteId)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
    }
  })
})
