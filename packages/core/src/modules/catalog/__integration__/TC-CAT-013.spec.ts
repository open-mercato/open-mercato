import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { deleteCatalogProductIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'

type PriceKindFixture = {
  id: string
  currencyCode: string
  created: boolean
}

type ProductFixtureInput = {
  token: string
  request: APIRequestContext
  title: string
  sku: string
}

async function ensurePriceKindFixture(
  request: APIRequestContext,
  token: string,
): Promise<PriceKindFixture> {
  const list = await apiRequest(request, 'GET', '/api/catalog/price-kinds?page=1&pageSize=50', { token })
  expect(list.ok(), `Failed to list price kinds: ${list.status()}`).toBeTruthy()
  const listBody = (await list.json()) as { items?: Array<Record<string, unknown>> }
  const first = Array.isArray(listBody.items) ? listBody.items[0] : null
  const firstId = typeof first?.id === 'string' ? first.id : null
  const firstCurrency =
    typeof first?.currency_code === 'string'
      ? first.currency_code
      : typeof first?.currencyCode === 'string'
        ? first.currencyCode
        : 'USD'
  if (firstId) {
    return { id: firstId, currencyCode: firstCurrency, created: false }
  }

  const stamp = Date.now()
  const create = await apiRequest(request, 'POST', '/api/catalog/price-kinds', {
    token,
    data: {
      title: `QA UoM Kind ${stamp}`,
      code: `qa_uom_kind_${stamp}`,
      displayMode: 'including-tax',
      currencyCode: 'USD',
    },
  })
  expect(create.ok(), `Failed to create price kind fixture: ${create.status()}`).toBeTruthy()
  const createBody = (await create.json()) as { id?: string; result?: { id?: string } }
  const id = typeof createBody.id === 'string' ? createBody.id : createBody.result?.id
  expect(typeof id === 'string' && id.length > 0, 'Price kind id missing').toBeTruthy()
  return { id: id as string, currencyCode: 'USD', created: true }
}

async function createUomProductFixture(input: ProductFixtureInput): Promise<string> {
  const response = await apiRequest(input.request, 'POST', '/api/catalog/products', {
    token: input.token,
    data: {
      title: input.title,
      sku: input.sku,
      description:
        'Long enough description for UoM integration tests. This keeps server-side create validation satisfied.',
      defaultUnit: 'm2',
      defaultSalesUnit: 'pkg',
      defaultSalesUnitQuantity: 1,
      uomRoundingScale: 4,
      uomRoundingMode: 'half_up',
    },
  })
  expect(response.ok(), `Failed to create product fixture: ${response.status()}`).toBeTruthy()
  const body = (await response.json()) as { id?: string }
  expect(typeof body.id === 'string' && body.id.length > 0).toBeTruthy()
  return body.id as string
}

test.describe('TC-CAT-013: Product UoM conversions and normalized pricing filters', () => {
  test('should enforce conversion validation and filter prices by normalized quantity', async ({ request }) => {
    const stamp = Date.now()
    const title = `QA TC-CAT-013 ${stamp}`
    const sku = `QA-CAT-013-${stamp}`
    let token: string | null = null
    let productId: string | null = null
    let conversionId: string | null = null
    let priceKindId: string | null = null
    let createdPriceKindId: string | null = null
    let priceCurrency = 'USD'

    try {
      token = await getAuthToken(request)
      const priceKind = await ensurePriceKindFixture(request, token)
      priceKindId = priceKind.id
      priceCurrency = priceKind.currencyCode
      if (priceKind.created) createdPriceKindId = priceKind.id

      productId = await createUomProductFixture({ request, token, title, sku })

      const createConversion = await apiRequest(request, 'POST', '/api/catalog/product-unit-conversions', {
        token,
        data: {
          productId,
          unitCode: 'pkg',
          toBaseFactor: 2.5,
          sortOrder: 10,
          isActive: true,
        },
      })
      expect(createConversion.ok(), `Failed to create conversion: ${createConversion.status()}`).toBeTruthy()
      const conversionBody = (await createConversion.json()) as { id?: string }
      conversionId = typeof conversionBody.id === 'string' ? conversionBody.id : null
      expect(conversionId, 'Conversion id missing').toBeTruthy()

      const duplicateConversion = await apiRequest(request, 'POST', '/api/catalog/product-unit-conversions', {
        token,
        data: {
          productId,
          unitCode: 'pkg',
          toBaseFactor: 3,
        },
      })
      expect(duplicateConversion.status(), 'Duplicate conversion should be rejected').toBe(409)

      const invalidFactor = await apiRequest(request, 'POST', '/api/catalog/product-unit-conversions', {
        token,
        data: {
          productId,
          unitCode: 'box',
          toBaseFactor: 0,
        },
      })
      expect(invalidFactor.status(), 'Non-positive factor should be rejected').toBe(400)

      const baseTier = await apiRequest(request, 'POST', '/api/catalog/prices', {
        token,
        data: {
          productId,
          priceKindId,
          currencyCode: priceCurrency,
          minQuantity: 1,
          maxQuantity: 4,
          unitPriceGross: 100,
        },
      })
      expect(baseTier.ok(), `Failed to create base price tier: ${baseTier.status()}`).toBeTruthy()

      const discountedTier = await apiRequest(request, 'POST', '/api/catalog/prices', {
        token,
        data: {
          productId,
          priceKindId,
          currencyCode: priceCurrency,
          minQuantity: 5,
          unitPriceGross: 90,
        },
      })
      expect(discountedTier.ok(), `Failed to create discount price tier: ${discountedTier.status()}`).toBeTruthy()

      const filtered = await apiRequest(
        request,
        'GET',
        `/api/catalog/prices?productId=${encodeURIComponent(productId)}&quantity=2&quantityUnit=pkg&page=1&pageSize=20`,
        { token },
      )
      expect(filtered.ok(), `Failed to query filtered prices: ${filtered.status()}`).toBeTruthy()
      const filteredBody = (await filtered.json()) as { items?: Array<Record<string, unknown>> }
      const items = Array.isArray(filteredBody.items) ? filteredBody.items : []
      expect(items.length, 'Filtered prices should not be empty').toBeGreaterThan(0)

      const hasDiscountTier = items.some((item) => {
        const gross = Number(item.unit_price_gross ?? item.unitPriceGross ?? Number.NaN)
        return Number.isFinite(gross) && Math.abs(gross - 90) < 0.0001
      })
      expect(hasDiscountTier, 'Normalized quantity should match the discount tier').toBeTruthy()

      const resolvedProduct = await apiRequest(
        request,
        'GET',
        `/api/catalog/products?id=${encodeURIComponent(productId)}&quantity=2&quantityUnit=pkg&page=1&pageSize=1`,
        { token },
      )
      expect(
        resolvedProduct.ok(),
        `Failed to resolve product pricing with normalized quantity: ${resolvedProduct.status()}`,
      ).toBeTruthy()
      const resolvedBody = (await resolvedProduct.json()) as { items?: Array<Record<string, unknown>> }
      const productRow = Array.isArray(resolvedBody.items) ? resolvedBody.items[0] : null
      expect(productRow, 'Expected product row in resolved pricing response').toBeTruthy()
      const pricing = productRow && typeof productRow.pricing === 'object' ? productRow.pricing : null
      const resolvedGross = Number(
        (pricing as Record<string, unknown> | null)?.unit_price_gross ??
          (pricing as Record<string, unknown> | null)?.unitPriceGross ??
          Number.NaN,
      )
      expect(
        Number.isFinite(resolvedGross) && Math.abs(resolvedGross - 90) < 0.0001,
        'Resolved catalog pricing should use normalized quantity.',
      ).toBeTruthy()
    } finally {
      if (token && createdPriceKindId) {
        try {
          await apiRequest(
            request,
            'DELETE',
            `/api/catalog/price-kinds?id=${encodeURIComponent(createdPriceKindId)}`,
            { token },
          )
        } catch {
          // ignore cleanup failures
        }
      }
      if (token && conversionId) {
        try {
          await apiRequest(
            request,
            'DELETE',
            `/api/catalog/product-unit-conversions?id=${encodeURIComponent(conversionId)}`,
            { token },
          )
        } catch {
          // ignore cleanup failures
        }
      }
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })
})
