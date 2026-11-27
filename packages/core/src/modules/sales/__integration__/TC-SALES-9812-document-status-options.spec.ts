import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createSalesOrderFixture,
  createSalesQuoteFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/helpers/integration/salesFixtures'

test('TC-SALES-9812: offers Sent only on quotes and saves an available order status', async ({ page, request }) => {
  const token = await getAuthToken(request, 'admin')
  const statusesPath = '/api/sales/order-statuses'
  const changedStatus = { value: `qa_${randomUUID().replaceAll('-', '')}`, label: 'QA order status' }
  let statusId: string | null = null
  let orderId: string | null = null
  let quoteId: string | null = null

  try {
    const createdStatus = await apiRequest(request, 'POST', statusesPath, { token, data: changedStatus })
    expect(createdStatus.ok()).toBeTruthy()
    statusId = (await readJsonSafe<{ id?: string }>(createdStatus))?.id ?? null
    expect(statusId).toBeTruthy()
    orderId = await createSalesOrderFixture(request, token)
    quoteId = await createSalesQuoteFixture(request, token)

    await login(page, 'admin')
    const statuses = [
      { id: randomUUID(), value: 'sent', label: 'Sent' },
      { id: statusId, ...changedStatus },
    ]
    await page.route((url) => url.pathname === statusesPath, (route) => route.fulfill({ json: { items: statuses } }))

    const main = page.getByRole('main')
    const statusCard = main.getByRole('button', { name: /^Status .+ Edit$/ })
    const statusPicker = main
      .getByRole('link', { name: 'Manage statuses', exact: true })
      .locator('../..')
      .getByRole('combobox')
    const menu = page.getByRole('listbox')
    const sent = menu.getByRole('option', { name: 'Sent', exact: true })
    const allowedStatus = menu.getByRole('option', { name: changedStatus.label, exact: true })

    await page.goto(`/backend/sales/orders/${orderId}`)
    await statusCard.click()
    await statusPicker.click()
    await expect(allowedStatus).toBeVisible()
    await expect(sent).toHaveCount(0)
    await allowedStatus.click()
    const [saved] = await Promise.all([
      page.waitForResponse((response) =>
        response.request().method() === 'PUT' && new URL(response.url()).pathname === '/api/sales/orders'
      ),
      main.getByRole('button', { name: /^Save\b/ }).click(),
    ])
    expect(saved.ok()).toBeTruthy()
    await expect(statusCard).toContainText(changedStatus.label)

    await page.goto(`/backend/sales/quotes/${quoteId}`)
    await statusCard.click()
    await statusPicker.click()
    await expect(sent).toBeVisible()
    await sent.click()
    await main.getByRole('button', { name: 'Cancel', exact: true }).filter({ hasNotText: 'Cancel' }).click()
    await expect(statusCard).toBeVisible()
    await expect(statusCard).not.toContainText('Sent')
  } finally {
    await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
    await deleteSalesEntityIfExists(request, token, statusesPath, statusId)
  }
})
