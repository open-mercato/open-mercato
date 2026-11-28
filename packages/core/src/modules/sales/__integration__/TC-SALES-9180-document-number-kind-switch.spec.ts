import { expect, test, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'

function waitForNumber(page: Page, kind: 'order' | 'quote') {
  return page.waitForResponse((response) => {
    const request = response.request()
    return new URL(response.url()).pathname === '/api/sales/document-numbers' &&
      request.method() === 'POST' &&
      request.postDataJSON()?.kind === kind
  })
}

test('TC-SALES-9180: switching from Order to Quote saves the generated quote number', async ({ page, request }, testInfo) => {
  const token = await getAuthToken(request)
  let quoteId: string | undefined

  try {
    await login(page)
    const orderNumberResponse = waitForNumber(page, 'order')
    await page.goto('/backend/sales/documents/create?kind=order', { waitUntil: 'domcontentloaded' })
    const orderResponse = await orderNumberResponse
    expect(orderResponse.ok()).toBeTruthy()
    const order = (await orderResponse.json()) as { number: string }
    expect(order.number).toMatch(/\S/)

    const numberInput = page.locator('[data-crud-field-id="documentNumber"]').getByRole('textbox')
    await expect(numberInput).toHaveValue(order.number)
    const quoteNumberResponse = waitForNumber(page, 'quote')
    await page.getByRole('button', { name: 'Quote', exact: true }).click()
    const quoteResponse = await quoteNumberResponse
    expect(quoteResponse.ok()).toBeTruthy()
    const quote = (await quoteResponse.json()) as { number: string }
    expect(quote.number).toMatch(/\S/)
    await expect(numberInput).toHaveValue(quote.number)
    if (process.env.PW_CAPTURE_SCREENSHOTS === '1') {
      await testInfo.attach('quote-number-after-switch', {
        body: await page.screenshot(),
        contentType: 'image/png',
      })
    }

    const createResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/sales/quotes' && response.request().method() === 'POST',
    )
    await page.getByRole('button', { name: 'Create', exact: true }).last().click()
    const created = await createResponsePromise
    expect(created.status()).toBe(201)
    const createBody = (await created.json()) as { id?: string }
    quoteId = createBody.id
    expect(quoteId).toBeTruthy()

    const saved = await apiRequest(request, 'GET', `/api/sales/quotes?id=${encodeURIComponent(quoteId ?? '')}`, { token })
    expect(saved.status()).toBe(200)
    const savedBody = (await saved.json()) as { items?: Array<{ id: string; quoteNumber: string }> }
    expect(savedBody.items?.find((item) => item.id === quoteId)?.quoteNumber).toBe(quote.number)
  } finally {
    if (quoteId) {
      await apiRequest(request, 'DELETE', '/api/sales/quotes', { token, data: { id: quoteId } })
    }
  }
})
