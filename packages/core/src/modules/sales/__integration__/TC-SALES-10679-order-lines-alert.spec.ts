import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'

test.use({ viewport: { width: 1366, height: 768 } })

test('reveals and focuses the missing-lines alert every time an empty order is submitted', async ({ page, request }) => {
  const token = await getAuthToken(request, 'admin')
  const customerName = `QA Order Lines ${Date.now()}`
  const customerId = await createCompanyFixture(request, token, customerName)
  let orderCreateRequests = 0

  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/sales/orders') {
      orderCreateRequests += 1
    }
  })

  try {
    await login(page, 'admin')
    await page.goto('/backend/sales/documents/create?kind=order')
    await page.getByPlaceholder('Search customers…').fill(customerName)
    await page.getByRole('option').getByText(customerName, { exact: true }).click()

    const createButtons = page.getByRole('main').getByRole('button', { name: 'Create', exact: true })
    await expect(createButtons).toHaveCount(2)
    const headerCreate = createButtons.first()
    const footerCreate = createButtons.last()
    const alert = page.getByRole('alert').filter({
      hasText: /^Add at least one line item before creating the order\.$/,
    })
    await expect(alert).toHaveCount(0)

    for (const createButton of [headerCreate, headerCreate, footerCreate]) {
      await createButton.focus()
      await expect(createButton).toBeFocused()
      await createButton.click()
      await expect(alert).toBeFocused()
      await expect(alert).toBeInViewport({ ratio: 1 })
    }

    expect(orderCreateRequests).toBe(0)
  } finally {
    await deleteEntityIfExists(request, token, '/api/customers/companies', customerId)
  }
})
