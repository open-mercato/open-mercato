/**
 * TC-SALES-6196: picking a customer in the sales document form ends the interaction
 *
 * On `/backend/sales/documents/create` the customer picker is a LookupSelect. Verifies:
 * - clicking a result closes the result list and empties the search box
 * - the picked customer shows in a selected summary with Change and Clear actions,
 *   never the raw record id
 * - Change reopens the list with the customer marked as selected
 * - picking fills in the customer's e-mail, and Clear removes the selection and that e-mail
 * - Clear keeps a recipient the user typed over the filled-in e-mail
 *
 * Fixture: one person created through the API and removed in `finally`.
 */
import { test, expect, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'

export const integrationMeta = { dependsOnModules: ['sales', 'customers'] }

// A first keystroke can land before the form hydrates and the fresh person can still be
// indexing, so retype until the search returns it.
async function pickCustomer(page: Page, displayName: string) {
  const search = page.getByPlaceholder('Search customers…')
  const option = page.getByRole('option', { name: new RegExp(displayName) }).first()
  await expect(async () => {
    await search.fill('')
    await search.fill(displayName)
    await expect(option).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 45_000 })
  await option.click()
}

test.describe('TC-SALES-6196: customer picker closes on pick', () => {
  test('closes the list and shows the picked customer with Change and Clear', async ({ page, request }) => {
    test.slow()
    const stamp = Date.now()
    const displayName = `QA 6196 Customer ${stamp}`
    const email = `qa-6196-${stamp}@example.test`
    let token: string | null = null
    let personId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      personId = await createPersonFixture(request, token, { firstName: 'QA', lastName: `Customer ${stamp}`, displayName, primaryEmail: email })
      await login(page, 'admin')

      await page.goto('/backend/sales/documents/create', { waitUntil: 'domcontentloaded' })
      const search = page.getByPlaceholder('Search customers…')
      await expect(search).toBeVisible({ timeout: 60_000 })

      await pickCustomer(page, displayName)

      // The summary row replaces the search box until Change reopens it.
      await expect(page.getByRole('listbox')).toHaveCount(0)
      await expect(search).toHaveCount(0)
      const summary = page.getByTestId('lookup-select-selected')
      await expect(summary).toContainText(displayName)
      await expect(summary).not.toContainText(String(personId))
      const sendTo = page.getByLabel('Send to')
      await expect(sendTo, 'picking the customer fills in their e-mail').toHaveValue(email, { timeout: 30_000 })

      await summary.getByRole('button', { name: 'Change' }).click()
      await expect(page.getByRole('option', { selected: true }).first()).toContainText(displayName, { timeout: 30_000 })
      await expect(search).toBeFocused()

      await page.getByRole('option', { name: new RegExp(displayName) }).first().click()
      await expect(summary).toContainText(displayName)
      await summary.getByRole('button', { name: 'Clear selection' }).click()
      await expect(page.getByTestId('lookup-select-selected')).toHaveCount(0)
      await expect(sendTo, 'the e-mail filled in from the customer goes with it').toHaveValue('')
      await expect(page.getByText(/belongs to/), 'no known-customer notice for the customer just cleared').toHaveCount(0)

      await pickCustomer(page, displayName)
      await expect(sendTo).toHaveValue(email, { timeout: 30_000 })
      const typedRecipient = `qa-6196-typed-${stamp}@example.test`
      await sendTo.fill(typedRecipient)
      await expect(sendTo).toHaveValue(typedRecipient)
      await summary.getByRole('button', { name: 'Clear selection' }).click()
      await expect(page.getByTestId('lookup-select-selected')).toHaveCount(0)
      await expect(sendTo, 'a recipient the user typed is not the filled-in e-mail, so it stays').toHaveValue(typedRecipient)
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })
})
