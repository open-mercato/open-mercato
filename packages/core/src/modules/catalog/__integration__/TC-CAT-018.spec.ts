/** TC-CAT-018: Price Management */
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createProductFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'

type PriceKindFixture = {
  id: string
  currencyCode: string
  created: boolean
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
      title: `QA Price Kind ${stamp}`,
      code: `qa_price_kind_${stamp}`,
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

async function createVariantFixture(
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
  expect(response.ok(), `Failed to create variant fixture: ${response.status()}`).toBeTruthy()
  const body = (await response.json()) as { id?: string }
  expect(typeof body.id === 'string' && body.id.length > 0, 'Variant id missing').toBeTruthy()
  return body.id as string
}

test.describe('TC-CAT-018: Price Management', () => {
  test('should create a price for product + variant and verify it is listed', async ({ request }) => {
    const stamp = Date.now()
    let token: string | null = null
    let productId: string | null = null
    let createdPriceKindId: string | null = null

    try {
      token = await getAuthToken(request)
      const priceKind = await ensurePriceKindFixture(request, token)
      if (priceKind.created) createdPriceKindId = priceKind.id

      productId = await createProductFixture(request, token, {
        title: `QA TC-CAT-018-1 ${stamp}`,
        sku: `QA-CAT-018-1-${stamp}`,
      })

      const variantId = await createVariantFixture(
        request,
        token,
        productId,
        `Variant ${stamp}`,
        `QA-CAT-018-1-V-${stamp}`,
      )

      const createPrice = await apiRequest(request, 'POST', '/api/catalog/prices', {
        token,
        data: {
          productId,
          variantId,
          priceKindId: priceKind.id,
          currencyCode: priceKind.currencyCode,
          minQuantity: 1,
          unitPriceGross: 49.99,
        },
      })
      expect(createPrice.ok(), `Failed to create price: ${createPrice.status()}`).toBeTruthy()
      const priceBody = (await createPrice.json()) as { id?: string }
      expect(typeof priceBody.id === 'string' && priceBody.id.length > 0, 'Price id missing').toBeTruthy()

      const listPrices = await apiRequest(
        request,
        'GET',
        `/api/catalog/prices?productId=${encodeURIComponent(productId)}&page=1&pageSize=50`,
        { token },
      )
      expect(listPrices.ok(), `Failed to list prices: ${listPrices.status()}`).toBeTruthy()
      const listBody = (await listPrices.json()) as { items?: Array<Record<string, unknown>> }
      const items = Array.isArray(listBody.items) ? listBody.items : []
      const found = items.some((item) => {
        const itemId = item.id ?? item.priceId
        return itemId === priceBody.id
      })
      expect(found, 'Created price should appear in the listing').toBeTruthy()
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
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })

  test('should update price amount and verify updated value', async ({ request }) => {
    const stamp = Date.now()
    let token: string | null = null
    let productId: string | null = null
    let createdPriceKindId: string | null = null

    try {
      token = await getAuthToken(request)
      const priceKind = await ensurePriceKindFixture(request, token)
      if (priceKind.created) createdPriceKindId = priceKind.id

      productId = await createProductFixture(request, token, {
        title: `QA TC-CAT-018-2 ${stamp}`,
        sku: `QA-CAT-018-2-${stamp}`,
      })

      const variantId = await createVariantFixture(
        request,
        token,
        productId,
        `Variant ${stamp}`,
        `QA-CAT-018-2-V-${stamp}`,
      )

      const createPrice = await apiRequest(request, 'POST', '/api/catalog/prices', {
        token,
        data: {
          productId,
          variantId,
          priceKindId: priceKind.id,
          currencyCode: priceKind.currencyCode,
          minQuantity: 1,
          unitPriceGross: 25.0,
        },
      })
      expect(createPrice.ok(), `Failed to create price: ${createPrice.status()}`).toBeTruthy()
      const priceBody = (await createPrice.json()) as { id?: string }
      const priceId = priceBody.id as string

      const updatePrice = await apiRequest(request, 'PUT', '/api/catalog/prices', {
        token,
        data: {
          id: priceId,
          unitPriceGross: 35.5,
        },
      })
      expect(updatePrice.ok(), `Failed to update price: ${updatePrice.status()}`).toBeTruthy()

      const listPrices = await apiRequest(
        request,
        'GET',
        `/api/catalog/prices?productId=${encodeURIComponent(productId)}&page=1&pageSize=50`,
        { token },
      )
      expect(listPrices.ok(), `Failed to list prices: ${listPrices.status()}`).toBeTruthy()
      const listBody = (await listPrices.json()) as { items?: Array<Record<string, unknown>> }
      const items = Array.isArray(listBody.items) ? listBody.items : []
      const updated = items.find((item) => item.id === priceId)
      expect(updated, 'Updated price should exist in listing').toBeTruthy()
      const gross = Number(updated?.unit_price_gross ?? updated?.unitPriceGross ?? Number.NaN)
      expect(Number.isFinite(gross) && Math.abs(gross - 35.5) < 0.01, 'Price should be updated to 35.5').toBeTruthy()
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
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })

  test('should delete price and verify it is removed', async ({ request }) => {
    const stamp = Date.now()
    let token: string | null = null
    let productId: string | null = null
    let createdPriceKindId: string | null = null

    try {
      token = await getAuthToken(request)
      const priceKind = await ensurePriceKindFixture(request, token)
      if (priceKind.created) createdPriceKindId = priceKind.id

      productId = await createProductFixture(request, token, {
        title: `QA TC-CAT-018-3 ${stamp}`,
        sku: `QA-CAT-018-3-${stamp}`,
      })

      const variantId = await createVariantFixture(
        request,
        token,
        productId,
        `Variant ${stamp}`,
        `QA-CAT-018-3-V-${stamp}`,
      )

      const createPrice = await apiRequest(request, 'POST', '/api/catalog/prices', {
        token,
        data: {
          productId,
          variantId,
          priceKindId: priceKind.id,
          currencyCode: priceKind.currencyCode,
          minQuantity: 1,
          unitPriceGross: 15.0,
        },
      })
      expect(createPrice.ok(), `Failed to create price: ${createPrice.status()}`).toBeTruthy()
      const priceBody = (await createPrice.json()) as { id?: string }
      const priceId = priceBody.id as string

      const deletePrice = await apiRequest(
        request,
        'DELETE',
        `/api/catalog/prices?id=${encodeURIComponent(priceId)}`,
        { token },
      )
      expect(deletePrice.ok(), `Failed to delete price: ${deletePrice.status()}`).toBeTruthy()

      const listPrices = await apiRequest(
        request,
        'GET',
        `/api/catalog/prices?productId=${encodeURIComponent(productId)}&page=1&pageSize=50`,
        { token },
      )
      expect(listPrices.ok(), `Failed to list prices: ${listPrices.status()}`).toBeTruthy()
      const listBody = (await listPrices.json()) as { items?: Array<Record<string, unknown>> }
      const items = Array.isArray(listBody.items) ? listBody.items : []
      const found = items.some((item) => item.id === priceId)
      expect(found, 'Deleted price should not appear in listing').toBeFalsy()
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
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })

  test('should allow creating a price with zero amount', async ({ request }) => {
    const stamp = Date.now()
    let token: string | null = null
    let productId: string | null = null
    let createdPriceKindId: string | null = null

    try {
      token = await getAuthToken(request)
      const priceKind = await ensurePriceKindFixture(request, token)
      if (priceKind.created) createdPriceKindId = priceKind.id

      productId = await createProductFixture(request, token, {
        title: `QA TC-CAT-018-4 ${stamp}`,
        sku: `QA-CAT-018-4-${stamp}`,
      })

      const variantId = await createVariantFixture(
        request,
        token,
        productId,
        `Variant ${stamp}`,
        `QA-CAT-018-4-V-${stamp}`,
      )

      const createPrice = await apiRequest(request, 'POST', '/api/catalog/prices', {
        token,
        data: {
          productId,
          variantId,
          priceKindId: priceKind.id,
          currencyCode: priceKind.currencyCode,
          minQuantity: 1,
          unitPriceGross: 0,
        },
      })
      expect(createPrice.ok(), `Zero-amount price should be allowed: ${createPrice.status()}`).toBeTruthy()
      const priceBody = (await createPrice.json()) as { id?: string }
      expect(typeof priceBody.id === 'string' && priceBody.id.length > 0, 'Price id missing').toBeTruthy()

      const listPrices = await apiRequest(
        request,
        'GET',
        `/api/catalog/prices?productId=${encodeURIComponent(productId)}&page=1&pageSize=50`,
        { token },
      )
      expect(listPrices.ok(), `Failed to list prices: ${listPrices.status()}`).toBeTruthy()
      const listBody = (await listPrices.json()) as { items?: Array<Record<string, unknown>> }
      const items = Array.isArray(listBody.items) ? listBody.items : []
      const found = items.find((item) => item.id === priceBody.id)
      expect(found, 'Zero-amount price should appear in listing').toBeTruthy()
      const gross = Number(found?.unit_price_gross ?? found?.unitPriceGross ?? Number.NaN)
      expect(Number.isFinite(gross) && Math.abs(gross) < 0.01, 'Price amount should be zero').toBeTruthy()
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
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })

  test('should reject creating a price with negative amount', async ({ request }) => {
    const stamp = Date.now()
    let token: string | null = null
    let productId: string | null = null
    let createdPriceKindId: string | null = null

    try {
      token = await getAuthToken(request)
      const priceKind = await ensurePriceKindFixture(request, token)
      if (priceKind.created) createdPriceKindId = priceKind.id

      productId = await createProductFixture(request, token, {
        title: `QA TC-CAT-018-5 ${stamp}`,
        sku: `QA-CAT-018-5-${stamp}`,
      })

      const variantId = await createVariantFixture(
        request,
        token,
        productId,
        `Variant ${stamp}`,
        `QA-CAT-018-5-V-${stamp}`,
      )

      const createPrice = await apiRequest(request, 'POST', '/api/catalog/prices', {
        token,
        data: {
          productId,
          variantId,
          priceKindId: priceKind.id,
          currencyCode: priceKind.currencyCode,
          minQuantity: 1,
          unitPriceGross: -10,
        },
      })
      expect(createPrice.status(), 'Negative price amount should be rejected with 400').toBe(400)
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
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })
})
