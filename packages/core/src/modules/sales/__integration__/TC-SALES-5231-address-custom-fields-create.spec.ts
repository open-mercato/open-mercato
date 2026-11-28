import { randomUUID } from 'node:crypto'
import { expect, test, type Request } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = { dependsOnModules: ['sales', 'customers', 'entities'] }

const DEFINITIONS = '/api/entities/definitions'
const SALES_HOST = 'sales:sales_document_address'
const CUSTOMER_HOST = 'customers:customer_address'

test('creates a quote with a copied and overridden shipping field and an independent billing field', async ({ page, request }) => {
  test.slow()
  const token = await getAuthToken(request, 'admin')
  const stamp = randomUUID().replaceAll('-', '')
  const key = `delivery_ref_${stamp}`
  const fieldLabel = `Delivery reference ${stamp}`
  const customerName = `Address custom fields ${stamp}`
  const sourceValue = 'Use the south entrance'
  const shippingValue = 'Call at the south entrance'
  const billingValue = 'Invoice recipient reference'
  let customerId: string | null = null
  let addressId: string | null = null
  let quoteId: string | null = null
  const definitionRequests: Request[] = []
  const recordDefinitionRequest = (entry: Request) => {
    const url = new URL(entry.url())
    if (entry.method() === 'GET' && url.pathname === DEFINITIONS && url.searchParams.getAll('entityId').includes(SALES_HOST)) {
      definitionRequests.push(entry)
    }
  }

  try {
    for (const entityId of [CUSTOMER_HOST, SALES_HOST]) {
      const definition = await apiRequest(request, 'POST', DEFINITIONS, {
        token,
        data: { entityId, key, kind: 'text', configJson: { label: fieldLabel } },
      })
      expect(definition.status()).toBe(200)
    }
    customerId = await createCompanyFixture(request, token, customerName)
    const address = await apiRequest(request, 'POST', '/api/customers/addresses', {
      token,
      data: { entityId: customerId, addressLine1: '17 Test Drive', name: 'Warehouse', isPrimary: true, customValues: { [key]: sourceValue } },
    })
    expect(address.status()).toBe(201)
    addressId = expectId((await readJsonSafe<{ id: string }>(address))?.id, 'saved customer address id')
    await login(page, 'admin')
    page.on('request', recordDefinitionRequest)
    await page.goto('/backend/sales/documents/create?kind=quote', { waitUntil: 'domcontentloaded' })

    const search = page.getByPlaceholder('Search customers…')
    const customer = page.getByRole('option', { name: customerName })
    await expect(async () => {
      await search.fill('')
      await search.fill(customerName)
      await expect(customer).toBeVisible({ timeout: 4_000 })
    }).toPass({ timeout: 20_000 })
    await customer.click()

    const shipping = page.getByRole('group', { name: 'Shipping address' })
    const billing = page.getByRole('group', { name: 'Billing address' })
    await shipping.getByRole('combobox').first().click()
    await page.getByRole('option', { name: /Warehouse|17 Test Drive/ }).click()
    const shippingField = shipping.getByRole('textbox', { name: fieldLabel, exact: true })
    await expect(shippingField).toHaveValue(sourceValue)
    const requestsAfterShipping = definitionRequests.length
    expect(requestsAfterShipping).toBeGreaterThan(0)
    await shippingField.fill(shippingValue)
    await billing.getByRole('switch', { name: 'Same as shipping' }).click()
    await billing.getByRole('switch', { name: 'Define new address' }).click()
    await billing.getByRole('textbox', { name: /Address line 1|Street/ }).fill('19 Billing Drive')
    await billing.getByRole('textbox', { name: fieldLabel, exact: true }).fill(billingValue)
    await expect(shippingField).toHaveValue(shippingValue)
    expect(definitionRequests).toHaveLength(requestsAfterShipping)

    const createResponse = page.waitForResponse((entry) => (
      entry.request().method() === 'POST' && new URL(entry.url()).pathname === '/api/sales/quotes'
    ))
    await page.getByRole('button', { name: 'Create', exact: true }).last().click()
    const saved = await createResponse
    expect(saved.status()).toBe(201)
    expect(saved.request().postDataJSON()).toMatchObject({
      shippingAddressId: addressId,
      copyShippingAddressCustomValues: true,
      shippingAddressCustomValues: { [key]: shippingValue },
      billingAddressCustomValues: { [key]: billingValue },
    })
    expect(saved.request().postDataJSON()).not.toHaveProperty('copyBillingAddressCustomValues')
    const quoteResult = (await saved.json()) as { id?: string; quoteId?: string }
    quoteId = expectId(quoteResult.id ?? quoteResult.quoteId, 'created quote id')
    await expect(page).toHaveURL(new RegExp(`/backend/sales/documents/${quoteId}`))

    const detail = await apiRequest(request, 'GET', `/api/sales/quotes?id=${quoteId}`, { token })
    expect(detail.status()).toBe(200)
    expect(await readJsonSafe<{ items: Record<string, unknown>[] }>(detail)).toMatchObject({
      items: [expect.objectContaining({
        shippingAddressCustomValues: { [key]: shippingValue },
        billingAddressCustomValues: { [key]: billingValue },
      })],
    })
    const source = await apiRequest(request, 'GET', `/api/customers/addresses?id=${addressId}`, { token })
    expect(await readJsonSafe<{ items: Record<string, unknown>[] }>(source)).toMatchObject({
      items: [expect.objectContaining({ customValues: { [key]: sourceValue } })],
    })
  } finally {
    page.off('request', recordDefinitionRequest)
    await deleteEntityIfExists(request, token, '/api/sales/quotes', quoteId)
    await deleteEntityIfExists(request, token, '/api/customers/addresses', addressId)
    await deleteEntityIfExists(request, token, '/api/customers/companies', customerId)
    for (const entityId of [SALES_HOST, CUSTOMER_HOST]) await apiRequest(request, 'DELETE', DEFINITIONS, { token, data: { entityId, key } })
  }
})
