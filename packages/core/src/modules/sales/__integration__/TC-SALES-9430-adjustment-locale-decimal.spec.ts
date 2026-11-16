import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createSalesOrderFixture, deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'

export const integrationMeta = { dependsOnModules: ['sales'] }

/**
 * TC-SALES-9430: the order adjustment dialog saves Polish decimal-comma amounts as typed (#9430).
 *
 * Under the `pl` UI locale a fixed adjustment of `15,99` with 23% VAT used to be parsed by
 * `Number()` as NaN/15 and saved with gross 18.45. This drives the real dialog in a browser and
 * reads the saved row back from the API, so disconnecting `parseAdjustmentNumber` from the form
 * (or reverting it to `Number()`) fails here even though the helper unit tests stay green.
 * Fixtures (own 23% tax class + order) are created through the API and removed in `finally`.
 */

type AdjustmentRow = { id?: string; label?: string | null; amount_net?: number; amount_gross?: number }

async function listAdjustments(request: APIRequestContext, token: string, orderId: string): Promise<AdjustmentRow[]> {
  const response = await apiRequest(request, 'GET', `/api/sales/order-adjustments?orderId=${encodeURIComponent(orderId)}&pageSize=50`, { token })
  expect(response.status(), 'GET /api/sales/order-adjustments').toBe(200)
  const body = await readJsonSafe<{ items?: AdjustmentRow[] }>(response)
  return Array.isArray(body?.items) ? body!.items! : []
}

async function openAdjustmentDialog(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Korekty', exact: true }).first().click()
  await page.getByRole('button', { name: 'Dodaj korektę', exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Dodaj korektę' })
  await expect(dialog).toBeVisible()
  // The dialog loads tax rates and then resets the form; type only after that settles.
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
  return dialog
}

async function fillFixedAmountAdjustment(page: Page, dialog: Locator, options: { label: string; taxRateName: string; net: string }) {
  await dialog.getByRole('button', { name: 'Kwota stała', exact: true }).click()
  const taxTrigger = dialog.locator('[data-crud-field-id="taxRateId"]').getByRole('combobox')
  await expect(taxTrigger).toBeEnabled()
  await taxTrigger.click()
  await page.getByRole('option', { name: new RegExp(`^${options.taxRateName}`) }).click()
  await expect(taxTrigger).toContainText(options.taxRateName)
  await dialog.getByPlaceholder('np. Koszt wysyłki').fill(options.label)
  await dialog.locator('[data-crud-field-id="amountNet"]').getByRole('textbox').fill(options.net)
}

test('TC-SALES-9430: pl adjustment dialog saves 15,99 net with 23% VAT as 15.99 / 19.67', async ({ page, request }) => {
  test.slow()
  const token = await getAuthToken(request, 'admin')
  const stamp = randomUUID().slice(0, 8)
  const taxRateName = `QA VAT 23 ${stamp}`
  const commaLabel = `QA 9430 comma ${stamp}`
  const dotLabel = `QA 9430 dot ${stamp}`
  const invalidLabel = `QA 9430 invalid ${stamp}`
  let taxRateId: string | null = null
  let orderId: string | null = null
  let originalLocale = 'en'

  try {
    const taxResponse = await apiRequest(request, 'POST', '/api/sales/tax-rates', {
      token,
      data: { name: taxRateName, code: `qa-vat-23-${stamp}`, rate: 23 },
    })
    expect(taxResponse.status(), `POST /api/sales/tax-rates: ${await taxResponse.text()}`).toBe(201)
    taxRateId = (await readJsonSafe<{ id?: string }>(taxResponse))?.id ?? null
    expect(taxRateId).toBeTruthy()
    orderId = await createSalesOrderFixture(request, token, 'PLN')

    await login(page, 'admin')
    originalLocale = (await page.context().cookies()).find((cookie) => cookie.name === 'locale')?.value ?? 'en'
    expect((await page.request.post('/api/auth/locale', { data: { locale: 'pl' } })).status()).toBe(200)
    await page.goto(`/backend/sales/orders/${orderId}`, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl')

    const adjustmentWrites: string[] = []
    page.on('request', (req) => {
      if (new URL(req.url()).pathname === '/api/sales/order-adjustments' && req.method() !== 'GET') {
        adjustmentWrites.push(req.method())
      }
    })

    // Invalid input: an error is shown and nothing is written.
    let dialog = await openAdjustmentDialog(page)
    await fillFixedAmountAdjustment(page, dialog, { label: invalidLabel, taxRateName, net: '15,99,1' })
    await dialog.getByRole('button', { name: 'Dodaj korektę', exact: true }).click()
    await expect(dialog.getByText('Podaj co najmniej jedną kwotę.').first()).toBeVisible()
    expect(adjustmentWrites, 'invalid amount must not reach the API').toEqual([])
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()

    // Polish decimal comma.
    dialog = await openAdjustmentDialog(page)
    await fillFixedAmountAdjustment(page, dialog, { label: commaLabel, taxRateName, net: '15,99' })
    await expect(dialog.locator('[data-crud-field-id="amountGross"]').getByRole('textbox')).toHaveValue('19.67')
    await dialog.getByRole('button', { name: 'Dodaj korektę', exact: true }).click()
    await expect(dialog).toBeHidden()

    // Equivalent dot input keeps working.
    dialog = await openAdjustmentDialog(page)
    await fillFixedAmountAdjustment(page, dialog, { label: dotLabel, taxRateName, net: '15.99' })
    await expect(dialog.locator('[data-crud-field-id="amountGross"]').getByRole('textbox')).toHaveValue('19.67')
    await dialog.getByRole('button', { name: 'Dodaj korektę', exact: true }).click()
    await expect(dialog).toBeHidden()

    await expect
      .poll(async () => (await listAdjustments(request, token, orderId!)).length, { timeout: 15_000 })
      .toBe(2)
    const saved = await listAdjustments(request, token, orderId)
    for (const label of [commaLabel, dotLabel]) {
      const row = saved.find((item) => item.label === label)
      expect(row, `saved adjustment ${label}`).toBeTruthy()
      expect(Number(row!.amount_net)).toBe(15.99)
      expect(Number(row!.amount_gross)).toBe(19.67)
    }
    expect(saved.some((item) => item.label === invalidLabel)).toBe(false)

    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'Korekty', exact: true }).first().click()
    await expect(page.getByRole('row', { name: new RegExp(commaLabel) })).toBeVisible()
    await expect(page.getByRole('row', { name: new RegExp(dotLabel) })).toBeVisible()
  } finally {
    try {
      if (orderId) {
        for (const row of await listAdjustments(request, token, orderId).catch(() => [] as AdjustmentRow[])) {
          if (row.id) await deleteSalesEntityIfExists(request, token, '/api/sales/order-adjustments', row.id)
        }
        await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
      }
      await deleteSalesEntityIfExists(request, token, '/api/sales/tax-rates', taxRateId)
    } finally {
      await page.request.post('/api/auth/locale', { data: { locale: originalLocale } }).catch(() => undefined)
    }
  }
})
