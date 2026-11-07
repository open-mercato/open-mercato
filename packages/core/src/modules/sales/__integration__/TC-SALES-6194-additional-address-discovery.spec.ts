/**
 * TC-SALES-6194: adding an additional address is one obvious path
 *
 * On a quote whose customer has no saved addresses, "Add address" opens the new-address
 * fields straight away (no empty select, no toggle to discover) and the form submits as
 * "Save address". Once the customer has a saved address, the form offers a
 * "Saved address / New address" choice with the saved address first.
 *
 * Fixtures: one person, one quote and (second case) one customer address, created through
 * the API and removed in `finally`.
 */
import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = { dependsOnModules: ['sales', 'customers'] }

test.describe('TC-SALES-6194: additional address discovery', () => {
  test('a customer without saved addresses lands on the address fields and saves one', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let personId: string | null = null
    let quoteId: string | null = null

    try {
      personId = await createPersonFixture(request, token, {
        firstName: 'NoAddress',
        lastName: `Customer ${stamp}`,
        displayName: `NoAddress Customer ${stamp}`,
      })
      const create = await apiRequest(request, 'POST', '/api/sales/quotes', {
        token,
        data: { currencyCode: 'USD', customerEntityId: personId },
      })
      expect(create.status()).toBe(201)
      quoteId = (await readJsonSafe<{ id?: string }>(create))?.id ?? null
      expect(typeof quoteId).toBe('string')

      await login(page)
      await page.goto(`/backend/sales/quotes/${encodeURIComponent(quoteId as string)}`, { waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: 'Addresses' }).click()

      const addButtons = page.getByRole('button', { name: 'Add address', exact: true })
      await expect(addButtons, 'one entry point while the list is empty').toHaveCount(1)
      await addButtons.first().click()

      // The document's own shipping and billing panels sit on the same tab, so look inside the form.
      const form = page.getByTestId('additional-address-form')
      await expect(form.getByRole('radiogroup', { name: 'Address source' }), 'no choice to make without saved addresses').toHaveCount(0)
      await expect(form.getByRole('switch', { name: 'Define new address' }), 'no toggle hides the fields').toHaveCount(0)
      const line1 = form.getByRole('textbox', { name: 'Address line 1' })
      await expect(line1, 'the fields are the first thing shown').toBeVisible()
      await form.getByRole('textbox', { name: 'Label' }).fill(`Site ${stamp}`)
      await line1.fill('12 Discovery Street')
      await expect(line1).toHaveValue('12 Discovery Street')
      await form.getByRole('textbox', { name: 'City' }).fill('London')
      await form.getByRole('textbox', { name: 'Postal code' }).fill('SW1A 1AA')

      const saved = page.waitForResponse(
        (response) => new URL(response.url()).pathname === '/api/sales/document-addresses' && response.request().method() === 'POST',
      )
      await form.getByRole('button', { name: 'Save address', exact: true }).click()
      expect((await saved).status(), 'the typed address is assigned to the document').toBe(201)
      await expect(page.getByText(`Site ${stamp}`)).toBeVisible()
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })

  test('a customer with a saved address gets the saved-or-new choice, saved first', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let personId: string | null = null
    let addressId: string | null = null
    let quoteId: string | null = null

    try {
      personId = await createPersonFixture(request, token, {
        firstName: 'Saved',
        lastName: `Address ${stamp}`,
        displayName: `Saved Address ${stamp}`,
      })
      const address = await apiRequest(request, 'POST', '/api/customers/addresses', {
        token,
        data: {
          entityId: personId,
          name: `Warehouse ${stamp}`,
          purpose: 'Shipping',
          addressLine1: '100 QA Street',
          city: 'Austin',
          postalCode: '78701',
          country: 'US',
          isPrimary: true,
        },
      })
      expect(address.status()).toBe(201)
      addressId = (await readJsonSafe<{ id?: string }>(address))?.id ?? null
      const create = await apiRequest(request, 'POST', '/api/sales/quotes', {
        token,
        data: { currencyCode: 'USD', customerEntityId: personId },
      })
      expect(create.status()).toBe(201)
      quoteId = (await readJsonSafe<{ id?: string }>(create))?.id ?? null

      await login(page)
      await page.goto(`/backend/sales/quotes/${encodeURIComponent(quoteId as string)}`, { waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: 'Addresses' }).click()
      await page.getByRole('button', { name: 'Add address', exact: true }).first().click()

      const form = page.getByTestId('additional-address-form')
      const source = form.getByRole('radiogroup', { name: 'Address source' })
      await expect(source).toBeVisible()
      await expect(source.getByRole('radio', { name: 'Saved address' })).toHaveAttribute('aria-checked', 'true')
      await expect(form.getByRole('textbox', { name: 'Address line 1' })).toHaveCount(0)

      await source.getByRole('radio', { name: 'New address' }).click()
      await expect(form.getByRole('textbox', { name: 'Address line 1' })).toBeVisible()
      await expect(form.getByRole('button', { name: 'Save address', exact: true })).toBeVisible()
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
      await deleteEntityIfExists(request, token, '/api/customers/addresses', addressId)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })
})
