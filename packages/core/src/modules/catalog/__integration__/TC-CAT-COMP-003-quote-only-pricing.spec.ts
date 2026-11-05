import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  createProductFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'

/**
 * TC-CAT-COMP-003: Quote-only products suppress resolved pricing
 * (spec: .ai/specs/2026-06-11-catalog-compliance-and-commercial-product-fields.md).
 *
 * Verified contract:
 * - The products list decoration resolves `pricing` from existing price rows
 *   (default context: quantity 1, today) — pattern proven by TC-CAT-026.
 * - When is_quote_only=true the decoration short-circuits to `pricing: null`
 *   even though price rows still exist; flipping the flag back restores the
 *   resolved pricing object.
 *
 * Fixtures: own product + price kind (gated by catalog.settings.manage — admin
 * holds catalog.*) + one regular price row; everything is cleaned up in finally
 * (product delete also removes its price rows).
 */

const PRODUCTS_PATH = '/api/catalog/products'
const PRICE_KINDS_PATH = '/api/catalog/price-kinds'
const PRICES_PATH = '/api/catalog/prices'
const PRICE_GROSS = 49.99

type ProductItem = Record<string, unknown>

async function readProductById(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<ProductItem> {
  const response = await apiRequest(
    request,
    'GET',
    `${PRODUCTS_PATH}?id=${encodeURIComponent(id)}&page=1&pageSize=1`,
    { token },
  )
  expect(response.status(), `product read-back failed: ${response.status()}`).toBe(200)
  const body = await readJsonSafe<{ items?: ProductItem[] }>(response)
  const item = (body?.items ?? []).find((entry) => entry.id === id) ?? null
  expect(item, `product ${id} should be present in the list read-back`).toBeTruthy()
  return item as ProductItem
}

async function setQuoteOnly(
  request: APIRequestContext,
  token: string,
  productId: string,
  isQuoteOnly: boolean,
): Promise<void> {
  const response = await apiRequest(request, 'PUT', PRODUCTS_PATH, {
    token,
    data: { id: productId, isQuoteOnly },
  })
  expect(
    response.status(),
    `setting isQuoteOnly=${isQuoteOnly} failed: ${response.status()}`,
  ).toBe(200)
}

function expectResolvedPricing(item: ProductItem, priceKindId: string, label: string): void {
  const pricing =
    item.pricing && typeof item.pricing === 'object'
      ? (item.pricing as Record<string, unknown>)
      : null
  expect(pricing, `${label}: pricing should resolve to an object`).not.toBeNull()
  expect(Number(pricing!.unit_price_gross), `${label}: resolved gross price`).toBeCloseTo(PRICE_GROSS, 4)
  expect(pricing!.price_kind_id, `${label}: resolved price kind`).toBe(priceKindId)
}

test.describe('TC-CAT-COMP-003: quote-only pricing suppression', () => {
  test('is_quote_only toggles pricing between resolved object and null', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let productId: string | null = null
    let priceKindId: string | null = null

    try {
      productId = await createProductFixture(request, token, {
        title: `QA COMP-003 Quote Only ${stamp}`,
        sku: `QA-COMP-003-${stamp}`,
      })

      const priceKindResponse = await apiRequest(request, 'POST', PRICE_KINDS_PATH, {
        token,
        data: {
          code: `qa_comp003_${stamp}`,
          title: `QA COMP-003 Kind ${stamp}`,
          displayMode: 'excluding-tax',
          currencyCode: 'USD',
        },
      })
      expect(priceKindResponse.ok(), `price kind create failed: ${priceKindResponse.status()}`).toBeTruthy()
      const priceKindBody = await readJsonSafe<{ id?: string }>(priceKindResponse)
      expect(
        typeof priceKindBody?.id === 'string' && priceKindBody.id.length > 0,
        'price kind create should return an id',
      ).toBe(true)
      priceKindId = priceKindBody!.id as string

      const priceResponse = await apiRequest(request, 'POST', PRICES_PATH, {
        token,
        data: {
          productId,
          priceKindId,
          currencyCode: 'USD',
          minQuantity: 1,
          unitPriceNet: PRICE_GROSS,
          unitPriceGross: PRICE_GROSS,
        },
      })
      expect(priceResponse.ok(), `price create failed: ${priceResponse.status()}`).toBeTruthy()

      // Baseline: the price row resolves into the pricing decoration.
      const baseline = await readProductById(request, token, productId)
      expect(baseline.is_quote_only, 'baseline product is not quote-only').toBe(false)
      expectResolvedPricing(baseline, priceKindId, 'baseline')

      // Quote-only: pricing is suppressed although the price row still exists.
      await setQuoteOnly(request, token, productId, true)
      const whileQuoteOnly = await readProductById(request, token, productId)
      expect(whileQuoteOnly.is_quote_only, 'flag round-trips as true').toBe(true)
      expect(whileQuoteOnly.pricing, 'quote-only product must expose pricing: null').toBeNull()

      // Back to false: the same price row resolves again.
      await setQuoteOnly(request, token, productId, false)
      const afterRestore = await readProductById(request, token, productId)
      expect(afterRestore.is_quote_only, 'flag round-trips back to false').toBe(false)
      expectResolvedPricing(afterRestore, priceKindId, 'after restore')
    } finally {
      if (priceKindId) {
        try {
          await apiRequest(request, 'DELETE', `${PRICE_KINDS_PATH}?id=${encodeURIComponent(priceKindId)}`, { token })
        } catch {
          // best-effort cleanup
        }
      }
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })
})
