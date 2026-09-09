import { expect, test, type APIRequestContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createProductFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-CAT-037: Omnibus — `isPersonalized` on the products response.
 * Source: .ai/specs/implemented/2026-06-30-omnibus-price-tracking.md (Gap 7, Art. 6(1)(ea) disclosure).
 *
 * The personalized-pricing disclosure is an API contract, not an implementation detail:
 * `GET /api/catalog/products` items expose `isPersonalized` and `personalizationReason`
 * at the TOP LEVEL in camelCase. A prior prototype nested them as snake_case keys under
 * `pricing` (`pricing.is_personalized`), which storefronts cannot rely on. This spec pins
 * the shipped shape and asserts the nested variant is absent.
 *
 * The decoration only runs while the tenant's Omnibus config is enabled, so the test
 * enables it for the duration and restores the previous config in `finally`. Enabling with
 * no `enabledCountryCodes` keeps the backfill gate out of scope (no channel is in scope),
 * which is exactly what the 422 `backfill_required_before_enable` rule specifies.
 *
 * Self-contained: creates its own price kind, product and price; removes all of them and
 * restores the Omnibus config in `finally`. Depends on no seeded catalog data.
 */

type OmnibusConfig = Record<string, unknown>

type ProductItem = Record<string, unknown>

async function readOmnibusConfig(request: APIRequestContext, token: string): Promise<OmnibusConfig> {
  const response = await apiRequest(request, 'GET', '/api/catalog/settings', { token })
  expect(response.ok(), `Failed to read catalog settings: ${response.status()}`).toBeTruthy()
  const body = await readJsonSafe<{ omnibus?: OmnibusConfig }>(response)
  return body?.omnibus && typeof body.omnibus === 'object' ? body.omnibus : {}
}

async function writeOmnibusEnabled(
  request: APIRequestContext,
  token: string,
  enabled: boolean,
): Promise<void> {
  const response = await apiRequest(request, 'PUT', '/api/catalog/settings', {
    token,
    data: { omnibus: { enabled } },
  })
  expect(
    response.ok(),
    `Failed to set omnibus.enabled=${enabled}: ${response.status()} ${JSON.stringify(await readJsonSafe(response))}`,
  ).toBeTruthy()
}

async function createPriceKind(
  request: APIRequestContext,
  token: string,
  stamp: number,
): Promise<{ id: string; currencyCode: string }> {
  const response = await apiRequest(request, 'POST', '/api/catalog/price-kinds', {
    token,
    data: {
      title: `QA TC-CAT-037 kind ${stamp}`,
      code: `qa_cat037_${stamp}`,
      displayMode: 'including-tax',
      currencyCode: 'USD',
    },
  })
  expect(response.ok(), `Failed to create price kind: ${response.status()}`).toBeTruthy()
  const body = await readJsonSafe<{ id?: string; result?: { id?: string } }>(response)
  const id = body?.id ?? body?.result?.id
  expect(typeof id === 'string' && id.length > 0, 'Price kind id missing').toBeTruthy()
  return { id: id as string, currencyCode: 'USD' }
}

async function fetchProduct(
  request: APIRequestContext,
  token: string,
  productId: string,
  extraQuery = '',
): Promise<ProductItem> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/catalog/products?id=${encodeURIComponent(productId)}&page=1&pageSize=1${extraQuery}`,
    { token },
  )
  expect(response.ok(), `Failed to list products: ${response.status()}`).toBeTruthy()
  const body = await readJsonSafe<{ items?: ProductItem[] }>(response)
  const item = (body?.items ?? []).find((row) => row.id === productId)
  expect(item, 'Product not found in products response').toBeTruthy()
  return item as ProductItem
}

async function deletePriceIfExists(
  request: APIRequestContext,
  token: string | null,
  priceId: string | null,
): Promise<void> {
  if (!token || !priceId) return
  await apiRequest(request, 'DELETE', `/api/catalog/prices?id=${encodeURIComponent(priceId)}`, {
    token,
  }).catch(() => undefined)
}

async function deletePriceKindIfExists(
  request: APIRequestContext,
  token: string | null,
  priceKindId: string | null,
): Promise<void> {
  if (!token || !priceKindId) return
  await apiRequest(request, 'DELETE', `/api/catalog/price-kinds?id=${encodeURIComponent(priceKindId)}`, {
    token,
  }).catch(() => undefined)
}

test.describe('TC-CAT-037: Omnibus — isPersonalized in the products response', () => {
  test('exposes isPersonalized/personalizationReason top-level in camelCase, never nested under pricing', async ({
    request,
  }) => {
    test.slow()
    const stamp = Date.now()

    let token: string | null = null
    let previousEnabled: boolean | null = null
    let productId: string | null = null
    let priceId: string | null = null
    let priceKindId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')

      const storedConfig = await readOmnibusConfig(request, token)
      previousEnabled = storedConfig.enabled === true
      if (!previousEnabled) await writeOmnibusEnabled(request, token, true)

      const priceKind = await createPriceKind(request, token, stamp)
      priceKindId = priceKind.id

      productId = await createProductFixture(request, token, {
        title: `QA TC-CAT-037 Personalization ${stamp}`,
        sku: `QA-CAT-037-${stamp}`,
      })

      const priceResponse = await apiRequest(request, 'POST', '/api/catalog/prices', {
        token,
        data: {
          productId,
          priceKindId: priceKind.id,
          currencyCode: priceKind.currencyCode,
          minQuantity: 1,
          unitPriceNet: 149.99,
          unitPriceGross: 149.99,
        },
      })
      expect(priceResponse.ok(), `Failed to create price: ${priceResponse.status()}`).toBeTruthy()
      priceId = (await readJsonSafe<{ id?: string }>(priceResponse))?.id ?? null

      // A public (non-scoped) price: the disclosure fields must be present and negative.
      const publicItem = await fetchProduct(request, token, productId)
      expect(publicItem.pricing, 'pricing block must resolve for a product with a matching price').toBeTruthy()
      expect(
        typeof publicItem.isPersonalized,
        'isPersonalized must be a top-level boolean on the product item',
      ).toBe('boolean')
      expect(publicItem.isPersonalized, 'a public price must not be reported as personalized').toBe(false)
      expect(
        publicItem.personalizationReason,
        'personalizationReason must be null when the price is not personalized',
      ).toBeNull()

      // Contract guard: the legacy nested snake_case shape must NOT come back.
      const pricing = publicItem.pricing as Record<string, unknown>
      expect(
        Object.prototype.hasOwnProperty.call(pricing, 'is_personalized'),
        'pricing must not carry a nested snake_case is_personalized field',
      ).toBe(false)
      expect(
        Object.prototype.hasOwnProperty.call(pricing, 'personalization_reason'),
        'pricing must not carry a nested snake_case personalization_reason field',
      ).toBe(false)
      expect(
        Object.prototype.hasOwnProperty.call(publicItem, 'is_personalized'),
        'the product item must not carry a top-level snake_case is_personalized field',
      ).toBe(false)

      // Customer-scoped request: disclosure flips on with the customer-specific reason.
      const customerItem = await fetchProduct(
        request,
        token,
        productId,
        `&customerId=${encodeURIComponent(randomUUID())}`,
      )
      expect(customerItem.isPersonalized, 'a customer-scoped request must report isPersonalized=true').toBe(true)
      expect(customerItem.personalizationReason, 'customer-scoped reason mismatch').toBe(
        'customer_specific_price',
      )

      // Customer-group-scoped request: same disclosure, group reason.
      const groupItem = await fetchProduct(
        request,
        token,
        productId,
        `&customerGroupId=${encodeURIComponent(randomUUID())}`,
      )
      expect(groupItem.isPersonalized, 'a group-scoped request must report isPersonalized=true').toBe(true)
      expect(groupItem.personalizationReason, 'group-scoped reason mismatch').toBe('customer_group_price')
    } finally {
      await deletePriceIfExists(request, token, priceId)
      await deleteCatalogProductIfExists(request, token, productId)
      await deletePriceKindIfExists(request, token, priceKindId)
      if (token && previousEnabled === false) {
        await writeOmnibusEnabled(request, token, false).catch(() => undefined)
      }
    }
  })
})
