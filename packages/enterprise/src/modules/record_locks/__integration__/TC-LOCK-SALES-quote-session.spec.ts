import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'
import { getRecordLockSettings, saveRecordLockSettings, type RecordLockSettings } from './helpers/recordLocks'

export const integrationMeta = { dependsOnModules: ['record_locks', 'sales'] }

async function createRecord(request: APIRequestContext, token: string, path: string, data: Record<string, unknown>) {
  const response = await apiRequest(request, 'POST', path, { token, data, retryTransport: false })
  expect(response.status(), `Fixture ${path} creation`).toBe(201)
  return expectId((await readJsonSafe<{ id?: string }>(response))?.id, `Fixture ${path} must return its ID`)
}

function quoteInput() {
  return {
    currencyCode: 'USD',
    customerSnapshot: { customer: { displayName: 'QA 7294', primaryEmail: 'qa-7294@example.test' } },
  }
}

async function openQuote(page: Page, quoteId: string) {
  const acquired = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/record_locks/acquire'
    && response.request().method() === 'POST'
    && response.request().postDataJSON()?.resourceId === quoteId,
  )
  await page.goto(`/backend/sales/quotes/${quoteId}`)
  await expect(page.getByRole('main').getByRole('button', { name: 'Add item', exact: true }).first()).toBeVisible()
  expect((await acquired).status(), 'Enterprise presence must run on the quote').toBe(200)
}

async function addLine(page: Page, taxRateName: string, name: string) {
  await page.getByRole('main').getByRole('button', { name: 'Add item', exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Add line', exact: true })
  await dialog.getByRole('button', { name: 'Custom line', exact: true }).click()
  await dialog.getByRole('combobox').filter({ hasText: 'Gross' }).click()
  await page.getByRole('option', { name: 'Net', exact: true }).click()
  await dialog.getByRole('combobox').filter({ hasText: 'No tax class selected' }).click()
  await page.getByRole('option').filter({ hasText: taxRateName }).click()
  await dialog.getByRole('textbox', { name: 'Optional line name', exact: true }).fill(name)
  await dialog.getByRole('textbox', { name: '0.00', exact: true }).fill('50')
  await dialog.getByRole('textbox', { name: '1', exact: true }).fill('2')
  await dialog.getByRole('button', { name: 'Add item', exact: true }).click()
  await expect(dialog).toBeHidden()
}

async function addAdjustment(page: Page, input: {
  kind: 'Shipping' | 'Surcharge'
  label: string
  taxRateName: string
  net: number
  gross: number
}) {
  const main = page.getByRole('main')
  const add = main.getByRole('button', { name: 'Add adjustment', exact: true }).first()
  if (!(await add.isVisible())) await main.getByRole('button', { name: 'Adjustments', exact: true }).click()
  await add.click()
  const dialog = page.getByRole('dialog', { name: 'Add adjustment', exact: true })
  await expect(dialog.getByText('Loading data…', { exact: true })).toBeHidden()
  await dialog.getByRole('combobox').first().click()
  await page.getByRole('option', { name: input.kind, exact: true }).click()
  await dialog.getByRole('combobox').nth(1).click()
  await page.getByRole('option').filter({ hasText: input.taxRateName }).click()
  await dialog.getByRole('textbox', { name: 'e.g. Shipping fee', exact: true }).fill(input.label)
  await dialog.getByRole('button', { name: 'Fixed amount', exact: true }).click()
  await dialog.getByRole('textbox', { name: '0.00', exact: true }).nth(1).fill(String(input.net))
  await dialog.getByRole('textbox', { name: '0.00', exact: true }).nth(2).fill(String(input.gross))
  await dialog.getByRole('button', { name: 'Add adjustment', exact: true }).click()
  await expect(dialog).toBeHidden()
}

async function readDocument(request: APIRequestContext, token: string, resource: 'quotes' | 'orders', id: string) {
  const response = await apiRequest(request, 'GET', `/api/sales/${resource}?id=${encodeURIComponent(id)}`, { token })
  expect(response.status()).toBe(200)
  const body = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(response)
  const record = body?.items?.find((item) => item.id === id)
  expect(record, 'The document must remain readable').toBeTruthy()
  return record ?? {}
}

test.describe('TC-LOCK-SALES-quote-session: local mutations and stale sessions', () => {
  test('P0 immediately converts after adding a line, shipping and surcharge', async ({ page, request }, testInfo) => {
    const token = await getAuthToken(request, 'admin')
    const settingsToken = await getAuthToken(request, 'superadmin')
    const suffix = `${Date.now()}-${testInfo.workerIndex}`
    const taxRateName = `QA 7294 tax ${suffix}`
    let previousSettings: RecordLockSettings | null = null
    let quoteId: string | null = null
    let orderId: string | null = null
    let taxRateId: string | null = null
    const validated: number[] = []
    page.on('response', (response) => {
      if (new URL(response.url()).pathname === '/api/record_locks/validate') validated.push(response.status())
    })

    try {
      previousSettings = await getRecordLockSettings(request, settingsToken)
      await saveRecordLockSettings(request, settingsToken, {
        ...previousSettings, enabled: true, strategy: 'optimistic', enabledResources: ['sales.quote'],
      })
      taxRateId = await createRecord(request, token, '/api/sales/tax-rates', {
        name: taxRateName, code: `qa-7294-${suffix}`, rate: 23, isDefault: false,
      })
      quoteId = await createRecord(request, token, '/api/sales/quotes', quoteInput())
      await login(page, 'admin')
      await openQuote(page, quoteId)
      await addLine(page, taxRateName, `QA 7294 line ${suffix}`)
      await addAdjustment(page, { kind: 'Shipping', label: `QA shipping ${suffix}`, taxRateName, net: 15, gross: 18.45 })
      await addAdjustment(page, { kind: 'Surcharge', label: `QA surcharge ${suffix}`, taxRateName, net: 5, gross: 6.15 })

      const converted = page.waitForResponse((response) =>
        new URL(response.url()).pathname === '/api/sales/quotes/convert' && response.request().method() === 'POST',
      )
      await page.getByRole('button', { name: 'Actions', exact: true }).hover()
      await page.getByRole('menuitem', { name: 'Convert to order', exact: true }).click()
      const response = await converted
      expect(response.status(), 'Conversion must succeed on the first attempt').toBe(200)
      const conversion = await response.json() as { orderId?: unknown }
      orderId = expectId(conversion.orderId, 'Conversion must return an order')
      await expect(page).toHaveURL(new RegExp(`/backend/sales/orders/${orderId}$`))
      await expect(page.getByText('This record is currently locked by another user.', { exact: true })).toBeHidden()
      await expect(page.getByRole('dialog', { name: 'Conflict detected', exact: true })).toBeHidden()
      expect(validated.length, 'Enterprise validation must cover local writes and conversion').toBeGreaterThanOrEqual(4)
      expect(validated.every((status) => status === 200)).toBe(true)

      const order = await readDocument(request, token, 'orders', orderId)
      expect(Number(order.shippingNetAmount)).toBe(15)
      expect(Number(order.shippingGrossAmount)).toBe(18.45)
      expect(Number(order.surchargeTotalAmount)).toBe(5)
      expect(Number(order.grandTotalNetAmount)).toBe(120)
      expect(Number(order.grandTotalGrossAmount)).toBe(147.6)
      await page.getByRole('button', { name: 'Show details', exact: true }).click()
      await expect(page.getByText('Shipping (net)', { exact: true })).toBeVisible()
      await expect(page.getByText('Shipping (gross)', { exact: true })).toBeVisible()
      await expect(page.getByText('Surcharges', { exact: true })).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath('converted-order-totals.png'), fullPage: true })
    } finally {
      await page.close()
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/tax-rates', taxRateId)
      if (previousSettings) await saveRecordLockSettings(request, settingsToken, previousSettings)
    }
  })

  test('P1 keeps a second tab stale after passive refresh and blocks sending the quote', async ({ page, request }, testInfo) => {
    const token = await getAuthToken(request, 'admin')
    const settingsToken = await getAuthToken(request, 'superadmin')
    const suffix = `${Date.now()}-${testInfo.workerIndex}`
    const taxRateName = `QA 7294 zero tax ${suffix}`
    let previousSettings: RecordLockSettings | null = null
    let quoteId: string | null = null
    let taxRateId: string | null = null
    let stalePage: Page | null = null
    const sendStatuses: number[] = []

    try {
      previousSettings = await getRecordLockSettings(request, settingsToken)
      await saveRecordLockSettings(request, settingsToken, {
        ...previousSettings, enabled: true, strategy: 'optimistic', enabledResources: ['sales.quote'],
      })
      taxRateId = await createRecord(request, token, '/api/sales/tax-rates', {
        name: taxRateName, code: `qa-7294-${suffix}`, rate: 0, isDefault: false,
      })
      quoteId = await createRecord(request, token, '/api/sales/quotes', quoteInput())
      await createRecord(request, token, '/api/sales/quote-lines', {
        quoteId, currencyCode: 'USD', name: `QA existing line ${suffix}`, quantity: 1,
        unitPriceNet: 10, unitPriceGross: 10, taxRateId, taxRate: 0,
      })
      await login(page, 'admin')
      await openQuote(page, quoteId)
      stalePage = await page.context().newPage()
      await openQuote(stalePage, quoteId)
      stalePage.on('response', (response) => {
        if (new URL(response.url()).pathname === '/api/sales/quotes/send') sendStatuses.push(response.status())
      })
      await addAdjustment(page, { kind: 'Surcharge', label: `QA concurrent edit ${suffix}`, taxRateName, net: 5, gross: 5 })
      const refreshed = stalePage.waitForResponse((response) => new URL(response.url()).pathname === '/api/record_locks/acquire')
      await stalePage.evaluate(() => window.dispatchEvent(new Event('focus')))
      expect((await refreshed).status(), 'Passive enterprise presence must refresh').toBe(200)
      await stalePage.getByRole('button', { name: 'Actions', exact: true }).hover()
      await stalePage.getByRole('menuitem', { name: 'Send to customer', exact: true }).click()
      const sendDialog = stalePage.getByRole('dialog', { name: 'Send quote to customer', exact: true })
      await sendDialog.getByRole('button', { name: 'Send quote', exact: true }).click()

      await expect(stalePage.getByRole('dialog', { name: 'Conflict detected', exact: true })).toBeVisible()
      await expect(stalePage.getByText('This record is currently locked by another user.', { exact: true })).toBeHidden()
      await expect(stalePage.getByText('Quote sent.', { exact: true })).toBeHidden()
      expect(sendStatuses.every((status) => status >= 400), 'No send request may succeed').toBe(true)
      const quote = await readDocument(request, token, 'quotes', quoteId)
      expect(quote.sentAt ?? quote.sent_at ?? null, 'The blocked action must not mark the quote as sent').toBeNull()
      await stalePage.screenshot({ path: testInfo.outputPath('stale-tab-conflict.png'), fullPage: true })
    } finally {
      await stalePage?.close()
      await page.close()
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/tax-rates', taxRateId)
      if (previousSettings) await saveRecordLockSettings(request, settingsToken, previousSettings)
    }
  })
})
