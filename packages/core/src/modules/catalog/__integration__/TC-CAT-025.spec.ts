import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createProductFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'

async function createPriceKind(
  request: APIRequestContext,
  token: string,
  overrides: { code: string; title: string; displayMode?: string },
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/catalog/price-kinds', {
    token,
    data: {
      code: overrides.code,
      title: overrides.title,
      displayMode: overrides.displayMode ?? 'excluding-tax',
    },
  })
  expect(response.ok(), `Failed to create price kind: ${response.status()}`).toBeTruthy()
  const body = (await response.json()) as { id?: string }
  expect(typeof body.id === 'string' && body.id.length > 0).toBeTruthy()
  return body.id as string
}

async function deletePriceKindIfExists(
  request: APIRequestContext,
  token: string | null,
  priceKindId: string | null,
): Promise<void> {
  if (!token || !priceKindId) return
  try {
    await apiRequest(request, 'DELETE', `/api/catalog/price-kinds?id=${encodeURIComponent(priceKindId)}`, { token })
  } catch {
    return
  }
}

async function createVariant(
  request: APIRequestContext,
  token: string,
  productId: string,
  name: string,
  sku: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/catalog/variants', {
    token,
    data: { productId, name, sku },
  })
  expect(response.ok(), `Failed to create variant: ${response.status()}`).toBeTruthy()
  const body = (await response.json()) as { id?: string }
  expect(typeof body.id === 'string' && body.id.length > 0).toBeTruthy()
  return body.id as string
}

/** TC-CAT-025: Pricing Edge Cases */
test.describe('TC-CAT-025: Pricing Edge Cases', () => {
  test('should preserve precision for high-value price (999999.99)', async ({ request }) => {
    const suffix = Date.now()
    let token: string | null = null
    let productId: string | null = null
    let priceKindId: string | null = null

    try {
      token = await getAuthToken(request)

      productId = await createProductFixture(request, token, {
        title: `QA TC-CAT-025 HighVal ${suffix}`,
        sku: `QA-CAT-025-HV-${suffix}`,
      })

      const variantId = await createVariant(
        request,
        token,
        productId,
        `HighVal Variant ${suffix}`,
        `QA-CAT-025-HV-V-${suffix}`,
      )

      priceKindId = await createPriceKind(request, token, {
        code: `qa_cat025_hv_${suffix}`,
        title: `QA CAT-025 HighVal ${suffix}`,
      })

      const createPriceResponse = await apiRequest(request, 'POST', '/api/catalog/prices', {
        token,
        data: {
          productId,
          variantId,
          priceKindId,
          currencyCode: 'EUR',
          minQuantity: 1,
          unitPriceGross: 999999.99,
        },
      })
      expect(createPriceResponse.ok(), `Failed to create price: ${createPriceResponse.status()}`).toBeTruthy()

      const listResponse = await apiRequest(
        request,
        'GET',
        `/api/catalog/prices?productId=${encodeURIComponent(productId)}&page=1&pageSize=50`,
        { token },
      )
      expect(listResponse.ok()).toBeTruthy()

      const listBody = (await listResponse.json()) as { items?: Array<Record<string, unknown>> }
      expect(Array.isArray(listBody.items)).toBeTruthy()

      const matchingPrice = listBody.items?.find((item) => {
        const gross = Number(item.unit_price_gross ?? item.unitPriceGross ?? NaN)
        return Number.isFinite(gross) && Math.abs(gross - 999999.99) < 0.01
      })
      expect(matchingPrice, 'High-value price (999999.99) should be preserved').toBeTruthy()
    } finally {
      await deletePriceKindIfExists(request, token, priceKindId)
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })

  test('should handle price with many decimal places (rounding behavior)', async ({ request }) => {
    const suffix = Date.now()
    let token: string | null = null
    let productId: string | null = null
    let priceKindId: string | null = null

    try {
      token = await getAuthToken(request)

      productId = await createProductFixture(request, token, {
        title: `QA TC-CAT-025 Decimals ${suffix}`,
        sku: `QA-CAT-025-DEC-${suffix}`,
      })

      const variantId = await createVariant(
        request,
        token,
        productId,
        `Decimals Variant ${suffix}`,
        `QA-CAT-025-DEC-V-${suffix}`,
      )

      priceKindId = await createPriceKind(request, token, {
        code: `qa_cat025_dec_${suffix}`,
        title: `QA CAT-025 Decimals ${suffix}`,
      })

      const createPriceResponse = await apiRequest(request, 'POST', '/api/catalog/prices', {
        token,
        data: {
          productId,
          variantId,
          priceKindId,
          currencyCode: 'EUR',
          minQuantity: 1,
          unitPriceGross: 123.4567,
        },
      })
      expect(createPriceResponse.ok(), `Failed to create price: ${createPriceResponse.status()}`).toBeTruthy()

      const listResponse = await apiRequest(
        request,
        'GET',
        `/api/catalog/prices?productId=${encodeURIComponent(productId)}&page=1&pageSize=50`,
        { token },
      )
      expect(listResponse.ok()).toBeTruthy()

      const listBody = (await listResponse.json()) as { items?: Array<Record<string, unknown>> }
      expect(Array.isArray(listBody.items)).toBeTruthy()
      expect(listBody.items!.length).toBeGreaterThan(0)

      const storedPrice = Number(listBody.items![0].unit_price_gross ?? listBody.items![0].unitPriceGross ?? NaN)
      const roundedToFour = Math.round(123.4567 * 10000) / 10000
      const roundedToTwo = Math.round(123.4567 * 100) / 100

      const matchesSomeRounding =
        Math.abs(storedPrice - 123.4567) < 0.000001 ||
        Math.abs(storedPrice - roundedToFour) < 0.0001 ||
        Math.abs(storedPrice - roundedToTwo) < 0.01

      expect(matchesSomeRounding, `Price ${storedPrice} should be a valid rounding of 123.4567`).toBeTruthy()
    } finally {
      await deletePriceKindIfExists(request, token, priceKindId)
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })

  test('should create price kinds with different display modes', async ({ request }) => {
    const suffix = Date.now()
    let token: string | null = null
    let excludingTaxId: string | null = null
    let includingTaxId: string | null = null

    try {
      token = await getAuthToken(request)

      excludingTaxId = await createPriceKind(request, token, {
        code: `qa_cat025_ext_${suffix}`,
        title: `QA CAT-025 ExTax ${suffix}`,
        displayMode: 'excluding-tax',
      })
      expect(excludingTaxId).toBeTruthy()

      includingTaxId = await createPriceKind(request, token, {
        code: `qa_cat025_int_${suffix}`,
        title: `QA CAT-025 InTax ${suffix}`,
        displayMode: 'including-tax',
      })
      expect(includingTaxId).toBeTruthy()

      expect(excludingTaxId).not.toEqual(includingTaxId)

      // Verify correct display modes were persisted
      const listRes = await apiRequest(request, 'GET', '/api/catalog/price-kinds?page=1&pageSize=50', { token })
      expect(listRes.ok()).toBeTruthy()
      const listBody = (await listRes.json()) as {
        items?: Array<{ id: string; displayMode?: string; display_mode?: string }>
      }
      const items = listBody.items ?? []

      const excludingItem = items.find((i) => i.id === excludingTaxId)
      expect(excludingItem, 'Excluding-tax price kind should exist').toBeTruthy()
      const excludingMode = excludingItem?.displayMode ?? excludingItem?.display_mode
      expect(excludingMode, 'Display mode should be excluding-tax').toBe('excluding-tax')

      const includingItem = items.find((i) => i.id === includingTaxId)
      expect(includingItem, 'Including-tax price kind should exist').toBeTruthy()
      const includingMode = includingItem?.displayMode ?? includingItem?.display_mode
      expect(includingMode, 'Display mode should be including-tax').toBe('including-tax')
    } finally {
      await deletePriceKindIfExists(request, token, excludingTaxId)
      await deletePriceKindIfExists(request, token, includingTaxId)
    }
  })

  test('should reject duplicate price kind code with validation error', async ({ request }) => {
    const suffix = Date.now()
    const duplicateCode = `qa_cat025_dup_${suffix}`
    let token: string | null = null
    let firstPriceKindId: string | null = null

    try {
      token = await getAuthToken(request)

      firstPriceKindId = await createPriceKind(request, token, {
        code: duplicateCode,
        title: `QA CAT-025 Dup First ${suffix}`,
      })

      const duplicateResponse = await apiRequest(request, 'POST', '/api/catalog/price-kinds', {
        token,
        data: {
          code: duplicateCode,
          title: `QA CAT-025 Dup Second ${suffix}`,
          displayMode: 'excluding-tax',
        },
      })

      const status = duplicateResponse.status()
      expect(
        status === 400 || status === 409,
        `Duplicate price kind code should return 400 or 409, got ${status}`,
      ).toBeTruthy()
    } finally {
      await deletePriceKindIfExists(request, token, firstPriceKindId)
    }
  })
})
