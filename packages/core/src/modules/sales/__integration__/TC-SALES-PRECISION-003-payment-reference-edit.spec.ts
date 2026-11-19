import { expect, test, type APIRequestContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'
import {
  createRandomCurrencyFixture,
  deleteCurrenciesEntityIfExists,
} from '@open-mercato/core/helpers/integration/currenciesFixtures'
import { fillControlledInput } from '@open-mercato/core/helpers/integration/ui'

/**
 * TC-SALES-PRECISION-003: a payment amount stored through the API with more digits than a
 * float holds survives a Payments-tab edit that only changes the reference.
 * Source: .ai/specs/2026-10-08-arbitrary-precision-money-and-fx.md
 */

const EXACT_AMOUNT = '25.123456789012345678'

async function readPayment(request: APIRequestContext, token: string, orderId: string, paymentId: string) {
  const response = await apiRequest(request, 'GET', `/api/sales/payments?orderId=${encodeURIComponent(orderId)}`, { token })
  expect(response.status(), 'GET /api/sales/payments should be 200').toBe(200)
  const body = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(response)
  return (body?.items ?? []).find((item) => item.id === paymentId) ?? null
}

test('TC-SALES-PRECISION-003: a reference-only payment edit keeps the exact amount', async ({ page, request }) => {
  test.slow()
  const token = await getAuthToken(request, 'admin')
  const reference = `TC-SALES-PRECISION-003-${randomUUID()}`
  const nextReference = `${reference}-edited`
  let currencyId: string | null = null
  let orderId: string | null = null
  let paymentId: string | null = null

  try {
    const currency = await createRandomCurrencyFixture(request, token, {
      name: 'QA TC-SALES-PRECISION-003',
      decimalPlaces: 18,
    })
    currencyId = currency.id

    const orderResponse = await apiRequest(request, 'POST', '/api/sales/orders', {
      token,
      data: {
        currencyCode: currency.code,
        lines: [{ name: reference, currencyCode: currency.code, quantity: 1, unitPriceNet: '100', unitPriceGross: '100', taxRate: 0 }],
      },
    })
    expect(orderResponse.status(), 'POST /api/sales/orders should be 201').toBe(201)
    orderId = (await readJsonSafe<{ id?: string }>(orderResponse))?.id ?? null
    expect(typeof orderId).toBe('string')

    const paymentResponse = await apiRequest(request, 'POST', '/api/sales/payments', {
      token,
      data: { orderId, amount: EXACT_AMOUNT, currencyCode: currency.code, paymentReference: reference },
    })
    expect(paymentResponse.status(), 'POST /api/sales/payments should be 201').toBe(201)
    paymentId = (await readJsonSafe<{ id?: string }>(paymentResponse))?.id ?? null
    expect(typeof paymentId).toBe('string')
    expect((await readPayment(request, token, orderId!, paymentId!))?.amount).toBe(EXACT_AMOUNT)

    await login(page, 'admin')
    await page.goto(`/backend/sales/orders/${orderId}`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'Payments', exact: true }).click()
    const row = page.getByRole('row').filter({ has: page.getByRole('cell', { name: reference, exact: true }) })
    await expect(row).toBeVisible({ timeout: 15_000 })
    await row.click()

    const dialog = page.getByRole('dialog')
    const referenceInput = dialog.locator('[data-crud-field-id="paymentReference"] input').first()
    await expect(referenceInput).toHaveValue(reference, { timeout: 10_000 })
    await fillControlledInput(referenceInput, nextReference)

    const saved = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/sales/payments' && response.request().method() === 'PUT',
    )
    await dialog.getByRole('button', { name: /save/i }).first().click()
    expect((await saved).status(), 'PUT /api/sales/payments should succeed').toBeLessThan(400)

    const after = await readPayment(request, token, orderId!, paymentId!)
    expect(after?.payment_reference ?? after?.paymentReference).toBe(nextReference)
    expect(after?.amount).toBe(EXACT_AMOUNT)
  } finally {
    await deleteSalesEntityIfExists(request, token, '/api/sales/payments', paymentId)
    await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/currencies', currencyId)
  }
})
