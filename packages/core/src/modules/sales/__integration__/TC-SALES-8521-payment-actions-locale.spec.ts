import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

export const integrationMeta = { dependsOnModules: ['sales', 'payment_gateways'] }

async function listRecords(request: APIRequestContext, token: string, path: string) {
  const response = await apiRequest(request, 'GET', path, { token })
  expect(response.status(), `GET ${path}`).toBe(200)
  const body = await readJsonSafe<{ items?: Record<string, unknown>[] }>(response)
  expect(Array.isArray(body?.items), `List response from ${path}`).toBe(true)
  return body?.items ?? []
}

async function createRecord(
  request: APIRequestContext,
  token: string,
  path: string,
  data: Record<string, unknown>,
) {
  const response = await apiRequest(request, 'POST', path, { token, data, retryTransport: false })
  expect(response.status(), `POST ${path}: ${await response.text()}`).toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  expect(typeof body?.id).toBe('string')
  return body!.id!
}

async function deleteOwnedRecord(
  request: APIRequestContext,
  token: string,
  orderId: string,
  path: '/api/sales/payments' | '/api/sales/orders',
  id: string,
) {
  const orders = await listRecords(request, token, `/api/sales/orders?id=${orderId}`)
  const order = orders.find((record) => record.id === orderId)
  const version = order?.updatedAt ?? order?.updated_at
  expect(typeof version, 'Fresh parent order version for the sales aggregate guard').toBe('string')
  const response = await apiRequest(request, 'DELETE', path, {
    token,
    data: { id, ...(path === '/api/sales/payments' ? { orderId } : {}) },
    headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: new Date(String(version)).toISOString() },
    retryTransport: false,
  })
  expect(response.status(), `DELETE ${path}: ${await response.text()}`).toBe(200)
  const query = path === '/api/sales/payments' ? `orderId=${orderId}` : `id=${id}`
  const remaining = await listRecords(request, token, `${path}?${query}`)
  expect(remaining.some((record) => record.id === id), `Owned record ${id} was removed`).toBe(false)
}

async function assertPaymentColumns(
  page: Page,
  reference: string,
  labels: { actions: string; open: string; gateway: string; method: string },
) {
  const referenceCell = page.getByRole('cell', { name: reference, exact: true })
  await expect(referenceCell).toBeVisible()
  const table = page.getByRole('table').filter({ has: referenceCell })
  const headers = (await table.getByRole('columnheader').allTextContents()).map((text) => text.trim())
  const actionsIndex = headers.indexOf(labels.actions)
  const gatewayIndex = headers.indexOf(labels.gateway)
  expect(headers.filter((header) => header === labels.actions)).toHaveLength(1)
  expect(gatewayIndex).toBeGreaterThanOrEqual(0)
  expect(gatewayIndex).toBe(headers.indexOf('Status') + 1)
  expect(actionsIndex).toBeGreaterThan(gatewayIndex)
  const row = table.getByRole('row').filter({ has: referenceCell })
  const cells = row.getByRole('cell')
  await expect(cells).toHaveCount(headers.length)
  await expect(cells.nth(gatewayIndex)).toHaveText('—')
  await expect(cells.nth(gatewayIndex)).toHaveText(await cells.nth(headers.indexOf(labels.method)).innerText())
  const menuButton = cells.nth(actionsIndex).getByRole('button', { name: labels.open, exact: true })
  await expect(menuButton).toBeVisible()
  return { actionsIndex, table, menuButton }
}

test('TC-SALES-8521: real English and Polish headers label the payment row-menu column', async ({ page, request }, testInfo) => {
  const token = await getAuthToken(request, 'admin')
  const originalLocale = (await page.context().cookies()).find((cookie) => cookie.name === 'locale')?.value ?? 'en'
  const reference = `TC-SALES-8521-${randomUUID()}`
  let orderId: string | null = null
  let paymentId: string | null = null

  try {
    orderId = await createRecord(request, token, '/api/sales/orders', {
      currencyCode: 'PLN',
      lines: [{ name: reference, currencyCode: 'PLN', quantity: 1, unitPriceNet: 100, unitPriceGross: 100 }],
    })
    paymentId = await createRecord(request, token, '/api/sales/payments', {
      orderId, amount: 25, currencyCode: 'PLN', paymentReference: reference,
    })
    await login(page, 'admin')
    expect((await page.request.post('/api/auth/locale', { data: { locale: 'en' } })).status()).toBe(200)
    await page.goto(`/backend/sales/orders/${orderId}`, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await page.getByRole('button', { name: 'Payments', exact: true }).click()
    const english = await assertPaymentColumns(page, reference, {
      actions: 'Actions', open: 'Open actions', gateway: 'Gateway status', method: 'Method',
    })
    await testInfo.attach('english-payments', { body: await english.table.screenshot(), contentType: 'image/png' })
    await english.menuButton.click()
    await expect(page.getByRole('menuitem', { name: 'Edit payment', exact: true })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Delete payment', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')

    await page.getByTestId('profile-dropdown-trigger').click()
    await page.getByRole('menuitem', { name: 'Language English', exact: true }).click()
    const localeResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/auth/locale' && response.request().method() === 'POST',
    )
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.getByRole('button', { name: 'Polski', exact: true }).click(),
    ])
    expect((await localeResponse).status()).toBe(200)
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl')
    expect((await page.context().cookies()).find((cookie) => cookie.name === 'locale')?.value).toBe('pl')
    await page.getByRole('button', { name: 'Płatności', exact: true }).click()
    const polish = await assertPaymentColumns(page, reference, {
      actions: 'Akcje', open: 'Otwórz akcje', gateway: 'Status bramki', method: 'Metoda',
    })
    expect(polish.actionsIndex).toBe(english.actionsIndex)
    await testInfo.attach('polish-payments', { body: await polish.table.screenshot(), contentType: 'image/png' })
    await polish.menuButton.click()
    await expect(page.getByRole('menuitem', { name: 'Edytuj płatność', exact: true })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Usuń płatność', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
  } finally {
    try {
      try {
        if (orderId && paymentId) await deleteOwnedRecord(request, token, orderId, '/api/sales/payments', paymentId)
      } finally {
        if (orderId) await deleteOwnedRecord(request, token, orderId, '/api/sales/orders', orderId)
      }
    } finally {
      expect((await page.request.post('/api/auth/locale', { data: { locale: originalLocale } })).status()).toBe(200)
    }
  }
})
