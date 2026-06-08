import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createProductFixture,
  createVariantFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures'

/**
 * TC-CAT-032: Price create validation — quantity bounds and amounts.
 * Source: issue #2484 (catalog integration coverage), scenario TC-CAT-032.
 *
 * Verified against `priceCreateSchema` / `lib/priceValidation.ts`:
 *  - `minQuantity` / `maxQuantity` must be integers >= 1 (0, negatives and
 *    fractions are rejected) and are optional (omit to leave a bound unset).
 *  - `unitPriceGross` rejects negatives and malformed/over-precise values but
 *    explicitly ALLOWS 0.
 *  - There is NO cross-field `minQuantity <= maxQuantity` guard — the issue
 *    assumed one exists; the last test documents the real (accepted) behavior.
 *
 * Each test uses its OWN price kind so every successful create lands on a unique
 * `(variant, priceKind, currency, minQuantity)` scope — creating two prices on the
 * same scope hits an uncaught unique-constraint 500 (flagged for #2484), so tests
 * must never share a price scope across attempts/retries.
 */
async function createPriceKind(
  request: APIRequestContext,
  token: string,
  suffix: string,
): Promise<string> {
  const res = await apiRequest(request, 'POST', '/api/catalog/price-kinds', {
    token,
    data: {
      code: `qa_cat_032_${suffix}`,
      title: `QA TC-CAT-032 ${suffix}`,
      displayMode: 'including-tax',
      currencyCode: 'USD',
    },
  })
  expect(res.ok(), `Failed to create price kind: ${res.status()}`).toBeTruthy()
  const id = ((await res.json()) as { id?: string }).id
  expect(typeof id === 'string' && id.length > 0, 'price kind id').toBeTruthy()
  return id as string
}

async function deleteByQueryId(
  request: APIRequestContext,
  token: string | null,
  path: string,
  id: string | null,
): Promise<void> {
  if (!token || !id) return
  await apiRequest(request, 'DELETE', `${path}?id=${encodeURIComponent(id)}`, { token }).catch(
    () => undefined,
  )
}

test.describe('TC-CAT-032: Price create validation', () => {
  let token: string
  let productId: string
  let variantId: string
  // Track every product created by beforeAll so a suite-level retry (which re-runs
  // beforeAll in a fresh worker) cannot leak the earlier attempt's product.
  const createdProductIds: string[] = []

  test.beforeAll(async ({ request }) => {
    const stamp = Date.now()
    token = await getAuthToken(request)
    productId = await createProductFixture(request, token, {
      title: `QA Price Validation ${stamp}`,
      sku: `QA-CAT-032-${stamp}`,
    })
    createdProductIds.push(productId)
    variantId = await createVariantFixture(request, token, {
      productId,
      name: 'Default',
      sku: `QA-CAT-032-V-${stamp}`,
      isDefault: true,
    })
  })

  test.afterAll(async ({ request }) => {
    for (const id of createdProductIds) {
      await deleteCatalogProductIfExists(request, token ?? null, id)
    }
  })

  const postPrice = (
    request: APIRequestContext,
    priceKindId: string,
    extra: Record<string, unknown>,
  ) =>
    apiRequest(request, 'POST', '/api/catalog/prices', {
      token,
      data: { productId, variantId, priceKindId, currencyCode: 'USD', ...extra },
    })

  test('rejects an out-of-range minQuantity', async ({ request }) => {
    const priceKindId = await createPriceKind(request, token, `min-${Date.now()}`)
    try {
      const zeroRes = await postPrice(request, priceKindId, { minQuantity: 0, unitPriceGross: 5 })
      expect(zeroRes.status(), 'minQuantity 0 must be rejected').toBe(400)
      expect(((await zeroRes.json()) as { error?: string }).error).toBe('Invalid input')

      const negativeRes = await postPrice(request, priceKindId, {
        minQuantity: -1,
        unitPriceGross: 5,
      })
      expect(negativeRes.status(), 'negative minQuantity must be rejected').toBe(400)

      const fractionalRes = await postPrice(request, priceKindId, {
        minQuantity: 1.5,
        unitPriceGross: 5,
      })
      expect(fractionalRes.status(), 'non-integer minQuantity must be rejected').toBe(400)
    } finally {
      await deleteByQueryId(request, token, '/api/catalog/price-kinds', priceKindId)
    }
  })

  test('rejects malformed or negative price amounts', async ({ request }) => {
    const priceKindId = await createPriceKind(request, token, `amount-${Date.now()}`)
    try {
      const negativeRes = await postPrice(request, priceKindId, { unitPriceGross: -5 })
      expect(negativeRes.status(), 'negative amount must be rejected').toBe(400)

      const commaRes = await postPrice(request, priceKindId, { unitPriceGross: '99,9999' })
      expect(commaRes.status(), 'comma-formatted amount must be rejected').toBe(400)

      const tooLongRes = await postPrice(request, priceKindId, { unitPriceGross: '1000000000000' })
      expect(tooLongRes.status(), 'amount with >12 integer digits must be rejected').toBe(400)
    } finally {
      await deleteByQueryId(request, token, '/api/catalog/price-kinds', priceKindId)
    }
  })

  test('accepts a valid price with no quantity bounds', async ({ request }) => {
    const priceKindId = await createPriceKind(request, token, `valid-${Date.now()}`)
    let priceId: string | null = null
    try {
      const res = await postPrice(request, priceKindId, { unitPriceGross: 19.99 })
      expect(res.status(), 'unbounded price should be created').toBe(201)
      priceId = ((await res.json()) as { id?: string }).id ?? null
      expect(priceId, 'created price id').toBeTruthy()
    } finally {
      await deleteByQueryId(request, token, '/api/catalog/prices', priceId)
      await deleteByQueryId(request, token, '/api/catalog/price-kinds', priceKindId)
    }
  })

  test('accepts a zero amount', async ({ request }) => {
    const priceKindId = await createPriceKind(request, token, `zero-${Date.now()}`)
    let priceId: string | null = null
    try {
      // Zero is explicitly allowed by the amount validator (only negatives fail).
      const res = await postPrice(request, priceKindId, { unitPriceGross: 0 })
      expect(res.status(), 'zero amount is allowed').toBe(201)
      priceId = ((await res.json()) as { id?: string }).id ?? null
      expect(priceId, 'created price id').toBeTruthy()
    } finally {
      await deleteByQueryId(request, token, '/api/catalog/prices', priceId)
      await deleteByQueryId(request, token, '/api/catalog/price-kinds', priceKindId)
    }
  })

  test('does not cross-validate minQuantity against maxQuantity (documents current behavior)', async ({
    request,
  }) => {
    const priceKindId = await createPriceKind(request, token, `range-${Date.now()}`)
    let priceId: string | null = null
    try {
      // priceCreateSchema has no min<=max refine, so an inverted range is accepted.
      // Documented for #2484 as a potential validation gap rather than enforced here.
      const res = await postPrice(request, priceKindId, {
        minQuantity: 100,
        maxQuantity: 50,
        unitPriceGross: 9.99,
      })
      expect(res.status(), 'inverted min/max range is currently accepted').toBe(201)
      priceId = ((await res.json()) as { id?: string }).id ?? null
    } finally {
      await deleteByQueryId(request, token, '/api/catalog/prices', priceId)
      await deleteByQueryId(request, token, '/api/catalog/price-kinds', priceKindId)
    }
  })
})
