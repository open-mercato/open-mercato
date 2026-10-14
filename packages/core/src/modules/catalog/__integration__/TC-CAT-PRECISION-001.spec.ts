import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteGeneralEntityIfExists } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createProductFixture,
  createVariantFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures'
import {
  createRandomCurrencyFixture,
  deleteCurrenciesEntityIfExists,
} from '@open-mercato/core/helpers/integration/currenciesFixtures'

/**
 * TC-CAT-PRECISION-001: a variant price in an 18-decimal currency keeps every digit.
 * Source: .ai/specs/2026-10-08-arbitrary-precision-money-and-fx.md
 */

const PRICE_KINDS_PATH = '/api/catalog/price-kinds'
const PRICES_PATH = '/api/catalog/prices'
const CREATED_AMOUNT = '12345678901234.123456789012345678'
const PRECISELY_UPDATED_AMOUNT = '12345678901234.123456789012345679'
const UPDATED_AMOUNT = '98765432109876.987654321098765432'

type JsonRecord = Record<string, unknown>

async function readJson(response: APIResponse): Promise<JsonRecord> {
  const raw = await response.text()
  if (!raw) return {}
  try {
    return JSON.parse(raw) as JsonRecord
  } catch {
    return {}
  }
}

async function readPrice(
  request: APIRequestContext,
  token: string,
  productId: string,
  priceId: string,
): Promise<JsonRecord> {
  const response = await apiRequest(
    request,
    'GET',
    `${PRICES_PATH}?productId=${encodeURIComponent(productId)}&page=1&pageSize=100`,
    { token },
  )
  expect(response.status(), 'GET /api/catalog/prices should be 200').toBe(200)
  const body = await readJson(response)
  const items = Array.isArray(body.items) ? (body.items as JsonRecord[]) : []
  return items.find((item) => item.id === priceId) ?? {}
}

async function readPriceHistory(
  request: APIRequestContext,
  token: string,
  productId: string,
  priceId: string,
): Promise<JsonRecord[]> {
  const response = await apiRequest(
    request,
    'GET',
    `${PRICES_PATH}/history?productId=${encodeURIComponent(productId)}&pageSize=100`,
    { token },
  )
  expect(response.status(), 'GET /api/catalog/prices/history should be 200').toBe(200)
  const body = await readJson(response)
  const items = Array.isArray(body.items) ? (body.items as JsonRecord[]) : []
  return items.filter((item) => item.priceId === priceId)
}

test.describe('TC-CAT-PRECISION-001: 18-decimal variant price', () => {
  test('create and update keep the exact amount beyond float and (16,4) precision', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let currencyId: string | null = null
    let priceKindId: string | null = null
    let productId: string | null = null
    let priceId: string | null = null

    try {
      const currency = await createRandomCurrencyFixture(request, token, {
        name: 'QA TC-CAT-PRECISION-001',
        decimalPlaces: 18,
      })
      currencyId = currency.id

      const priceKindResponse = await apiRequest(request, 'POST', PRICE_KINDS_PATH, {
        token,
        data: {
          code: `qa_precision_${stamp}`,
          title: `QA Precision ${stamp}`,
          displayMode: 'excluding-tax',
          currencyCode: currency.code,
        },
      })
      expect(priceKindResponse.status(), 'POST /api/catalog/price-kinds should be 201').toBe(201)
      priceKindId = (await readJson(priceKindResponse)).id as string
      expect(priceKindId, 'price kind create should return id').toBeTruthy()

      productId = await createProductFixture(request, token, {
        title: `QA Precision Product ${stamp}`,
        sku: `QA-PRECISION-${stamp}`,
      })
      const variantId = await createVariantFixture(request, token, {
        productId,
        name: `QA Precision Variant ${stamp}`,
        sku: `QA-PRECISION-V-${stamp}`,
      })

      const createResponse = await apiRequest(request, 'POST', PRICES_PATH, {
        token,
        data: {
          productId,
          variantId,
          priceKindId,
          currencyCode: currency.code,
          unitPriceNet: CREATED_AMOUNT,
          taxRate: 0,
        },
      })
      expect(createResponse.status(), 'POST /api/catalog/prices should be 201').toBe(201)
      priceId = (await readJson(createResponse)).id as string
      expect(priceId, 'price create should return id').toBeTruthy()

      const created = await readPrice(request, token, productId, priceId)
      expect(created.currency_code).toBe(currency.code)
      expect(created.unit_price_net).toBe(CREATED_AMOUNT)
      expect(created.unit_price_gross).toBe(CREATED_AMOUNT)

      const createdHistory = await readPriceHistory(request, token, productId, priceId)
      expect(createdHistory).toEqual([
        expect.objectContaining({ changeType: 'create', unitPriceNet: CREATED_AMOUNT, unitPriceGross: CREATED_AMOUNT }),
      ])

      const preciseUpdateResponse = await apiRequest(request, 'PUT', PRICES_PATH, {
        token,
        data: { id: priceId, unitPriceNet: PRECISELY_UPDATED_AMOUNT, taxRate: 0 },
      })
      expect(preciseUpdateResponse.status(), 'a price edit beyond float precision should succeed').toBe(200)
      const preciseHistory = await readPriceHistory(request, token, productId, priceId)
      expect(preciseHistory).toHaveLength(2)
      expect(preciseHistory).toEqual(expect.arrayContaining([
        expect.objectContaining({ changeType: 'update', unitPriceNet: PRECISELY_UPDATED_AMOUNT, unitPriceGross: PRECISELY_UPDATED_AMOUNT }),
      ]))

      const updateResponse = await apiRequest(request, 'PUT', PRICES_PATH, {
        token,
        data: { id: priceId, unitPriceNet: UPDATED_AMOUNT, taxRate: 0 },
      })
      expect(updateResponse.status(), 'PUT /api/catalog/prices should be 200').toBe(200)

      const updated = await readPrice(request, token, productId, priceId)
      expect(updated.unit_price_net).toBe(UPDATED_AMOUNT)
      expect(updated.unit_price_gross).toBe(UPDATED_AMOUNT)
      const updatedHistory = await readPriceHistory(request, token, productId, priceId)
      expect(updatedHistory).toHaveLength(3)
      expect(updatedHistory).toEqual(expect.arrayContaining([
        expect.objectContaining({ changeType: 'update', unitPriceNet: UPDATED_AMOUNT, unitPriceGross: UPDATED_AMOUNT }),
      ]))
    } finally {
      await deleteGeneralEntityIfExists(request, token, PRICES_PATH, priceId)
      await deleteCatalogProductIfExists(request, token, productId)
      await deleteGeneralEntityIfExists(request, token, PRICE_KINDS_PATH, priceKindId)
      await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/currencies', currencyId)
    }
  })
})
