import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  createRandomCurrencyFixture,
  deleteCurrenciesEntityIfExists,
} from '@open-mercato/core/helpers/integration/currenciesFixtures'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'

export const integrationMeta = { dependsOnModules: ['sales', 'currencies'] }

const currencyPath = '/api/currencies/currencies'

async function createCustomCurrency(request: APIRequestContext, token: string, decimalPlaces: number) {
  const intlCurrencyCodes = new Set(Intl.supportedValuesOf('currency'))
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const currency = await createRandomCurrencyFixture(request, token, { name: 'QA Sales precision', decimalPlaces })
    if (!intlCurrencyCodes.has(currency.code)) return currency
    await deleteCurrenciesEntityIfExists(request, token, currencyPath, currency.id)
  }
  throw new Error('[internal] failed to create a currency with a custom code')
}

const cases = [
  {
    resource: 'quotes',
    numberField: 'quoteNumber',
    locale: 'pl',
    decimalPlaces: 8,
    unitPrice: '0.00012345',
    quantity: 3,
    total: '0.00037035',
    summaryLabels: /Razem \((netto|brutto)\)/i,
    searchPlaceholder: 'Szukaj ofert…',
  },
  {
    resource: 'orders',
    numberField: 'orderNumber',
    locale: 'en',
    decimalPlaces: 18,
    unitPrice: '1.123456789012345681',
    quantity: 1,
    total: '1.123456789012345681',
    summaryLabels: /Grand total \((net|gross)\)/i,
    searchPlaceholder: 'Search orders…',
  },
] as const

for (const scenario of cases) {
  test(`TC-SALES-9427: ${scenario.resource} show exact totals in the summary and list (${scenario.locale})`, async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const apiPath = `/api/sales/${scenario.resource}`
    const listPath = `/backend/sales/${scenario.resource}`
    const documentNumber = `QA-9427-${randomUUID()}`
    const currency = await createCustomCurrency(request, token, scenario.decimalPlaces)
    let documentId: string | null = null

    try {
      const response = await apiRequest(request, 'POST', apiPath, {
        token,
        retryTransport: false,
        data: {
          [scenario.numberField]: documentNumber,
          currencyCode: currency.code,
          lines: [{
            name: 'QA precision line',
            currencyCode: currency.code,
            quantity: scenario.quantity,
            unitPriceNet: scenario.unitPrice,
            unitPriceGross: scenario.unitPrice,
            taxRate: 0,
          }],
        },
      })
      expect(response.status(), `POST ${apiPath} should create the document`).toBe(201)
      documentId = expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'Created document ID')

      const formattedTotal = scenario.locale === 'pl'
        ? `${scenario.total.replace('.', ',')} ${currency.code}`
        : `${currency.code} ${scenario.total}`

      await login(page, 'admin')
      await page.request.get(`/api/auth/locale?locale=${scenario.locale}&redirect=${listPath}`, { maxRedirects: 0 })
      await page.goto(`${listPath}/${documentId}`)
      const summary = page.getByRole('row', { name: scenario.summaryLabels })
      await expect(summary.getByRole('cell', { name: formattedTotal, exact: true })).toHaveCount(2)

      await page.goto(listPath)
      await page.getByPlaceholder(scenario.searchPlaceholder, { exact: true }).fill(documentNumber)
      const documentRow = page.getByRole('row').filter({
        has: page.getByRole('cell', { name: documentNumber, exact: true }),
      })
      const totalCells = documentRow.getByRole('cell', { name: formattedTotal, exact: true })
      await expect(totalCells).toHaveCount(2)
      const hasEllipsis = await totalCells.evaluateAll((cells) => cells.some((cell) =>
        [cell, ...cell.querySelectorAll('*')].some((element) =>
          window.getComputedStyle(element).textOverflow === 'ellipsis' && element.scrollWidth > element.clientWidth,
        ),
      ))
      expect(hasEllipsis, 'Both list totals should display every digit').toBe(false)
    } finally {
      await deleteSalesEntityIfExists(request, token, apiPath, documentId)
      await deleteCurrenciesEntityIfExists(request, token, currencyPath, currency.id)
    }
  })
}
