import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

const BASE_URL = process.env.BASE_URL?.trim() || null

function resolveUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path
}

test('TC-SALES-ADDR-CONTACT-002: the document form persists address contact fields', async ({
  page,
  request,
}) => {
  const token = await getAuthToken(request)
  let quoteId: string | null = null

  try {
    await login(page)
    const numberResponsePromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/sales/document-numbers' &&
        response.request().method() === 'POST',
    )
    await page.goto(resolveUrl('/backend/sales/documents/create?kind=quote'), {
      waitUntil: 'domcontentloaded',
    })
    const numberResponse = await numberResponsePromise
    expect(numberResponse.ok(), 'initial document number generation should succeed').toBeTruthy()
    const numberBody = (await numberResponse.json()) as { number: string }
    expect(numberBody.number, 'initial generation should return a document number').toMatch(/\S/)
    await expect(
      page.locator('[data-crud-field-id="documentNumber"]').getByRole('textbox'),
    ).toHaveValue(numberBody.number)
    await expect(page.getByRole('button', { name: 'Generate' })).toBeEnabled()
    const newAddressSwitch = page.getByRole('switch', { name: 'Define new address' })
    await newAddressSwitch.click()
    await expect(newAddressSwitch).toBeChecked()
    await page.getByRole('textbox', { name: 'Label' }).fill('QA create contact fixture')
    await page.getByRole('textbox', { name: 'Address line 1' }).fill('12 Browser Street')
    await page.getByRole('textbox', { name: 'City' }).fill('London')
    await page.getByRole('textbox', { name: 'Postal code' }).fill('SW1A 1AA')

    const taxTypePicker = page.getByRole('combobox', { name: 'Tax id type' })
    await expect(taxTypePicker).toBeVisible()
    await taxTypePicker.click()
    await page.getByRole('option', { name: 'EU VAT' }).click()
    await page.getByRole('textbox', { name: 'Tax number' }).fill('GB123456789')
    await page.getByRole('textbox', { name: 'Phone' }).fill('+44 20 1234 5678')

    const createResponsePromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/sales/quotes' &&
        response.request().method() === 'POST',
    )
    await page.getByRole('button', { name: 'Create', exact: true }).last().click()
    const createResponse = await createResponsePromise
    expect(createResponse.status(), 'quote creation should return 201').toBe(201)
    const createBody = (await createResponse.json()) as { id?: string }
    quoteId = createBody.id ?? null
    expect(quoteId, 'quote creation should return an id').toBeTruthy()

    const readResponse = await request.fetch(
      resolveUrl(`/api/sales/quotes?id=${encodeURIComponent(quoteId as string)}`),
      { headers: { Authorization: `Bearer ${token}` } },
    )
    expect(readResponse.status(), 'created quote should be readable').toBe(200)
    const readBody = (await readResponse.json()) as { items?: Array<Record<string, unknown>> }
    const quote = readBody.items?.[0]
    expect(quote, 'response should include the created quote').toBeTruthy()
    expect(quote?.shippingAddressSnapshot ?? quote?.shipping_address_snapshot).toMatchObject({
      phone: '+44 20 1234 5678',
      taxId: 'GB123456789',
      taxIdType: 'eu_vat',
    })
    expect(quote?.billingAddressSnapshot ?? quote?.billing_address_snapshot).toMatchObject({
      phone: '+44 20 1234 5678',
      taxId: 'GB123456789',
      taxIdType: 'eu_vat',
    })
  } finally {
    if (quoteId) {
      await request.fetch(resolveUrl('/api/sales/quotes'), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { id: quoteId },
      })
    }
  }
})
